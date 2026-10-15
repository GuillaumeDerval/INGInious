# Submitting an answer (create submission + send job)

- **ID**: TASK-08
- **Actors**: student, tutor, course admin, superadmin, LTI user
- **Routes**: `POST /course/<courseid>/<taskid>` with `@action=submit` (multipart, AJAX via jQuery Form `ajaxSubmit`); LTI: `POST /lti/task`, `POST /lti1.3/task`
- **Depends on**: TASK-01..06, TASK-09 (completion), TASK-14 (tokens), TASK-15 (stored submissions), TASK-16 (groups), TASK-17 (random), TASK-18 (accessibility), backend protocol (`ClientNewJob`)
- **Legacy code**: `legacy/inginious/frontend/pages/tasks.py:L152-L228`, `submission_manager.py:L104-L147,L423-L489`, `user_manager.py:L571-L607` (`task_can_user_submit`), `client/client.py:L272-L339` (`new_job`), `common/messages.py:L30-L42` (`ClientNewJob`), `static/js/task.js:L195-L330`

## Use case
The student sends the answers of all sub-problems; INGInious stores them as a new submission
and queues a grading job; the page then polls for the result (TASK-09).

## Preconditions
- Logged in (else the sign-in form is returned instead of JSON).
- Course open to the user, task visible (else HTML `course_unavailable` / `task_unavailable` is returned to the AJAX call).
- `task_can_user_submit`: staff → always true; otherwise course open **and** task accessibility `is_open()` (between start and hard end) **and** (group task ⇒ user in a group) **and** tokens available (TASK-14) **and** the user is registered in the course.
- No submission of this user with `status: "waiting"` for this task.

## Main flow
1. **Client** (`submitTask(with_ssh)`): ignore if `loadingSomething`; `taskFormValid()` (TASK-02..06 client checks; errors shown in `#task_alert` as a danger card titled "Error"); set `#task-debug-mode` to `"ssh"` or `""`; `ajaxSubmit` the form (`dataType: json`); then blur the form (inputs/buttons disabled, CodeMirror read-only), reset alerts, show the loading card (spinner, no kill button yet), status cell = spinner, scroll to the alert.
2. **Server** (`BaseTaskPage.POST`):
   1. `course_is_open_to_user` (else `handle_course_unavailable` HTML/302), `task_is_visible_by_user` (else `task_unavailable.html`), `user_saw_task`.
   2. `@action == "submit"` (otherwise see TASK-09/10/11; unknown action → 404).
   3. Rights: `task_can_user_submit(course, task, username, lti=isLTI)` false → `{"status":"error","title":"Error","text":"You are not allowed to submit for this task."}` (**content-type text/html**, JSON body).
   4. Random check: for each `i < len(user_task.random)`: form must contain `@random_<i>` with `float(value) == random[i]`, else `{"status":"error","title":"Error","text":"Your task has been regenerated. This current task is outdated."}`. A non-float value → same error.
   5. Build input from the posted text fields (`form.to_dict()`: extra keys are kept because some plugins rely on them), then for each problem: list → `form.getlist(pid)`; dict (file) → `request.files.get(pid)`; str → `form.get(pid)` (None if absent).
   6. `task.adapt_input_for_backend` (file → `{filename, value}`), `task.input_is_consistent(task_input, ALLOWED_FILE_EXTENSIONS, MAX_FILE_SIZE)` false → `{"status":"error","title":"Error","text":"Please answer to all the questions and verify the extensions of the files you want to upload. Your responses were not tested."}` (application/json).
   7. `del task_input["@action"]`. `debug = is_admin` (course admin or superadmin ⇒ **every admin submission is a debug job**); if `@debug-mode` posted: `"ssh"` and admin → `debug="ssh"`; `@debug-mode` removed from the input.
   8. `submission_manager.add_job(course, task, task_input, dispenser, username, debug)`:
      1. Waiting submission exists for `{courseid, taskid, username, status:"waiting"}` → `Exception("A submission is already pending for this task!")` → JSON error with that text.
      2. `obj = {courseid, taskid, status:"waiting", submitted_on: now(UTC), username:[username], user_ip: request.remote_addr}`.
      3. Input metadata (overwrite anything posted): `@username`, `@email` (user's email), `@lang` (**user profile language**, not session language), `@time = str(submitted_on)` (format `2026-10-14 05:33:40.022576+00:00`), `@attempts = str(user_task.tried + 1)`, `@random = list(user_task.random)`, `@state = user_task.state`.
      4. Plugin hook `new_submission(submission=obj, inputdata=inputdata)`.
      5. `_before_submission_insertion`: group task & not staff → `obj.username = group.students` and (unless a problem is named `group`) `@username = ",".join(students)`, `@email = ",".join(emails)`; LTI session with `lti_send_back_grade` → `obj.lti_version` + publisher-specific outcome fields (`outcome_service_url`, `outcome_result_id`, `outcome_consumer_key` for 1.1; `message_launch_id` for 1.3) — see LTI features.
      6. `Submission(**obj).set_input(inputdata)` → BSON-encode the input dict and store it in **GridFS** (`fs.files`/`fs.chunks`), `submissions.input = <GridFS ObjectId>`; insert the submission.
      7. `_after_submission_insertion` → `_delete_exceeding_submissions` (TASK-15) → list `to_remove` of deleted ids (strings).
      8. `client.new_job(priority=0, job_info={course, task, environment_type, environment}, inputdata, callback, launcher_name="Frontend - <username>", debug, ssh_callback)` → `ClientNewJob(job_id=uuid4, priority=0, course_id, task_id, task_problems=task.yaml problems dict, inputdata, environment_type, environment, environment_parameters, debug, launcher)`; if the env is not available the callback is called immediately with `("crash","Environment not available.")` and `jobid=None`.
      9. `submissions.update({_id}, {$set: {jobid}})` (the callback may already have run: then `jobid` ends up `null` in the document).
   9. Response `{"status":"ok","submissionid":"<id>","remove":[<deleted ids>],"text":"<b>Your submission has been sent...</b>"}`; any exception → `{"status":"error","title":"Error","text":"<str(ex)>"}`.
3. **Client** on `ok`: loading alert (with kill button), `incrementTries()` (`#task_tries` + 1, optimistic), `displayNewSubmission(id)` (new `<li class="submission list-group-item list-group-item-warning">` prepended, text = browser-formatted now, `0` tag badge if the page shows tags), `waitForSubmission(id)` (TASK-09); remove `<li>` of every id in `remove`.
   On `error`: `displayTaskStudentAlertWithProblems(data,"danger")` (card title "Error", body text), status cell = the error text, unblur. On AJAX failure: "Internal error" danger alert.

## Alternative / error flows
| Situation | Response |
|---|---|
| not allowed (closed task, no group, no tokens) | JSON error "You are not allowed to submit for this task." |
| outdated random inputs | JSON error "Your task has been regenerated. This current task is outdated." |
| invalid/missing answers | JSON error "Please answer to all the questions and verify the extensions…" |
| already waiting | JSON error "A submission is already pending for this task!" (no new submission) |
| env unavailable / backend down | `ok` then the submission is immediately `error/crash` "Environment not available." or "Backend unavailable, retry later" |
| task hidden | HTTP 403 "Task unavailable" — client shows "Internal error" |
| missing single MCQ field | JSON error "Please answer to all the questions and verify…" |
| non-float `@random_i` | JSON error "Your task has been regenerated…" |
| no / unknown `@action` | HTTP 400 "Invalid action" |

## UI elements
Submit button `#task-submit` (and admin SSH button), blur/unblur of the form, loading card with spinner and kill button, error cards.

## Data
- `submissions` (new document, mongoengine `Submission`):
  `courseid` str, `taskid` str, `username` [str] (1 user or all group members), `input` GridFS ObjectId (BSON of the input dict), `status` `"waiting"`, `submitted_on` Date (UTC), `user_ip` str, `response_type` `"rst"` (deprecated default), `grade` 0.0, `result` `"crash"` (default until done), `text` `""`, `custom` {}, `problems` {}, `tests` {}, `jobid` str|null, optional `lti_version` + LTI outcome fields, later `ssh_*` (TASK-12), `archive` (TASK-23), `stdout`/`stderr`, `state`.
- Stored input example (`mcq_single`):
  `{"capital":"0","@username":"task_alice","@email":"task_alice@x.org","@lang":"en","@time":"2026-10-14 05:33:40.022576+00:00","@attempts":"2","@random":[],"@state":"{\"capital\": \"\"}"}`.
- GridFS: `fs.files {_id, chunkSize: 261120, length, uploadDate}` + `fs.chunks` (no filename/metadata).
- `ClientNewJob` (msgpack to backend `tcp://backend:2000`): see main flow 2.8.8. `debug` is `False`, `True` (admin) or `"ssh"`.
- Config: `allowed_file_extensions`, `max_file_size`.

## Permissions & security
- Only users registered in the course (or staff) can submit; on previewable courses (`allow_preview: true`) non-registered users can view the task but not submit.
- Submissions are POST requests protected by the app's origin check.
- The `@` metadata (`@username`, `@email`, `@lang`, `@time`, `@attempts`, `@random`, `@state`) is always set by the server, overwriting any posted value; `@action` and `@debug-mode` are removed from the input.
- Refused submissions (not allowed, outdated random inputs, invalid answers, already waiting) are answered with HTTP 200 and a JSON body `{"status": "error", "text": …}`; an anonymous user gets HTTP 403.
- At most one waiting submission per user and task, even with parallel requests.
- Staff bypass every restriction (deadline, tokens, groups); admin jobs always run with `debug=True` (stdout/stderr stored).
- `user_ip` = the client address seen by the server (`event.getClientAddress()`).

## Acceptance tests
- Valid submission returns `{"status":"ok","submissionid":…, "remove":[], "text":"<b>Your submission has been sent...</b>"}`; a `submissions` doc with `status:"waiting"` and a GridFS input exist right after; input contains `@username/@email/@lang/@time/@attempts/@random/@state`.
- `@attempts` = previous `user_tasks.tried + 1`; `@state` = `user_tasks.state`.
- Second POST while the first is waiting → error "A submission is already pending for this task!" (use `outcomes` mode `sleep`).
- Closed task, group task without group, exhausted tokens → "You are not allowed to submit for this task."
- Inconsistent answers → generic error and **no** document/GridFS file created.
- Admin submission → `ClientNewJob.debug == True`, `stdout`/`stderr` stored; student submission → `debug == False`, `stdout`/`stderr` null/empty.
- Submissions from unregistered users (e.g. `task_dave` on `task_preview/preview_mcq`) are rejected.
