# Problem type `multiple_choice` (single / multiple answers)

- **ID**: TASK-05
- **Actors**: student, course admin
- **Routes**: rendered in `GET /course/<courseid>/<taskid>`; submitted with TASK-08; graded by TASK-07 (mcq agent) or by a container script
- **Depends on**: TASK-01, TASK-07, TASK-08
- **Legacy code**: `legacy/inginious/common/tasks_problems.py:L272-L422` (`MultipleChoiceProblem`), `legacy/inginious/frontend/task_problems.py:L158-L218` (display, shuffle, limit), `templates/tasks/multiple_choice.html`, `static/js/task.js:L211-L217,L580-L582,L720-L738`

## Use case
Quizzes: the student ticks one (radio) or several (checkbox) answers among choices that can be
shuffled and sub-sampled per student; correct/incorrect choices can carry feedback.

## Preconditions
Problem `{type: multiple_choice, choices: [...], multiple?, limit?, unshuffle?, centralize?, success_message?, error_message?}` (task-model §4.4). At least one valid choice, otherwise the task cannot be loaded.

## Main flow
1. Construction: choices are enumerated (`index` = position in the YAML list, 0-based); `_choices = valid + invalid` (stable order by validity).
2. Display (`show_input(language, seed=session.username)`):
   1. `rand = random.Random("<pid>#<language>#<username>")` (username `None` → `"None"` for anonymous).
   2. If not `unshuffle`: `rand.shuffle(copy of _choices)`.
   3. `_filter_choices`: `limit = limit or len(choices)`;
      - multiple: all valid choices + the first `max(limit - nb_valid, 0)` invalid ones;
      - single: first `limit-1` invalid ones, then valid ones up to `limit - nb_kept` (at least one valid if limit ≥ 1).
   4. If not `unshuffle`: `rand.shuffle(result)` again; else sort by `index`.
   5. Template:
      ```html
      <div id="task_alert_<pid>" class="task_alert_problem"></div>
      <header html>
      <div class="form-check">
        <input class="form-check-input" type="radio|checkbox" name="<pid>" value="<index>" id="<pid>_<index>"/>
        <label class="form-check-label" for="<pid>_<index>"><choice text RST → HTML></label>
      </div> ...
      ```
   The shuffled order is deterministic per (problem, language, user): reloading shows the same order; changing language changes it.
3. Client validation: for every radio/checkbox group, at least one checked, else "Please answer to all the questions." (so a multiple-answer question cannot be submitted with nothing ticked from the UI).
4. Server input: multiple → `request.form.getlist(pid)` (list of strings, `input_type list`); single → `request.form.get(pid)` (string).
5. Consistency: key present; multiple: value is a list and every entry `int()`-convertible and an existing index (**an empty list is accepted**); single: `int(value)` existing index. a non-numeric or missing single value → inconsistent.
6. Grading (`check_answer`, executed by the mcq agent — TASK-07; a docker grading script receives the raw indexes instead):
   - multiple: valid iff every valid choice is selected and no invalid one; `invalid_count` += 1 per missing valid and per selected invalid choice; messages = feedback of every **selected** choice (in selection order);
   - single: valid = selected choice is valid; `invalid_count` = 1 if wrong; message = the choice feedback;
   - wrong: prepend `error_message` if defined, else (if not `centralize`) the internal key `"_wrong_answer_multiple"` / `"_wrong_answer"`;
   - correct: prepend `success_message` if defined;
   - returns `(valid, None, msgs or None, invalid_count, "")` (state always `""`).
   Note: choices that were *not displayed* (because of `limit`) still count: a multiple question with a hidden valid choice can never be answered correctly — this is prevented by `limit ≥ nb_valid` validation.
7. Feedback display: `load_feedback_multiple_choice` = `load_feedback_code` (card success/danger with the joined messages).
8. Reload (`load_input_multiple_choice`): checkbox → checked iff `input[pid].indexOf(value) > -1`; radio → checked iff `input[pid] == value`; absent → all unchecked.

## Alternative / error flows
- Index not in the choices (`capital=7`) or non-numeric (`abc`) → generic JSON error "Please answer to all the questions and verify…".
- Indexes of choices not displayed to this student are accepted by the server.
- Single MCQ field missing from POST → generic JSON error.

## UI elements
Radio buttons or checkboxes with RST labels (paragraph-wrapped `<p>`), per-problem alert.

## Data
- Submission input: single `"capital": "0"`, multiple `"primes": ["0", "2"]` (strings).
- Feedback stored by the mcq agent: `problems.<pid> = ["success"|"failed", "<msg1>\n\n<msg2>"]` (RST, internal keys already translated, e.g. "Wrong answer. Make sure to select all the valid possibilities").

## Permissions & security
- Choice texts/feedbacks/messages are author RST rendered to sanitized HTML.
- Correct answers are never sent to the browser. The shuffle is deterministic per (problem, language, user).

## Acceptance tests
- `task_showcase/mcq_single` as `task_alice`: 3 radios out of 4 (limit 3) including Brussels; same order on reload; different users may get different subsets/orders.
- Select Antwerp (index 1) → result failed 0%, problem feedback "Not quite. Think about the *European* capital.\n\nAntwerp is the largest city of Flanders." (rendered `<p>…<em>European</em>…</p><p>Antwerp…</p>`), global text "You have 1 wrong answer(s).\n\n\nAmong them, you have 1 invalid answers in the multiple choice questions" (verified).
- Select Brussels (index 0) → success 100%, feedback "Well done, **Brussels** it is.\n\nBrussels is the capital since 1830.", global text empty.
- `mcq_multiple` (unshuffled, 4 checkboxes in YAML order): `['0','1']` → success; `['0']` → failed with "Wrong answer. Make sure to select all the valid possibilities"; `['0','2']` → failed, feedback includes "4 = 2 x 2.", MCQ error count 2.
- POST `capital=7` or `capital=abc` → JSON error, no submission; POST without `capital` → JSON error.
- POST `primes` absent → accepted (empty list) and graded as wrong.
