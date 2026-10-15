# Per-task dispenser settings (weight, accessibility, categories, limits) — runtime semantics

- **ID**: NAV-14
- **Actors**: student (affected), course admin (edits them in the course-admin task list editor)
- **Routes**: none of its own; read by /course, task pages, submission manager, statistics, upcoming tasks
- **Depends on**: course-model.md §5, course admin "task list / structure editor" feature (writing side)
- **Legacy code**: `legacy/inginious/frontend/task_dispensers/util.py:L13-L208,L346-L379`, `task_dispensers/toc.py:L19-L80,L142-L158`, `task_dispensers/__init__.py:L4-L132`, `user_manager.py:L520-L607`

## Use case
Teachers configure per course (not per task file) how each task is graded and when it is
open; the student-facing pages derive visibility, deadlines and grades from it.

## Preconditions
`dispenser_data.config` in `course.yaml` (keyed by task id).

## Main flow (TaskDispenser API used by the rest of the app)
| Method | Returns | Used by |
|---|---|---|
| `get_accessibility(taskid, username)` / `get_accessibilities(taskids, usernames)` | `AccessibleTime` per task/user (toc: same for all users; combinatory: per-user draw; contest: contest window) | visibility, submit permission, deadlines display, upcoming tasks |
| `get_user_task_list(usernames)` | `{username: [taskid with after_start()]}` over all task folders | course page list, grade, course caches |
| `get_weight(taskid)` | number, default 1 | grade, weight badge |
| `get_evaluation_mode(taskid)` | `"best"` (default) / `"last"` | `update_user_stats` picks the submission stored in `user_tasks` |
| `get_no_stored_submissions(taskid)` | int, 0 = unlimited | submission manager purge |
| `get_submission_limit(taskid)` | `{amount, period}`; `{-1,-1}` = unlimited | `task_can_user_submit` tokens check (`user_tasks.tokens.amount` vs `amount`, reset after `period` hours) |
| `get_group_submission(taskid)` | bool (combinatory: always false) | group submissions (student must be in a group) |
| `get_categories(taskid)` / `get_all_categories()` | list / set over toc tasks | NAV-12, task page "Category tags", submissions filter |
| `get_course_grade(s)` | NAV-11 | course page, caches, statistics |
| `get_ordered_tasks()` | OrderedDict of toc tasks (toc order, existing only) | admin pages, exports |
| `get_dispenser_data()` | the `SectionsList` | admin editor |
| `has_legacy_tasks()` / `import_legacy_tasks()` | detect/import legacy task.yaml fields | admin "migrate" action |

Validation (`get_value`) is applied to every task at course load; any invalid value makes the whole course unloadable with "In taskid <id> : <message>":
- weight: "The weight value must be a numeric >= 0"
- no_stored_submissions: "The store submission must be an integer > 1" (actually ≥ 0)
- evaluation_mode: "The evaluation mode must be either best or last but is <v>"
- categories: "All categories must have a name but are :<list>"
- submission_limit: "Invalid submission limit" / "You have given a period but no amount for the submission limit" / "Submission limit values must be higher than or equal to -1"
- accessibility: "Invalid task accessibility : <msg>"
- group_submission: "Invalid submission mode"

## Alternative / error flows
- **Default accessibility is `false`**: a task folder without config entry is invisible and not submittable for students. The bundled `tutorial` course (legacy list-format dispenser data, settings still in task.yaml) therefore shows an empty "List of exercises" section until an admin runs "migrate tasks" — the rewrite must keep this behaviour (or migrate), not silently use task.yaml `accessible`.
- Config entries for non-existing task folders are dropped (in memory) at load.

## Data
`course.yaml` → `dispenser_data.config.<taskid>.{weight, accessibility, categories, evaluation_mode, no_stored_submissions, submission_limit{amount,period}, group_submission}`; `user_tasks` (grade, succeeded, tokens{amount,date}, submissionid, state, tried).

## Permissions & security
Staff bypass `task_can_user_submit` entirely (no deadline/token/group checks) and `task_is_visible_by_user`.

## Acceptance tests
- Course load fails (404 on /course) for each invalid value listed above.
- Task without config → not listed, task page "Task unavailable" for a student, visible for staff.
- `accessibility: "2020-01-01 / 2021-01-01"` → listed with "deadline reached"; submit refused for students.
- `accessibility: "2030-01-01 00:00:00"` → not listed, not visible.
- `accessibility: "2020-01-01 / 2026-10-20 12:00:00 / 2027-01-01"` → soft deadline 2026-10-20 12:00 shown on task page/upcoming tasks; still open until 2027-01-01.
- Tutorial course renders no task before migration.
