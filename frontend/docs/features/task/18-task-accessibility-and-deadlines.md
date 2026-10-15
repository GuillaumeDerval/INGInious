# Task accessibility, visibility and deadlines

- **ID**: TASK-18
- **Actors**: student, staff, course admin (configures)
- **Routes**: `GET`/`POST /course/<courseid>/<taskid>`, `GET /course/<courseid>/<taskid>/<path>`
- **Depends on**: TASK-01, TASK-08, COURSE (course accessibility, TOC dispenser)
- **Legacy code**: `legacy/inginious/frontend/accessible_time.py`, `task_dispensers/util.py:L182-L204`, `task_dispensers/toc.py:L71-L74`, `user_manager.py:L554-L607`, `templates/task.html:L27-L44,L129-L138,L406-L407`

## Use case
Teachers open a task at a given date, close it at a hard deadline and optionally show a soft
deadline (displayed deadline) before the hard one.

## Preconditions
`course.yaml → dispenser_data.config.<taskid>.accessibility` = `true` | `false` (default!) |
`"start"` | `"start / end"` | `"start / soft_end / end"` (formats in task-model §6).

## Main flow
1. **Visible** (`task_is_visible_by_user`): staff always; otherwise course open to the user and `accessibility.after_start()` (now ≥ start). Not visible → `task_unavailable.html` (HTTP 200, "Error 403 Task unavailable").
2. **Open for submission** (`task_can_user_submit`): `start ≤ now ≤ end` (hard end).
3. Deadline row: never accessible → "It's too late"; soft end set → `show_time(soft_end)`; else "No deadline"; row in red (`list-group-item-danger`) when open but past the soft end.
4. Staff see warnings when the course is not open to non-staff or the task is not yet started.
5. Prev/next navigation and the course grade only consider tasks with `after_start()`.

## Alternative / error flows
- After the hard end: task still visible, button disabled "The deadline is over, you cannot submit anymore"; POST → "You are not allowed to submit for this task.".
- Accessibility `false` (also the default when a task has no config entry) → never visible to students ("It's too late" for staff).
- Dates are interpreted in the server timezone.
- The `contests` plugin can override accessibility via hooks (plugin feature).

## UI elements
Deadline row, staff warnings, disabled submit messages.

## Data
Course config only.

## Permissions & security
Public task files (TASK-22) use the same visibility rule as the task page; files of `$common/public` only require access to the course.

## Acceptance tests
- `future_task` (starts 2099): student → task unavailable; staff → page + warning "This task is currently invisible for students…".
- `never_task` (`false`): student → unavailable.
- `closed_task` (2020 → 2021): visible, Deadline = 2021-01-01, disabled "The deadline is over…", POST refused.
- `soft_deadline` (soft 2021, hard 2099): Deadline shows 2021-01-01 in red, submission accepted.
- A task folder listed in the TOC without config is invisible to students.
