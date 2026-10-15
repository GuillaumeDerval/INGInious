# REST API v0: list tasks of a course

- **ID**: SITE-09
- **Actors**: API client (registered student, staff, superadmin)
- **Routes**: GET /api/v0/courses/<courseid>/tasks, GET /api/v0/courses/<courseid>/tasks/<taskid>
- **Depends on**: SITE-06, SITE-07, TASK (task.yaml format, problem types)
- **Legacy code**: `pages/api/tasks.py:L14-108`, `common/tasks_problems.py:L112-114` (`get_original_content`)

## Use case
A client retrieves the statement of the tasks (context, problems) and the user's status/grade on
each, to display or answer them outside the web UI.

## Main flow
1. Load course (`Course.get`) → 404 `{"error": "Course not found"}` on failure.
2. `course_is_open_to_user(course, username, lti=False)` else 403 `{"error": "You are not registered to this course"}`.
3. All tasks visible to the user, or the single `taskid` (404 `{"error": "Task not found"}`, also for a hidden task).
4. For each task, using `user_tasks` cache (`get_task_cache(username, courseid, taskid)`):
   ```json
   {"id": "mcq1", "name": "MCQ one", "authors": "SITE", "contact_url": "",
    "status": "notviewed", "grade": 0.0, "context": "Pick the right answer.",
    "problems": [
      {"type": "multiple_choice", "name": "Question 1", "header": "What is 1+1?", "limit": 0,
       "choices": {"0": "2", "1": "3", "2": "4"}, "id": "q1"},
      {"type": "match", "name": "Question 2", "header": "Type yes", "id": "q2"}]}
   ```
   - `name`, `authors` (string as in task.yaml, translated; despite the docstring it is not a list),
     `contact_url` (raw format string or ""), `context` (RST source, after the `task_context` hook);
   - `status`: `"notviewed"` (no `user_tasks` doc), `"notattempted"` (`tried == 0`),
     `"succeeded"` (`succeeded` true), else `"failed"`;
   - `grade`: `user_tasks.grade` or `0.0`;
   - `problems`: list (task.yaml order) of the **raw problem dict** (shallow copy of task.yaml content,
     untranslated, ParsableText converted back to source) plus `"id"`; the `answer` key is removed
     (legacy: for `match`; app: for every type); for `multiple_choice` `choices` is replaced by `{index: text}` (JSON keys become
     strings "0","1",..., texts translated in the app) — removing `valid` flags and per-choice `feedback`; `success_message` and
     `error_message` are removed. Other keys are returned as is (e.g. `default`, `language`, `limit`,
     `allowed_exts`, `max_size`, custom keys of plugin problem types).
5. Response 200, JSON list.

## Alternative / error flows
- Anonymous → 403 "You are not authenticated".
- Unregistered user → 403 "You are not registered to this course".
- Task without a readable task.yaml → treated as not found.

## Data
Reads task.yaml files, `user_tasks` (`tried`, `succeeded`, `grade`). No writes (does not mark task as viewed).

## Permissions & security
- Only tasks visible to the user are returned.
- Fields revealing answers are removed from problems: `answer`, `success_message` and
  `error_message` (for every problem type), and multiple-choice `choices` are reduced to
  `{index: translated text}` (no `valid` flag, no per-choice feedback).
- Anonymous and LTI sessions get 403; users to whom the course is not open get 403.

## Acceptance tests
- Registered student receives the documented shape; `match` problems have no `answer`; MCQ choices
  are `{"0": text, ...}` with no `valid`.
- status transitions: notviewed → (after `user_saw_task`) notattempted → failed/succeeded.
- Unknown task → 404 "Task not found"; unknown course → 404 "Course not found"; outsider → 403.
- A hidden task is not listed and `/tasks/<hidden>` → 404 "Task not found".
