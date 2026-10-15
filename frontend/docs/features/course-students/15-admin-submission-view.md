# Staff view of a single submission

- **ID**: CSTU-15
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /submission/<submissionid>` (endpoint `submissionpage`); `POST` same (CSTU-14 replays); AJAX to the task page: `POST /course/<courseid>/<taskid>` with `@action=load_submission_input` / `@action=check`; file download `GET /course/<courseid>/<taskid>?submissionid=<id>&questionid=<pid>`
- **Depends on**: CSTU-13 (download), CSTU-14 (replay), TASK-01/TASK problem renderers (`show_input`, `load_input_<type>`, `load_feedback_<type>`), TASK tags
- **Legacy code**: `pages/course_admin/submission.py:L15-L76`, `templates/course_admin/submission.html`, `static/js/task.js:L333-L380` (`waitForSubmission`), `L525-L560` (`displayTaskStudentAlertWithProblems`), `L643-L672` (`loadOldSubmissionInput`), `pages/tasks.py:L82-L110,L230-L272,L275-L372` (`submission_to_json`), `submission_manager.py:L540-L568` (`get_feedback_from_submission`)

## Use case
A teacher opens a submission to see exactly what the student answered and what feedback they
got (including hidden feedback, misconception tags and auto tags), download it, and re-run it.

## Preconditions
- Logged in; `submissionid` valid; staff rights on **the submission's course** (taken from the document).

## Main flow
1. `get_submission(id)`; invalid ObjectId ⇒ intended 403 "Invalid ObjectId." but legacy raises a mongoengine ValidationError ⇒ **500** (verified); unknown id ⇒ `DoesNotExist` ⇒ **500** (verified; intended 404 "This submission doesn't exist.").
2. `get_course_and_check_rights(submission.courseid, submission.taskid)` ⇒ 403 for non-staff (including the student who owns it, verified) and if the task no longer exists.
3. `get_feedback_from_submission(show_everything=True)` parses `text` and per-problem feedback as RST with hidden blocks shown.
4. `to_display` = task problems `{id, name, defined: True}` + input keys not in the task `{id, name: id, defined: False}` (this includes the meta inputs `@lang`, `@time`, `@state`, `@email`, `@username`, `@attempts`, `@random`, which are shown as "This problem id is not defined in the task." — verified; the rewrite may hide `@`-keys).
5. Render: title "<task> - <realname> - <course>"; breadcrumb course › admin › students › `<realname of first username>` (→ CSTU-09) › task (→ submissions filtered by user+task) › submission id; h2 `Submission <first 10 chars of id> - "<task name>" - <realname> (<username>)`.
6. Info box "This page show what was shown to the student when (s)he made his/her submission." with:
   "Click here to hide/display context informations" (toggles `.student_view` = task context RST);
   "Download full submission" (only if `result` present, → `?download_submission=<id>` on the submissions page);
   admin: "Replay submission" (`replay`); all staff: "Replay as <realname>" (`replay-copy`); admin: "Replay/debug as <realname>" (`replay-debug`);
   plugin hook `submission_admin_menu(course, task, submission)` HTML entries.
7. Tags section: course tags present in `tests` that are visible to students or (admin) all; type 0 blue badge, type 1 red badge hidden (`display:none`, revealed by JS `updateMainTags` when the test is true).
8. Form `#task` (action = task page URL) with one card per `to_display` entry: "Question <n>: <name>", download icon (→ task page `?submissionid=&questionid=` which returns the raw input value as `text/plain`, or the uploaded file as attachment — PDF inline), body = `problem.show_input(lang, username)` (disabled inputs) or warning text.
9. JS: `problems_types = {pid: type}`; on ready `loadOldSubmissionInput(id)` (POST `@action=load_submission_input` ⇒ JSON with `input`, file values blanked; fills the inputs) and `waitForSubmission(id)` (POST `@action=check` every 1 s while `status == "waiting"`, then shows the global alert — title "Your answer passed the tests! Your score is X%." / "There are some errors…" / timeout / overflow / killed / internal error, + "[Submission #id - <time>]" — the RST feedback, per-problem feedback, tags; for admins the JSON also has `debug` = submission doc with strings cut to 1000 chars).

## Alternative / error flows
- Submission still waiting ⇒ spinner/queue position text until done.
- Malformed problem feedback ⇒ that problem shows "Feedback is badly formatted." with status crash.

## Data
Reads `submissions`, GridFS input; task YAML from disk.

## Permissions & security
- `/submission/<id>` is scoped to the submission's course (staff of another course get 403).
- The task-page AJAX endpoints used by this page (`load_submission_input`, `check`, input/file download) only return a
  submission that belongs to the URL course and task (see also TASK-04/TASK-08).
- Feedback HTML is rendered from RST and sanitized.

## Acceptance tests
- Tutor/admin of the submission's course ⇒ 200 with inputs pre-filled and feedback shown; student owner ⇒ 403; staff of another course ⇒ 403; unknown id ⇒ 404; invalid id ⇒ 400/404.
- Admin sees 3 replay buttons, tutor sees only "Replay as …".
- "Download full submission" absent for waiting submissions.
- Inputs not defined in the task are listed with the warning; hidden RST feedback blocks visible to staff.
- AJAX load/check/download with a submission id from another course ⇒ rejected.
