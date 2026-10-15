# Plugin `ltibestsubmission` (best submission JSON for LTI sessions)

- **ID**: LTI-14
- **Actors**: LTI user (or the LMS/iframe JS on its behalf)
- **Routes**: GET /lti/bestsubmission?session_id=…, GET /lti1.3/bestsubmission?session_id=… (other methods → 405)
- **Depends on**: LTI-03, LTI-04, plugin system (PLUGIN area)
- **Legacy code**: `legacy/inginious/frontend/plugins/ltibestsubmission/__init__.py:1-85`
  (enabled with `plugins: [{plugin_module: inginious.frontend.plugins.ltibestsubmission}]`)

## Use case
Intended to let an LTI-embedded page (or LMS-side script) fetch, as JSON, the student's
"best" (evaluated) submission for the launched task, with a per-question summary
(question text, answer, success) and the task context — e.g. for reporting inside the LMS.

## Preconditions
- Plugin enabled; LTI session logged in (auth page, LTI-allowed).

## Main flow
Behaviour of the app (`app/src/lib/server/plugins/bundled/inginious.frontend.plugins.ltibestsubmission.ts`):
plugin disabled or session without LTI data → 404; session not logged in (LMS user not
bound) → `{"status": "error", "message": "user not bound with lti"}`; otherwise the guard of
the LTI task page applies (LTI-05, incl. the 1.3 deployment secret) and the evaluated
submission of the bound account for the launched task is returned as `application/json`:
`{"status": "success", "submission": {_id, courseid, taskid, status, result, grade,
submitted_on, input}, "question_answer": [{question, answer, success, type}],
"task_context": <translated context source>}` (uploaded file contents are blanked in
`input`), or `{"status": "success", "submission": null}` without evaluated submission.
MCQs (also multiple-answer ones) report the chosen choice text(s) and whether exactly the
valid choices were chosen. Each LTI version uses its own binding key.

Legacy plugin (as written, reference):
1. `session.lti` null → 404.
2. `courseid, taskid = session.lti.task`.
3. Find the INGInious user with
   `User.objects(**{"ltibindings__" + courseid + "__" + session.lti[<field>]: session.lti.username})`
   where `<field>` = `consumer_key` (class `LTI11BestSubmissionPage`) or
   `platform_instance_id` (class `LTI13BestSubmissionPage`). None → body
   `{"status": "error", "message": "user not bound with lti"}`.
4. `UserTask(username, courseid, taskid).submissionid`; none → `{"status": "success",
   "submission": null}`.
5. Load the submission and its input; for each problem: MCQ → answer text of the chosen
   index, `success` = choice validity, type `"mcq"`; match → `"match"`; code → `"code"`
   (success = submission result == "success"); other types skipped.
6. Return `bson.json_util.dumps({"status": "success", "submission": <submission doc>,
   "question_answer": [{question, answer, success, type}], "task_context": <raw context>})`
   with content type text/html.

## Alternative / error flows (legacy behaviour — the legacy plugin is broken; not reproduced)
- **Binding lookup uses the pre-db_version-19 nested format**
  (`ltibindings.<courseid>.<key>`), while bindings are stored flat
  (`ltibindings["<courseid>/<key>"]`). Verified: always returns
  `{"status": "error", "message": "user not bound with lti"}` for a bound user.
- Even with a legacy nested binding inserted manually, step 5 crashes
  (`TypeError: 'GridFSProxy' object is not subscriptable`) → 500 (verified).
- `/lti1.3/bestsubmission` is registered with the **1.1 class** (copy-paste bug), so it
  reads `consumer_key` (None for 1.3) → string concatenation `TypeError` → 500 (verified).
- `UserTask…get()` raises if the user task does not exist → 500.
- Not logged in → login form (auth page).
- App: unbound LMS user → `status: error` JSON (above); missing user task → `submission: null`.

## UI elements
None (JSON).

## Data
Reads `users.ltibindings`, `user_tasks.submissionid`, `submissions` (+ GridFS input),
task files.

## Permissions & security
- Only the LTI session's own bound account and launched task are used; LTI 1.3 sessions
  must carry the valid deployment secret (LTI-05).
- Returns a whitelisted subset of the submission fields (no stdout/stderr, custom fields,
  IP or uploaded file contents).
- The JSON is served as `application/json`.

## Acceptance tests
- Bound LTI user with an evaluated MCQ submission → `status: success`,
  `question_answer` with the chosen answer text and validity, `task_context`; unbound →
  `status: error`; no submission → `submission: null`; both `/lti/` and `/lti1.3/` routes
  use their own binding key.
- Plugin disabled or non-LTI session → 404.
- The returned submission has only the whitelisted fields; file inputs have an empty value.
