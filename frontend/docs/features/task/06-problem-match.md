# Problem type `match` (exact answer)

- **ID**: TASK-06
- **Actors**: student, course admin
- **Routes**: rendered in `GET /course/<courseid>/<taskid>`; submitted with TASK-08; graded by TASK-07
- **Depends on**: TASK-01, TASK-07, TASK-08
- **Legacy code**: `legacy/inginious/common/tasks_problems.py:L425-L462` (`MatchProblem`), `legacy/inginious/frontend/task_problems.py:L221-L242`, `templates/tasks/match.html`, `static/js/task.js:L572-L574,L740-L746`

## Use case
Fill-in-the-blank question whose answer is compared to a fixed string, without any container.

## Preconditions
Problem `{type: match, answer: <scalar>, header?, centralize?}`; `answer` required ("There is no answer in this problem with type==match"), converted with `str()`.

## Main flow
1. Render:
   ```html
   <div id="task_alert_<pid>" class="task_alert_problem"></div>
   <header html>
   <input type="text" name="<pid>" value="" class="monospace form-control"/>
   ```
   (no `data-optional` attribute → the JS treats it as required; no default value).
2. Client validation: empty → "Please answer to all the questions.".
3. Server: `form.get(pid)` (string); consistency checks that the field is present.
4. Grading (mcq agent): `input.strip() == str(answer)` (case-sensitive) → `(True, None, ["_correct_answer"] or None if centralize, 0, "")`, else `(False, None, ["_wrong_answer"] or None, 0, "")`. Wrong match answers count in the "wrong answer(s)" count but **not** in the MCQ invalid count.
5. Feedback rendered by `load_feedback_match` (= code): "Correct answer" (success card) / "Wrong answer" (danger card).
6. Reload: `load_input_match` sets the input value.

## Alternative / error flows
- Missing field in POST → rejected at validation (generic JSON error, no submission).
- An empty string is accepted by the server (only the JS prevents it).

## UI elements
One text input per problem.

## Data
- Input `"answer": "42"`; feedback `problems.answer = ["success", "Correct answer"]`.

## Permissions & security
The expected answer stays server side (task.yaml); it is sent to the mcq agent only.

## Acceptance tests
- `task_showcase/match_answer`: `answer="42 "`, `city="Paris"` → success 100%, both problems "Correct answer".
- `answer="42"`, `city="paris"` → failed 50%, `city` "Wrong answer", global "You have 1 wrong answer(s)." (no MCQ count line).
- `mcq_centralize/q3` (centralize) answered `" 4 "` → correct, no per-problem message.
- Empty field → client-side "Please answer to all the questions.".
