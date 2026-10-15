# Reset a student's task state

- **ID**: CSTU-10
- **Actors**: course admin, tutor, superadmin
- **Routes**: `POST /admin/<courseid>/student/<username>` with `taskid` (and `reset`)
- **Depends on**: CSTU-09, TASK state (`@state` input / `feedback-state` in grading containers)
- **Legacy code**: `pages/course_admin/student_info.py:L21-L28`, `models/user_task.py:L27-L29` (`reset_state`), `templates/course_admin/student_info.html:L84-L123`

## Use case
Some tasks keep a persistent per-student "state" between submissions (e.g. progressive exercises,
the `@state` input sent to the grader). The teacher clears it so the student restarts from scratch.
This does **not** clear grades, tries or submissions.

## Preconditions
Staff rights; a `user_tasks` document `{username, courseid, taskid}` must exist.

## Main flow
1. Row button "Reset state" (eraser) opens `#reset_modal`: "Reset State" / "This will reset the state for <task name>. Are you sure ?"; JS copies `data-task_id` into hidden `taskid`.
2. Submit button `name="reset"` "Reset" → POST form `taskid=<taskid>&reset=`.
3. Server: `UserTask.objects.get(username, courseid, taskid).reset_state()` ⇒ `state = ""` then `save()`.
4. Re-render CSTU-09 page (no message).

## Alternative / error flows
- No `user_tasks` doc (task never viewed) ⇒ **500** (DoesNotExist) (verified).
- Missing `taskid` ⇒ 400.
- Side effect of mongoengine `save()`: the document is re-serialised; verified result: the `state` key is **removed** from the document (empty string not stored) and `tokens.date` disappeared when it was absent before. The rewrite should `$set: {state: ""}` (readers must treat missing `state` as "").

## UI elements
Modal + button described above. Note: the reset button is shown for every task, including not-viewed ones.

## Data
`user_tasks.state` (string) cleared. Nothing else.

## Permissions & security
Staff (tutors allowed). No check that `<username>` is registered. The POST is protected against cross-site request forgery.

## Acceptance tests
- user_task with `state: "X"` ⇒ after POST, state empty (or absent), grade/tried/succeeded/submissionid unchanged.
- Task never viewed ⇒ graceful error/no-op (legacy 500).
- Student → 403.
