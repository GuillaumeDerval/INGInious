# LTI 1.3 message launch (resource link and deep-linking launches)

- **ID**: LTI-09
- **Actors**: LTI user (browser auto-posting the platform's id_token)
- **Routes**: GET|POST /lti1.3/launch, /lti1.3/launch/<courseid>, /lti1.3/launch/<courseid>/<taskid>,
  /lti1.3/deeplaunch, /lti1.3/deeplaunch/<courseid> (single handler)
- **Depends on**: LTI-08, LTI-03 (session), LTI-04 (login/binding), LTI-05 / LTI-10 (targets)
- **Legacy code**: `legacy/inginious/frontend/pages/lti/v1_3/__init__.py:104-197` (`LTI13LaunchPage`),
  `legacy/inginious/frontend/lti/v1_3/__init__.py:21-59`,
  `legacy/inginious/frontend/models/lti1_3.py:19-24` (`LaunchData` → `lti_launch`),
  `legacy/inginious/frontend/flask/mapping.py:100-108`, `flask/mongo_sessions.py:39-44`,
  PyLTI1p3 `message_launch.py`, `message_validators/*`

## Use case
After OIDC login the platform posts a signed `id_token` (JWT) describing the user, the
context and the requested resource. INGInious validates it, stores it (to send grades
later and to answer deep-linking requests), creates an LTI session and continues with the
LTI login/binding step.

## Preconditions
- A nonce was issued by LTI-08 for this browser's `state` (see Security).
- Issuer/client/deployment configured (course config of `<courseid>` + global config).
- For resource launches the platform sends custom parameters `courseid`, `taskid` (unless
  given in the URL) and `secret` (= `lti_secrets[platform_instance_id]` of the course).

## Main flow
Behaviour of the app (`app/src/lib/server/lti/lti13.ts`, `launch13`); legacy differences
are noted at the end of the section. Every failed check answers **403 "Invalid LTI launch
(<check>)"**.
1. Parameters `id_token` and `state` (form on POST, query string on GET). The state must
   equal the value of the cookie `lti1p3-<state>` (check `state`); the cookie is then
   deleted.
2. The id_token is decoded (check `id_token`); the course is the URL `<courseid>`, else
   the `custom.courseid` claim (unknown course → 404). The registration is looked up by
   `iss` and `azp`/`aud` in the tool config of that course (as in LTI-08) (check `issuer`).
3. Signature verification with the platform keys of that registration (`key_set`, or the
   key set fetched from `key_set_url`, cached per URL and refetched for an unknown `kid`):
   RS256 only, `iss`, `aud` = client id, `exp` (required), `sub` and `nonce` required
   (check `signature`). The configuration chosen through `custom.courseid` is therefore
   only trusted once the signature verified with it.
4. The nonce document `lti1p3-nonce-<nonce>` whose value is this `state` is consumed
   (deleted); none → check `nonce`.
5. The deployment id must be one of the registration's `deployment_ids` (check
   `deployment`).
6. Message: version `1.3.0`, and either `LtiDeepLinkingRequest` with deep-linking
   settings, or `LtiResourceLinkRequest` with a course (URL or `custom.courseid`) and a
   task (URL or `custom.taskid`); anything else → check `message`.
7. The launch is saved: `lti_launch` ← `{key: "lti1p3-launch-<uuid4>", value: <JWT body>,
   expires: now + 7 days}` (read later by grade passback and the deep-link picker).
8. Extracted values:
   - `user_id = sub`; `roles = …/claim/roles` (stored, unused);
   - realname: `name`; else `given_name + " " + family_name`; else `email`; else
     `family_name`; else `given_name`; else `sub`;
   - `email = email or ""`;
   - `platform_instance_id = iss + "/" + client_id + "/" + deployment_id`;
   - tool info from `…/claim/tool_platform` `name`, `description`, `url` (default "N/A");
   - context from `…/claim/context` keys `title` / `label` (default "N/A").
9. Resource link: `task = [courseid, taskid]`, `course_secret = custom.secret or ""`,
   `redir_url = /lti1.3/task?session_id=<token>`. Deep linking: `task = ["", ""]`,
   `course_secret = ""`, `redir_url = /lti1.3/deeplink?session_id=<token>`.
   The path (`/launch` vs `/deeplaunch`) does not matter, only the message type.
10. A new LTI session (LTI-03) with `loggedin = false` and `lti = {version: "1.3", email,
    username: sub, realname, roles, task, platform_instance_id, course_secret,
    message_launch_id: <launch key>, context_title, context_label, tool_description,
    tool_name, tool_url, redir_url}`; `302 /lti1.3/login?session_id=<token>` (LTI-04).

Legacy differences (functional): legacy validated with PyLTI1p3 (every failure was an
unhandled exception → 500), fetched the platform JWKS at each launch, also stored an
id-token hash document, read the realname from a misspelled `given` claim and the context
from `context_title`/`context_label` (always "N/A"), required the custom claim (500 when
absent) and failed with 500 on other message types.

Live session document after a resource launch (legacy capture; the app stores the
signed token in `redir_url` and the real context title/label):
```js
lti: { version: '1.3', email: 'plat-user-1@platform.example', username: 'plat-user-1',
  realname: 'Platform User plat-user-1', roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
  task: ['lti_test','mcq2'], redir_url: '/lti1.3/task?session_id=6acf1588abf3f4aa74036f2c',
  context_title: 'N/A', context_label: 'N/A', tool_description: 'Mock LMS', tool_name: 'MockLMS',
  tool_url: 'http://localhost:8094', message_launch_id: 'lti1p3-launch-6137c291-25cc-41fb-a6ce-b0898450e4db',
  platform_instance_id: 'https://platform.example/tool-client-1/dep-1', course_secret: 's3cr3t' }
```

## Alternative / error flows
- Missing/invalid state, unknown or reused nonce, bad signature, expired JWT, unknown
  deployment, unsupported message or resource launch without course/task → 403
  "Invalid LTI launch (<check>)".
- The secret is not checked at launch but on every LTI page and action of the session (LTI-05).
- If the URL has `<courseid>` the custom `courseid` is ignored (and only that course's
  config + global config are trusted).
- The deep-link response (LTI-10) points resources to the global `/lti1.3/launch`; the
  course then comes from `custom.courseid`, so platforms configured at course level work
  too.

## UI elements
None (redirect).

## Data
- `lti_launch` documents `{_id, key: str, value: any, expires: Date}` (see reference §10),
  purged by a TTL index on `expires`.
- `sessions` document with `lti` as above.

## Permissions & security
- The nonce is bound to the `state` of the OIDC login, must match, and is consumed once.
- A launch POST cannot be replayed: its nonce is consumed by the first launch, and the
  state must match the state cookie of the browser that started the login (the cookie is
  deleted at launch).
- The id_token is fully validated: RS256 signature with the platform keys, `iss`,
  `aud` = client id, `exp`, required `sub`/`nonce`, deployment, version and message type.
- Course registrations of an `(iss, client_id)` declared elsewhere (global configuration
  or another LTI course) with other platform keys are ignored, so a course cannot sign
  launches for a platform registered elsewhere (bindings are keyed by `iss/client/deployment`).
- Roles are ignored: platform instructors get no INGInious rights.
- Platform JWKS fetched server-side from the configured URL (cached per URL).
- Validation errors are answered with 4xx pages.

## Acceptance tests
- Full browser flow with a mock platform (`/start?msg=resource&custom_courseid=…`):
  OIDC → auth → launch → `302 /lti1.3/login?session_id=…`.
- Session `lti` fields as above; `platform_instance_id` built from iss/aud/deployment.
- `name` absent, `given_name`/`family_name` present → realname `given + " " + family`.
- Context claim `{title, label}` → stored as `context_title` / `context_label`.
- Bad signature / unknown kid / wrong deployment / expired token / missing state cookie
  → 403.
- Unknown nonce → rejected; reused nonce → rejected.
- Replay of an identical launch POST → rejected.
- Deep-link launch → `redir_url` `/lti1.3/deeplink`, task `["", ""]`.
- Resource launch without course/task → 403.
