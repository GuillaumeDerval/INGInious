# Grading of MCQ/match tasks (environment `mcq`)

- **ID**: TASK-07
- **Actors**: student (submits), mcq agent (grades)
- **Routes**: none of its own; the submission flow TASK-08/09 is identical to docker tasks
- **Depends on**: TASK-05, TASK-06, TASK-08, TASK-09
- **Legacy code**: `legacy/inginious/agent/mcq_agent/__init__.py:L17-L133`, `legacy/inginious/frontend/environment_types/mcq.py`, `legacy/inginious/common/tasks_problems.py:L352-L393,L446-L450`

## Use case
Quizzes made only of `multiple_choice` and `match` problems are graded instantly without a
container. **The frontend never grades**: it sends a normal job (`environment_type: "mcq"`,
`environment: "mcq"`) to the backend, which routes it to the mcq agent.

## Preconditions
- Task with `environment_type: mcq`, `environment_id: mcq` (or legacy `environment: mcq`).
- mcq agent connected (advertises `{"mcq": {"mcq": {...}}}`); otherwise the job ends immediately with `("crash", "Environment not available.")`.

## Main flow
1. Frontend creates the submission and sends `ClientNewJob` (TASK-08) with `task_problems` = raw `problems` dict of `task.yaml` and the full `inputdata` (including `@lang`, `@state`).
2. Agent: language = `inputdata["@lang"]`; loads the task translations (`$i18n` lookup order of task-model §1); instantiates the common `Problem` classes from `task_problems`.
3. `check_answer` for every problem (TASK-05 / TASK-06):
   - `None` result (e.g. a `code` problem) → `need_emul` → `CannotCreateJobException("Task wrongly configured as a MCQ")` → backend reports a job error (crash).
   - `False` → `error_count += 1`; MCQ `invalid_count` added to `mcq_error_count`.
   - problem messages → `problems[pid] = ("success" if valid else "failed", msgs)`; internal keys translated: `_wrong_answer_multiple` → "Wrong answer. Make sure to select all the valid possibilities", `_wrong_answer` → "Wrong answer", `_correct_answer` → "Correct answer"; messages joined with `"\n\n"`.
   - `states[pid] = ""` → `state = json.dumps(states)` (e.g. `'{"capital": ""}'`).
4. Global text lines: if `error_count` → "You have {n} wrong answer(s)."; if `mcq_error_count` → "\n\nAmong them, you have {n} invalid answers in the multiple choice questions"; joined with "\n".
5. Grade = `100.0 * (nb_problems - error_count) / nb_problems`; result `"success"` iff no wrong problem else `"failed"`; no problems → result `"crashed"` (sic), text "No subproblems defined", grade 0.
6. `send_job_result(job_id, result, text, grade, problems, tests={}, custom={}, state, archive=None)` → frontend `_job_done_callback` (TASK-09).

## Alternative / error flows
- Problem without per-problem messages (centralized and no feedback) → no entry in `problems` for it.
- Invalid input reaching the agent → exception in the agent → job error.

## UI elements
Same as any submission (TASK-09); grading is near-instant so the "waiting" phase is usually one poll.

## Data
Resulting `submissions` document (verified, `task_showcase/mcq_single`, correct answer):
```js
{ courseid:'task_showcase', taskid:'mcq_single', username:['task_alice'], input:ObjectId(<GridFS>),
  status:'done', submitted_on:ISODate(...), response_type:'rst', grade:100, custom:{},
  problems:{capital:['success','Well done, **Brussels** it is.\n\nBrussels is the capital since 1830.']},
  result:'success', tests:{}, text:'', user_ip:'172.19.0.1', state:'{"capital": ""}', stderr:null, stdout:null }
```
`user_tasks.state` becomes the JSON state string when the submission becomes the evaluated one.

## Permissions & security
Answers are checked server-side by the agent; the browser never receives `valid` flags.

## Acceptance tests
- `mcq_centralize`: `q1=0, q2=[0], q3=" 4 "` → failed, grade 66.67 (2/3), text "You have 1 wrong answer(s).\n\n\nAmong them, you have 1 invalid answers…", `problems` has no entry for centralized problems without feedback.
- `q1=1, q2=[0,1], q3=5` → grade 33.33, two wrong.
- `match_answer` all correct → 100, `text` empty, problems both "Correct answer".
- `legacy_env` (legacy `environment: mcq`) is graded by the mcq agent.
- With the mcq agent stopped → submission `status:'error'`, `result:'crash'`, text "Environment not available." (rewrite: same behaviour driven by the backend environment list).
