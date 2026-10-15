# Replaying a submission (re-grading)

- **ID**: TASK-24
- **Actors**: course admin (replay in place, replay with SSH debug), tutor (replay as copy)
- **Routes**: `POST /submission/<submissionid>` with `replay` / `replay-copy` / `replay-debug` (course-admin submission page, documented by the course-admin area); bulk replay from the submissions list (course admin)
- **Depends on**: TASK-08, TASK-09, TASK-13
- **Legacy code**: `legacy/inginious/frontend/submission_manager.py:L149-L212`, `pages/course_admin/submission.py:L38-L52`, `user_manager.py:L533-L552`

## Use case
After fixing a grading script, staff re-run existing submissions (keeping their id/date/input), or
copy a student's submission into their own account to debug it.

## Main flow
`replay_job(course, task, submission, dispenser, copy=False, debug=False)` (logged-in user required):
1. **In place** (`copy=False`): delete the old GridFS archive; `submissions.update({_id}, {$set: {status:"waiting"}, $unset: {result, grade, text, tests, problems, archive, state, custom}})`; input reused **unchanged** (old `@attempts`, `@time`, `@state`…).
2. **Copy** (`copy=True`): new submission `{username:[<current user>], courseid, taskid, submitted_on: now (local tz), status:"waiting", user_ip}` with the input of the original but `@attempts = str(my user_task.tried + 1)`, `@username`, `@email = session.email`, `@lang = session.language` of the current user.
3. `client.new_job(priority=1, …, launcher_name="Frontend - <submission.username>", debug, ssh_callback)` (lower priority than live submissions which use 0); callback `newsub = copy`.
4. `submissions.update({_id}, {$set: {jobid, last_replay: now}})`.
5. Completion: copy → normal new-submission stats for the copier (tries, tokens, evaluated); in place (`newsub=False`) → `update_user_stats` recomputes the evaluated submission among **all** of the user's submissions (best: highest grade then newest; last: newest) without incrementing `tried`/tokens.

## Alternative / error flows
- `replay-debug` = copy with `debug="ssh"` (admins), then redirect to the task page where the SSH info appears (TASK-12).
- `replay-copy` redirects to the task page; `replay` re-renders the submission page.
- Replay of a group submission: in place keeps all usernames; the stats update loops over every member.

## UI elements
Buttons on the course-admin submission page (other feature).

## Data
`submissions.last_replay` (Date), `jobid`, cleared result fields; copies are normal submissions.

## Permissions & security
`replay` and `replay-debug` require admin; `replay-copy` allowed for tutors (staff of the course).

## Acceptance tests
- Replaying in place a `code_python` submission after editing `run` changes its result/grade, keeps `_id`/`submitted_on`, sets `last_replay`, does not change `tried`.
- Replay copy as tutor creates a new submission owned by the tutor with `@attempts` from the tutor's `user_tasks`.
