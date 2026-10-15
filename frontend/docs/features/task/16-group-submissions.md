# Group submissions

- **ID**: TASK-16
- **Actors**: student in a group, course admin (configures), tutor/admin (submit as themselves)
- **Routes**: `GET`/`POST /course/<courseid>/<taskid>` (groups themselves are managed on `/group/<courseid>` and in course admin — other features)
- **Depends on**: TASK-08, TASK-09, TASK-14, COURSE groups (collection `groups`)
- **Legacy code**: `legacy/inginious/frontend/pages/tasks.py:L125-L130`, `submission_manager.py:L104-L135`, `user_manager.py:L571-L607`, `task_dispensers/util.py:L36-L56`, `templates/task.html:L152-L171,L408-L415`

## Use case
Project-like tasks done by a team: one member submits for the whole group; everybody in the group
gets the submission in their history and the same grade.

## Preconditions
`course.yaml → dispenser_data.config.<taskid>.group_submission: true`; the student belongs to a
`groups` document of the course (`{courseid, description, size, students:[...], audiences:[...]}`).

## Main flow
1. Page: "Submitting as" shows "**Group**" and the group link "Group : <description>"; template var `students` = group members (non-admin).
2. Without group: submit button disabled "Please register in a group"; POST → "You are not allowed to submit for this task.".
3. Submit (non staff): `obj.username = group.students` (all members) and, unless a problem is named `group`, input `@username = "alice,bob"`, `@email = "alice@x,bob@x"` (comma-joined; overwrites the single-user values).
4. Pending check is done on the submitter only (`username=<me>`, status waiting) — since the submission lists all members, any member's new submission is blocked while a group submission waits.
5. Completion: `update_user_stats` for each member → each member's `user_tasks.tried`, `tokens`, and evaluated submission updated independently (a member whose best is higher keeps it).
6. Tokens: all members' tokens must be available (TASK-14).
7. History: every member sees the submission (query `username=<me>` matches arrays).

## Alternative / error flows
- Staff (tutor/admin) submitting on a group task → individual submission (`username=[staff]`), no group lookup.
- A student in several groups of the same course (should not happen) → `Group.objects.get(...)` raises `MultipleObjectsReturned` → JSON error with the exception text.
- Group changes after submission do not change existing submissions.

## UI elements
"Submitting as Group", group link, disabled button message.

## Data
`submissions.username = ["task_alice","task_bob"]`; input `@username: "task_alice,task_bob"`, `@email: "task_alice@x.org,task_bob@x.org"`; `user_tasks` of each member updated.

## Permissions & security
The group membership and token checks are done for the signed-in user (session username) and, for group tasks, every member of their group.

## Acceptance tests
- `task_showcase/group_task`: `task_alice` (group "Team A" with `task_bob`) submits Yes → the submission has both usernames; `task_bob`'s page shows it in the history, `user_tasks` of both have `tried: 1`, `grade: 100`, same `submissionid`.
- `task_carol` (no group) → disabled "Please register in a group"; forced POST → "You are not allowed to submit for this task.".
- Admin submitting on `group_task` → individual submission.
