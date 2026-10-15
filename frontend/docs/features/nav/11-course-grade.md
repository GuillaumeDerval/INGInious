# Course grade computation (weighted average)

- **ID**: NAV-11
- **Actors**: student (sees own grade); staff (statistics/student lists reuse the same computation)
- **Routes**: shown on GET /course/<courseid> and GET /group/<courseid>; reused by course admin pages and plugins
- **Depends on**: NAV-14 (weight/accessibility), task submission feature (maintains `user_tasks`)
- **Legacy code**: `legacy/inginious/frontend/task_dispensers/toc.py:L85-L105`, `task_dispensers/__init__.py:L43-L49`, `pages/course.py:L74-L82`, `user_manager.py:L399-L452` (`get_course_caches`), `templates/course.html:L16-L21`, `templates/group.html:L13-L19`

## Use case
Students see a single percentage summarising their progress in the course, where each task
contributes proportionally to its weight.

## Preconditions
Course loaded; `user_tasks` documents exist for tasks the user opened/submitted.

## Main flow
1. Candidate tasks = **all task folders of the course** (`course.get_tasks()`), not only those in the toc.
2. For each candidate task with `accessibility.after_start()` (for that user): denominator += `weight` (default 1).
3. For each `user_tasks` doc of the user (course page: filtered to `taskid ∈ user_task_list`; `get_course_caches`: filtered to readable task ids) whose task is `after_start()`: numerator += `grade × weight`.
4. `grade = round(numerator / denominator)` (Python `round`, half-to-even) if denominator > 0, else `0`. Integer 0–100.
5. Display: h3 "Current grade" + Bootstrap progress bar (course page: `progress-bar bg-success`, label `"<N> %"`; group page: `progress-bar progress-bar-success`, label `"<N>%"`, value from `get_course_cache(username, course)["grade"]`).

## Rules worth testing
- Tasks after their deadline still count; tasks not yet started do not.
- A task configured as accessible but **absent from the toc** counts (invisible to the student but in the denominator and numerator).
- Weight 0 tasks do not influence the grade.
- Combinatory test: only the user's drawn tasks count (others are `AccessibleTime(False)`).
- `user_tasks.grade` is the grade of the submission selected by `evaluation_mode` (best/last), maintained by the submission manager.
- Staff/superadmin also get a grade (computed the same way from their own user_tasks).

## Data
`user_tasks {username, courseid, taskid, grade: float, succeeded: bool, ...}`; `course.yaml` dispenser config (`weight`, `accessibility`).

## Permissions & security
Read-only; own data only.

## Acceptance tests
- navopen / nav_alice with user_tasks t1=100, t2=50, tpast=100, textra=100, tfuture=100, tsoft absent → 77 % ((100·1 + 50·3 + 0·0 + 100·1 + 0·1 + 100·5) / (1+3+0+1+1+5) = 850/11 = 77.27).
- Same user on /group/navopen shows "77%".
- No visible task (denominator 0) → 0 %.
- Rounding: numerator/denominator = 76.5 → 76, 77.5 → 78 (half-to-even) — the rewrite must use the same rounding.
- Unit test of `get_course_grades` for several users at once (statistics use it with many usernames).
