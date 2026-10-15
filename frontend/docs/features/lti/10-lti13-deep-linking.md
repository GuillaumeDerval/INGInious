# LTI 1.3 Deep Linking task picker

- **ID**: LTI-10
- **Actors**: LTI user (normally an LMS instructor) bound to an INGInious course admin
- **Routes**: GET /lti1.3/deeplink?session_id=…, POST /lti1.3/deeplink?session_id=… (legacy also: GET …&courseid=<id>, AJAX JSON)
- **Depends on**: LTI-09 (deep-link launch), LTI-04 (binding), LTI-01 (secrets)
- **Legacy code**: `legacy/inginious/frontend/pages/lti/v1_3/__init__.py:210-266` (`LTI13DeepLinkPage`),
  `templates/lti/deeplink.html`, PyLTI1p3 `deep_link.py`, `deep_link_resource.py`

## Use case
When adding an INGInious activity in the LMS, the instructor clicks "Select content": the
LMS performs a deep-linking launch; INGInious shows a picker of the LTI courses the user
administers and their tasks; on selection INGInious returns a signed
`LtiDeepLinkingResponse` creating an LTI resource link whose custom parameters
(`courseid`, `taskid`, `secret`) will be used by later resource launches.

## Preconditions
- LTI session from an `LtiDeepLinkingRequest` launch (session `redir_url` points here
  after login/binding).

## Main flow
Behaviour of the app (`app/src/lib/server/lti/pages.ts`, `deepLinkData` / `deepLinkSelect`);
legacy differences are noted at the end of the section.
1. Guard (GET and POST): no LTI data → 403 "No LTI data available."; not logged in → 302
   to the LTI login step (LTI-04); the stored launch (`lti_launch`, key
   `session.lti.message_launch_id`) has no deep-linking settings → 403 "This is not a deep
   linking launch.".
2. GET: the LTI courses administered by the bound user (course admins and superadmins)
   with their tasks (names in the user language; tasks that cannot be loaded are left
   out). Rendered as a "Task picker" card with a **Course** select (`-- Select a course --`)
   and a **Task** select (`-- Select a task --` / `-- No task available --`), button
   **Select**. No administered LTI course → "No LTI course available".
3. POST (form `courseid`, `taskid`):
   1. course not among the administered LTI courses → 403; task not in the course → 404
      "Task not found.";
   2. if `platform_instance_id` has no secret in `course.lti_secrets()`: generate 16
      random bytes (32 hex chars), store it in the course descriptor and **save
      `course.yaml`**;
   3. registration = the one matching the stored launch in the course + global config
      (none → 400 "Unknown LTI platform.");
   4. signed `LtiDeepLinkingResponse` (RS256, tool key, `exp` = 10 min) with one
      `ltiResourceLink` item: `title` = task name (user language), `url =
      <external origin>/lti1.3/launch` (no course in the path), `custom = {courseid,
      taskid, secret}`; `data` of the request echoed;
   5. the page then auto-submits a form posting `JWT=<signed response>` to the platform's
      `deep_link_return_url` (format in `docs/reference/lti.md` §6).

Legacy differences (functional): legacy loaded the tasks of the selected course with an
AJAX GET (`?courseid=`), answered a non-LTI session, a missing task or a resource-link
session with 500, and rendered the auto-submit form from the server.

Live deep-link response claims (decoded by the mock LMS):
```json
{"iss": "tool-client-1", "aud": ["https://platform.example"], "exp": 1791957000, "iat": 1791956400,
 "nonce": "nonce-7913d1b6…",
 "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "dep-1",
 "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiDeepLinkingResponse",
 "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
 "https://purl.imsglobal.org/spec/lti-dl/claim/content_items": [{"type": "ltiResourceLink", "title": "LTI MCQ 1",
   "url": "http://localhost:8093/lti1.3/launch", "custom": {"courseid": "lti_test", "taskid": "mcq1", "secret": "s3cr3t"}}],
 "https://purl.imsglobal.org/spec/lti-dl/claim/data": "opaque-dl-data"}
```

## Alternative / error flows
- User with no admin rights on an LTI course: "No LTI course available" (no picker).
- Launch session was a resource launch (no deep-linking settings) → 403.
- `accept_multiple` and `accept_types` of the request are ignored (always one
  `ltiResourceLink`).
- The resource URL is always the global launch URL (see LTI-09 alternative flows).

## UI elements
`DeepLinkPicker.svelte` (course and task selects, Select button, hidden auto-submitted
return form); LTI layout.

## Data
- Reads all courses, `lti_launch` (launch body by key).
- May write `course.yaml` (`lti_secrets` entry).

## Permissions & security
- GET and POST require a logged-in (bound) LTI session coming from a deep-linking launch.
- GET only lists the LTI courses the bound account administers.
- POST requires that the bound account administers the chosen LTI course; only then is
  the deployment secret returned (and generated/persisted if needed), so `course.yaml` is
  only written for a course administrator.
- The deep-link POST is protected by the origin check of form POSTs.

## Acceptance tests
- Deep-link launch as a platform user bound to a course admin → picker lists only LTI
  courses administered by that user with their tasks; POST returns the auto-submit form
  to `deep_link_return_url` with a JWT verifiable with the tool JWKS (LTI-11) and the
  claims above.
- Course without secret for this platform instance → a 32-hex secret is created and saved
  in `course.yaml`, and returned in `custom.secret`.
- POST by a non-admin of the course → 403, no secret returned; unbound LTI session → LTI
  login step.
- Unknown task → 404.
