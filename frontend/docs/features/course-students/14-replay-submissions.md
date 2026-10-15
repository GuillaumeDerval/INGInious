# Replay submissions (re-grade), replay as copy, replay in SSH debug

- **ID**: CSTU-14
- **Actors**: course admin, superadmin (replay, bulk replay, debug replay); tutor (replay-copy)
- **Routes**:
  - `POST /admin/<courseid>/submissions` with `replay` + `displayed_selection` (bulk);
  - `POST /admin/<courseid>/submissions` with `replay_submission=<id>` (AJAX single, JSON response);
  - `POST /submission/<submissionid>` with `replay`, `replay-copy` or `replay-debug`.
- **Depends on**: CSTU-11, CSTU-15, backend job protocol (`client.new_job`), TASK submission flow & SSH debug (task area), user stats (`update_user_stats`)
- **Legacy code**: `pages/course_admin/submissions.py:L28-L35,L62-L70`, `pages/course_admin/submission.py:L38-L52`, `submission_manager.py:L55-L102` (`_job_done_callback`), `L149-L212` (`replay_job`), `user_manager.py:L520-L552` (`update_user_stats`), `templates/course_admin/submissions.html:L82-L84,L184-L187,L260-L276`, `templates/course_admin/submission.html:L60-L78`

## Use case
After fixing a grader bug the teacher re-grades existing submissions (one or all selected ones),
keeping their original date. Staff can also re-submit a student's input under their own name to
see the result live on the task page, or with an SSH debug session.

## Preconditions
- Staff rights; admin rights for in-place replay (UI and bulk server check).
- Backend connected; the task still exists in the course.

## Main flow — in-place replay (`replay_job(copy=False)`)
1. Bulk: table header "Replay current selection" (admins only) ⇒ POST `replay` with `displayed_selection`; server rejects non-admins with **403** "You don't have admin rights on this course."; replays every submission of the whole selection (all pages); message "<N> selected submissions were set for replay." (yellow alert).
2. Single (AJAX, admins only in UI): row button `a.replay[data-submissionid]` ⇒ `$.ajax POST /admin/<c>/submissions` body `replay_submission=<id>` ⇒ response `{"status": "waiting"}` (`application/json`); JS sets the row status text to "Waiting (0.0%)" and class `table-warning`. Unknown id ⇒ 404 "This submission doesn't exist.".
3. Submission page: button `replay` "Replay submission" (admins; silently ignored for tutors) ⇒ page re-rendered.
4. `replay_job`: input = decoded BSON input (unchanged, original `@username`, `@attempts`… kept); if an archive exists it is deleted from GridFS; `submissions.update({_id}, {$set: {status: "waiting"}, $unset: {result, grade, text, tests, problems, archive, state, custom}})`; job sent to the backend with **priority 1**, `job_info = {course, task, environment_type, environment}`, launcher `"Frontend - <usernames list>"`, debug False; then `$set: {jobid, last_replay: now (local tz)}`. Log "Replaying submission …".
5. On completion `_job_done_callback(newsub=False)`: stores result/grade/text/tests/problems/custom/state/stdout/stderr/archive, `status = done|error`, unsets jobid/ssh_*; for each member `update_user_stats(newsub=False)`: recomputes the evaluation submission of the user_task — best mode: highest grade then most recent; last mode: most recent — and copies its `succeeded`, `grade`, `state`, `submissionid` (tries/tokens untouched). Hook `submission_done`; LTI grade re-sent if `lti_version`.

## Main flow — replay as copy (`replay-copy`, allowed to tutors) and debug (`replay-debug`, admins)
1. Buttons on `/submission/<id>`: "Replay as <session realname>" and (admins) "Replay/debug as <realname>".
2. `replay_job(copy=True[, debug="ssh"])`: new `submissions` document `{username: [staff], courseid, taskid, submitted_on: now, status: "waiting", user_ip}`; input copied with `@attempts = staff user_task.tried + 1`, `@username`, `@email`, `@lang` of the staff member; job priority 1, debug `ssh` for replay-debug (SSH credentials stored in `ssh_host/port/user/password` by the SSH callback).
3. Redirect **302 → `/course/<courseid>/<taskid>`** where the staff member sees the result (and SSH info) in his history.
4. Completion with `newsub=True` ⇒ staff user_task `tried+1`, `tokens.amount+1`, evaluation updated per mode.

## Alternative / error flows
- **Legacy bug (verified)**: in-place replay calls `submission.save()` after deleting the archive; mongoengine validation fails when
  `problems` contains new-style `[status, feedback]` lists or `tests` contains booleans (i.e. almost every graded submission) ⇒
  **HTTP 500**, and the archive has already been deleted from GridFS (data loss: later downloads of that submission fail). Only
  submissions with empty `problems` and `tests` can be replayed in-place. The rewrite must not reproduce this.
- replay-copy when the staff member never opened the task (no `user_tasks` doc) ⇒ 500 (verified). Should upsert/`user_saw_task` first.
- Task removed from course ⇒ 500/403.
- Backend unavailable ⇒ job ends with `result: crash`, `text: "Environment not available."` (observed).
- A submission already waiting can be replayed again (no guard).

## UI elements
Refresh icons in table header and rows (admins), three buttons on the submission page (see CSTU-15).

## Data
`submissions` ($set/$unset as above, new docs for copies), GridFS (archive delete/put, input put for copies), `user_tasks` (stats), backend job messages.

## Permissions & security
- Single (AJAX) and bulk replay are admin-only and scoped to the URL course: a submission of another course is not found.
- `/submission/<id>` checks staff rights on the submission's own course; `replay`/`replay-debug` require admin.
- The POSTs are protected against cross-site request forgery; in-place replays (expensive) are limited to admins.

## Acceptance tests
- Admin single replay ⇒ JSON `{"status":"waiting"}`, document reset (no result/grade/text/tests/problems/archive/state/custom), `last_replay` set, later completed with new feedback; user_task evaluation recomputed (best vs last mode).
- Tutor single replay / bulk replay ⇒ 403. Foreign-course submission id ⇒ 404 ("No submission selected.").
- Bulk replay with N selected (multi-page) ⇒ N jobs, message "N selected submissions were set for replay.".
- Replay of a submission with boolean tags and list problems succeeds (legacy 500 regression).
- replay-copy by tutor ⇒ new submission owned by the tutor with copied input, 302 to task page; works even if tutor never opened the task.
- replay-debug or in-place replay from the submission page by a tutor ⇒ 403; replay-debug by admin ⇒ ssh debug job, redirect to the task page.
