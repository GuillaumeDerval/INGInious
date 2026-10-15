# "Last tried exercises" widget

- **ID**: NAV-21
- **Actors**: student, staff
- **Routes**: rendered in GET /mycourses, /course/<courseid>, /group/<courseid>, /coming_tasks
- **Depends on**: task submission feature (`submissions` collection)
- **Legacy code**: `legacy/inginious/frontend/submission_manager.py:L599-L645` (`get_user_last_submissions`), `templates/mycourses.html:L23-L47`, `templates/course.html:L23-L44`, `templates/group.html:L21-L43`, `plugins/upcoming_tasks/templates/coming_tasks.html`

## Use case
Quick access to the tasks the user worked on most recently, with the outcome of the last attempt.

## Preconditions
Logged in.

## Main flow
1. Query: `submissions` where `username` (array) contains `session.username` plus a page-specific filter:
   - /mycourses, /coming_tasks: `courseid ∈ open courses`;
   - /course: `courseid = <id>` and `taskid ∈ user's visible tasks`;
   - /group: `courseid = <id>` and `taskid ∈ all task folders`.
2. Aggregation: group by `(courseid, taskid)` keeping `max(submitted_on)` and the list of `{_id, result, status, courseid, taskid, submitted_on}`; keep the submission(s) whose `submitted_on` equals the max; sort by `submitted_on` desc; limit 5; return the first submission of each group. So: **one entry per task** (its most recent submission), the 5 most recently attempted tasks.
3. Each entry is a link to `/course/<courseid>/<taskid>` with class:
   - `status == "done"` and `result == "success"` → `list-group-item-success` (green);
   - `status == "done"` and `result == "save"` → `list-group-item-info`;
   - `status == "waiting"` → `list-group-item-warning`;
   - otherwise (failed, crash, error, killed, overflow, timeout...) → `list-group-item-danger`.
4. Label: on /mycourses and /coming_tasks "**<course name>**: <task name>" (entries whose task cannot be loaded are dropped); on /course and /group just the task name.
5. Empty → disabled item "No submissions" (`submission-empty`).

## Data
`submissions {username: [str], courseid, taskid, submitted_on: date, status: "done"|"error"|"waiting", result: str}` (read only).

## Permissions & security
Own submissions only (also group submissions where the user is listed).

## Acceptance tests
- nav_alice after submitting t2 then t3 of navopen (both crashed): /course/navopen lists "T3 weight zero", "T2 hard" in that order, both `list-group-item-danger`; /mycourses lists "NAV Open course: T3 weight zero", "NAV Open course: T2 hard".
- Submitting t2 again moves it to the top; at most 5 entries; one entry per task.
- A success submission renders green, a waiting one yellow, a "save" one blue.
- User with no submissions → "No submissions".
