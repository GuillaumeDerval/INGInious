# REST API v0: submit an answer

- **ID**: SITE-11
- **Actors**: API client (registered student, staff)
- **Routes**: POST /api/v0/courses/<courseid>/tasks/<taskid>/submissions
- **Depends on**: SITE-06, SITE-07, SITE-10, SUBMISSION (`WebAppSubmissionManager.add_job`), TASK
- **Legacy code**: `pages/api/submissions.py:L159-218` (`APISubmissions.API_POST`),
  `user_manager.py:L491-503` (`user_saw_task`), `L571-608` (`task_can_user_submit`),
  `submission_manager.py:L423-480` (`add_job`)

## Use case
A client (e.g. editor plugin) submits code/answers to a task without the web UI and gets a
submission id to poll (SITE-10).

## Main flow
App behaviour: as below, with these differences — the body may be form data, multipart or
a JSON object; the input is built like on the task page (`@action` / `@debug-mode`
dropped) and a missing or invalid answer gives 400 `{"error": "Invalid arguments for this
method"}`; a pending submission gives **409** with the bare JSON string
`"A submission is already pending for this task!"`; `debug` is set for course admins.
Legacy details are kept for reference.

1. Course → 404 `{"error": "Course not found"}`; `course_is_open_to_user(lti=False)` else 403
   `{"error": "You are not registered to this course"}`; task → 404 `{"error": "Task not found"}`.
2. `user_saw_task(username, courseid, taskid)` — creates the `user_tasks` document if missing
   (done **before** the permission check below).
3. `task_can_user_submit(course, task, username, False)` (staff always allowed; else course open,
   task accessible per task dispenser, group constraint, submission-limit tokens) else 403
   `{"error": "You are not allowed to submit for this task"}`.
4. Input built from the request (form-encoded or multipart):
   - start from all form fields (`request.form.copy()`);
   - for each problem `pid`: if its input type is `list` (multiple-answer MCQ) →
     `form.getlist(pid)`; if `dict` (file problem) → `request.files.get(pid)` (multipart file);
     else `form.get(pid)` (**missing → None**);
   - `task.adapt_input_for_backend(input)` (problem-specific conversion, file → `{filename, value}`).
5. `task.input_is_consistent(input, ALLOWED_FILE_EXTENSIONS, MAX_FILE_SIZE)` else 400
   `{"error": "Invalid arguments for this method"}` (e.g. file with a forbidden extension — verified).
6. `debug = has_admin_rights_on_course` (admins get debug info stored); `submission_manager.add_job(course, task, input, dispenser, username, debug)`.
7. 200 `{"submissionid": "<ObjectId hex>"}`. Grading continues asynchronously (poll SITE-10).

## Alternative / error flows
- A submission of this user is still `waiting` for this task → **409** with the bare JSON
  string `"A submission is already pending for this task!"` (legacy: 500).
- Backend/agent problems → submission ends with `status: "error"`.
- Missing answers → 400 `{"error": "Invalid arguments for this method"}`. (Legacy accepted
  them: e.g. MCQ task posted without `q2` → `q2: null` stored, the agent crashed → submission
  `status: "error"`, `result: "crash"`.)
- Extra unknown form fields are kept in the input sent to the grader.
- Group tasks: the submission is created for the user's group (same logic as the web UI).
- No SSH debug mode via API (`@debug-mode` not handled).

## Data
- `user_tasks`: upsert on `user_saw_task`; `tried`/tokens updated by `add_job`.
- `submissions`: new doc (`courseid, taskid, status: "waiting", submitted_on (UTC), username: [..],
  user_ip, input (GridFS), ...`) — same format as web submissions (SUBMISSION area).
- Message `ClientNewJob` sent to the backend with `launcher_name` of the web app.
- Hook `new_submission` called (see `docs/reference/plugin-hooks.md`).

## Permissions & security
- Cookie session only (anonymous and LTI sessions → 403); form-encoded POSTs must carry the
  site's own `Origin` (SITE-06); the course/registration/submission checks above apply.
- `user_saw_task` side effect even when submission is refused.

## Acceptance tests
- Registered student, accessible task, complete input → 200 `{"submissionid": ...}` and a
  `submissions` doc with `status: "waiting"` then `done`.
- Task not accessible (dispenser `accessibility: false`) → 403 "You are not allowed to submit for this task".
- Outsider → 403 "You are not registered to this course"; anonymous → 403 "You are not authenticated".
- Multipart file with allowed extension accepted; disallowed extension → 400.
- Second submission while one is waiting → 409 + JSON string (legacy 500).
- Missing problem field → 400 (legacy accepted it, crash later).
