# Plugin "ltibestsubmission": JSON of the best submission for the current LTI launch

- **ID**: SITE-20
- **Actors**: LTI user (inside an LMS iframe / LMS-side script using the LTI session)
- **Routes**: GET /lti/bestsubmission, GET /lti1.3/bestsubmission (other methods → 405; legacy POST → 404)
- **Depends on**: SITE-12, LTI (LTI 1.1/1.3 launch, `session.lti`, `users.ltibindings`), SUBMISSION
- **Legacy code**: `plugins/ltibestsubmission/__init__.py:L1-85`

## Use case
From within an LTI launch of a task, the LMS page (or a script) retrieves the student's best
submission for that task, with a question/answer summary, to display it in the LMS.

## Preconditions
- Plugin enabled (`- plugin_module: inginious.frontend.plugins.ltibestsubmission`).
- An LTI session (`session.lti` set by an LTI launch on a task; the URL must carry the LTI session id
  like other LTI pages, `session_id` query parameter added by `url_for` in LTI sessions).
- The LTI user is bound to an INGInious account (`users.ltibindings.<courseid>.<consumer_key>` = LTI user id).

## Main flow
App behaviour (detailed in LTI-14): plugin disabled or no LTI data → 404; LMS user not bound
(session not logged in) → `{"status": "error", "message": "user not bound with lti"}`; then
the LTI task page guard (LTI-05, incl. the LTI 1.3 deployment secret); the evaluated
submission of the bound account is returned as `application/json` with only the fields
`_id, courseid, taskid, status, result, grade, submitted_on, input` (uploaded file contents
blanked), the question/answer summary and the translated task context; no evaluated
submission or no user task → `{"status": "success", "submission": null}`. Legacy flow
(reference):
1. `data = session.lti`; `courseid, taskid = data["task"]`.
2. Find user `User.objects(ltibindings__<courseid>__<data["consumer_key"]> = data["username"])`.
3. `UserTask(username, courseid, taskid).submissionid` → best submission id.
4. Load submission + input; for each task problem:
   - multiple choice → `answer_dict = problem.get_choice_with_index(int(input[pid]))`,
     `success = answer_dict["valid"]`, `answer` = translated choice text, `type: "mcq"`;
   - match → `type: "match"`, code → `type: "code"`, `success = submission.result == "success"`, `answer` = raw input;
   - other types skipped.
   `question` = translated problem header.
5. Response body (string from `bson.json_util.dumps`, served as `text/html; charset=utf-8`):
   ```json
   {"status": "success", "submission": {<full submission document incl. "_id": {"$oid":...}, "input": {...}, "submitted_on": {"$date":...}, ...}},
    "question_answer": [{"question": "...", "answer": "...", "success": true, "type": "code"}],
    "task_context": "<RST source of the task context>"}
   ```

## Alternative / error flows
- Not logged in → login page (INGIniousAuthPage), HTTP 200.
- Logged in but no LTI data in session → 404 (verified).
- User not bound → `{"status": "error", "message": "user not bound with lti"}`.
- `user_tasks` doc missing → `.get()` raises `DoesNotExist` → **500** (the `{"status": "success", "submission": null}`
  branch for this case is unreachable); `submissionid` null → `{"status": "success", "submission": null}`.
- **Bug**: `/lti1.3/bestsubmission` is mapped to the LTI 1.1 class (uses `consumer_key` instead of
  `platform_instance_id`; the `LTI13BestSubmissionPage` class is unused) → LTI 1.3 lookups fail.
- MCQ with multiple answers (list input) → `int(list)` error → 500.

## Data
Reads `users.ltibindings`, `user_tasks.submissionid`, `submissions` (+ GridFS input), task files.

## Permissions & security
- Only the LTI session's own bound account and launched task are used; LTI 1.3 sessions must
  carry the valid deployment secret (LTI-05).
- Returns a whitelisted subset of the submission fields (`_id, courseid, taskid, status,
  result, grade, submitted_on, input`: no stdout/stderr, custom, state or `user_ip`); uploaded
  file contents are removed from `input`.

## Acceptance tests
- LTI 1.1 session of a bound user with a best submission → JSON as above (fields, types).
- Unbound user → error JSON; no best submission → `submission: null`; no LTI session → 404.
- LTI 1.3 route works with the 1.3 binding (legacy used the 1.1 key).
