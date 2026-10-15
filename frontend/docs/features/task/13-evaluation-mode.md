# Evaluation mode (which submission counts: best / last)

- **ID**: TASK-13
- **Actors**: course admin (configures), student (affected)
- **Routes**: none (setting in `course.yaml`, used by TASK-09 and TASK-24)
- **Depends on**: TASK-09, COURSE-ADMIN (task settings in the TOC editor)
- **Legacy code**: `legacy/inginious/frontend/task_dispensers/util.py:L109-L129`, `task_dispensers/toc.py:L59-L61`, `user_manager.py:L520-L552`, `templates/task.html:L178-L195`

## Use case
Teachers choose whether the grade of a task is the best grade ever obtained or the grade of the
latest submission (e.g. for exams where the last answer is final).

## Preconditions
`course.yaml → dispenser_data.config.<taskid>.evaluation_mode` ∈ {`best` (default), `last`}. Any other value makes the course config invalid.
**There is no `student` mode in this version** (students cannot pick their evaluated submission; the legacy `evaluate: student` of older INGInious versions is rejected by `EvaluationMode.get_value`).

## Main flow
1. New submission completed (`update_user_stats`, `newsub=True`): `tried += 1`, `tokens.amount += 1`; then
   - `last`: always update `user_tasks.{succeeded, grade, state, submissionid}` with the new submission;
   - `best`: update only if `user_tasks.grade <= new grade` (equal grade → the newer one wins).
2. Replay without copy (`newsub=False`, TASK-24): recompute from scratch — `best`: submission with the highest grade (ties: most recent), `last`: most recent; if no submission is found but the replayed one is the evaluated one, refresh its values.
3. The task page shows "Best submission" / "Last submission" and the evaluated submission (TASK-10); the course grade uses `user_tasks.grade` × weight (course feature).

## Alternative / error flows
- Error/crash submissions also go through the rule (in `last` mode a crash at 0% replaces a 100% grade; `succeeded` becomes false).
- Group submissions update the `user_tasks` of every member independently (TASK-16).

## UI elements
"For evaluation" box label.

## Data
`user_tasks.submissionid` (ObjectId|null), `grade` (float), `succeeded` (bool), `state` (str).

## Permissions & security
None specific.

## Acceptance tests
- `task_showcase/eval_last`: submit Yes (100) then No (0) → `user_tasks.grade == 0`, `succeeded == false`, `submissionid` = the second; label "Last submission".
- Any best-mode task (e.g. `mcq_multiple`): 100 then 0 → grade stays 100, evaluated = first; 0 then 0 → evaluated = second (ties go to the newest).
- Setting `evaluation_mode: student` in course.yaml makes the course config invalid (rewrite: validation error).
