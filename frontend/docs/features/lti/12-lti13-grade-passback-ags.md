# LTI 1.3 grade passback (Assignment and Grade Services)

- **ID**: LTI-12
- **Actors**: system (background thread), LTI 1.3 platform (token + score endpoints)
- **Routes**: none inbound; outbound POST `auth_token_url`, POST `<lineitem>/scores`
- **Depends on**: LTI-09 (stored launch), LTI-05 (tagging), LTI-07 (shared queue logic)
- **Legacy code**: `legacy/inginious/frontend/lti/__init__.py:17-94` (`LTIScorePublisher`),
  `legacy/inginious/frontend/lti/v1_3/__init__.py:62-97` (`LTIGradeManager`),
  `legacy/inginious/frontend/models/lti1_3.py:9-17` (`LTIGrade`),
  `legacy/inginious/frontend/app.py:169-170`, PyLTI1p3 `assignments_grades.py`,
  `service_connector.py`, `grade.py`

## Use case
With "Send back grades" enabled, each graded submission made through an LTI 1.3 launch
updates the platform gradebook line item associated with the resource link.

## Preconditions
- `course.lti_send_back_grade()` at submission time; submission tagged with
  `lti_version: "1.3"` and `message_launch_id`.
- The stored launch has an AGS claim with the `score` scope and a `lineitem` URL.

## Main flow
Behaviour of the app (`app/src/lib/server/lti/outcomes.ts`, `sendAgs`): queueing and
retries as in LTI-07 (collection `lti_grade_queue`, identity `{username, courseid, taskid,
message_launch_id}`). For each entry: the stored launch is read from `lti_launch`; no AGS
claim, no `lineitem` or no `score` scope → the entry is dropped at once (it can never
succeed); the registration is found in the course + global config; a client assertion
signed with the tool key (`iss = sub = client_id`, `aud = auth_audience` or
`auth_token_url`, 60 s lifetime, random `jti`) is exchanged at `auth_token_url` for an
access token, then the score (`scoreGiven` = user-task grade clipped to [0, 100],
`scoreMaximum` 100, `Completed` / `FullyGraded`, `userId` = launch `sub`) is POSTed to
`<lineitem>/scores`. Any non-2xx answer is a failed attempt; every HTTP call has a 10 s
timeout.

Legacy mechanics (reference):
1. Queueing: identical to LTI-07 with collection `lti_grade_queue`, identity
   `{username, courseid, taskid, message_launch_id}`, `nb_attempt = 0`, same thread
   loop (0.5 s sleep, ≤ 6 attempts, delete on success or after the last failure, startup
   reload of all pending documents).
2. `process(entry, grade)` with `grade = user_tasks.grade` (0–100):
   1. `Course.get(courseid)`; tool config = course `lti_config` + global config;
   2. `FlaskMessageLaunch.from_cache(message_launch_id, request=None, …)` — loads the JWT
      body from `lti_launch`, re-finds the registration (no signature re-validation);
      missing launch → exception → failure;
   3. `ags = get_ags()` (missing AGS claim → exception → failure);
   4. if `ags.can_put_grade()` (scope list contains
      `https://purl.imsglobal.org/spec/lti-ags/scope/score`): build
      `Grade(scoreGiven=grade, scoreMaximum=100.0, timestamp=now().astimezone().isoformat(),
      activityProgress="Completed", gradingProgress="FullyGraded", userId=launch.sub)`
      and `ags.put_grade(grade)` → token request then score POST (exact formats in
      `docs/reference/lti.md` §8); return success;
   5. scope missing → returns False (failure → retried 5 more times, uselessly);
   6. `LtiServiceException` (non-2xx from token or score endpoint) → log message and
      HTTP reason → failure; other exception → logged with traceback → failure.

Live capture (mock platform):
```
POST http://lti-mock:8000/token   (form) grant_type=client_credentials&client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer&client_assertion=<RS256 JWT kid=jK_d5…>&scope=https%3A%2F%2Fpurl.imsglobal.org%2Fspec%2Flti-ags%2Fscope%2Flineitem+https%3A%2F%2Fpurl.imsglobal.org%2Fspec%2Flti-ags%2Fscope%2Fscore
  assertion claims: {"iss":"tool-client-1","sub":"tool-client-1","aud":"http://lti-mock:8000/token","iat":1791956361,"exp":1791956426,"jti":"lti-service-token-a7cf…"}
POST http://lti-mock:8000/lineitems/1/lineitem/scores
  Authorization: Bearer mock-access-token
  Content-Type: application/vnd.ims.lis.v1.score+json
  {"scoreGiven": 100.0, "scoreMaximum": 100.0, "activityProgress": "Completed", "gradingProgress": "FullyGraded", "timestamp": "2026-10-14T05:39:26.731975+00:00", "userId": "plat-user-1"}
```

## Alternative / error flows
- A user task that cannot be read is a failed attempt (legacy: the publisher thread
  stopped, as in LTI-07).
- No line item in the AGS claim (platform supports AGS but line items are managed by the
  tool) → nothing can be sent; INGInious never creates line items.
- Access token is requested for every send (no cache across sends).
- Legacy sent out-of-range grades as-is; the app clips them to [0, 100].
- Group submissions: each member is queued with the submitter's `message_launch_id` →
  all scores are posted with `userId` = submitter's `sub` (last wins).

## UI elements
None.

## Data
- `lti_grade_queue`: `{_id, courseid: str, taskid: str, username: str, nb_attempt: int,
  message_launch_id: str}`.
- Reads `lti_launch` (`key = message_launch_id`), `user_tasks.grade`, course and global
  `lti_config`.

## Permissions & security
- Tool private key used to sign the client assertion (kid = thumbprint).
- The token URL comes from the LTI configuration (global or course registration, set by
  administrators); the line item URL comes from the platform-signed launch.
- `lti_launch` documents hold the full launch claims (personal data: name, email); they
  expire after 7 days.

## Acceptance tests
- A graded 1.3 submission → one token POST (client assertion verifiable with the tool
  JWKS, `aud` = token URL or `auth_audience`) and one score POST with the exact JSON
  above; queue document deleted.
- Score endpoint returns 500 → 6 attempts then the document is dropped.
- Launch without `score` scope → no HTTP call, entry dropped at once (legacy: retried
  then dropped).
- `userId` is the launch `sub`; `scoreGiven` = user-task grade (best/last).
