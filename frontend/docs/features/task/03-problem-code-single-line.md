# Problem type `code_single_line` (one-line text input)

- **ID**: TASK-03
- **Actors**: student, course admin
- **Routes**: rendered in `GET /course/<courseid>/<taskid>`; submitted with TASK-08
- **Depends on**: TASK-01, TASK-02 (same validation), TASK-08
- **Legacy code**: `legacy/inginious/common/tasks_problems.py:L209-L214`, `legacy/inginious/frontend/task_problems.py:L97-L122`, `templates/tasks/single_line_code.html`, `static/js/task.js:L576-L578,L699-L702`

## Use case
Short textual answers (a word, a number, an expression) checked by a grading script.

## Preconditions
Problem `{type: code_single_line, header?, default?, optional?}` (task-model §4.2).

## Main flow
1. Render:
   ```html
   <div id="task_alert_<pid>" class="task_alert_problem"></div>
   <header html>
   <input type="text" name="<pid>" value="<default>" class="monospace form-control [form-inline if '/' in pid]"
          data-optional="True|False"/>
   ```
   (`type` is always `"text"` and `maxChars` always 0 in the legacy code: no `maxlength`.)
2. Submit/validation/storage identical to `code` (TASK-02): string, non-empty unless optional.
3. Feedback via `load_feedback_code_single_line` = `load_feedback_code`.
4. Reload via `load_input_code_single_line` → sets `input[name=pid]` value (or "" if absent).

## Alternative / error flows
- Same as TASK-02. Note: the input is **not trimmed** by the frontend (`" 7 "` is sent as is).

## UI elements
Single `<input type=text>` per problem with default value pre-filled.

## Data
- Submission input `"<pid>": "<text>"`.

## Permissions & security
- `default` is escaped; the header RST is rendered to sanitized HTML.

## Acceptance tests
- `task_showcase/single_line`: `word` pre-filled with `hel`; submit `word=hello, number=7, comment="", notes=""` → success 100, problem alerts: `word` success "Correct word.", `number` success (no text → card without body), global text "comment=[] notes=[]".
- `number=8` → failed, grade 50, `number` alert "Expected 7.".
- Leaving `number` empty → client error; forced POST → generic server error, no submission.
- POST omitting the optional `comment` field entirely → server error (key required even if optional).
