# Problem type `code` (multi-line code editor)

- **ID**: TASK-02
- **Actors**: student (answers), course admin (defines in task.yaml / studio)
- **Routes**: rendered inside `GET /course/<courseid>/<taskid>`; submitted with TASK-08
- **Depends on**: TASK-01, TASK-08, TASK-19 (header RST)
- **Legacy code**: `legacy/inginious/common/tasks_problems.py:L142-L206` (`CodeProblem`), `legacy/inginious/frontend/task_problems.py:L67-L94` (`DisplayableCodeProblem`), `templates/tasks/code.html`, `static/js/common.js:L9-L140` (`registerCodeEditor`), `static/js/task.js:L559-L566,L682-L697`

## Use case
The student types a program (or any multi-line text) in a syntax-highlighted editor; the text is
sent as a string to the grading container.

## Preconditions
Task problem `{type: code, ...}` (keys in `docs/reference/task-model.md` §4.1).

## Main flow
1. Render `tasks/code.html` with `inputId=<pid>`, `header=ParsableText(header)`, `lines=8`, `first_line=offset (default 1)`, `language`, `optional`, `default`:
   ```html
   <div id="task_alert_<pid>" class="task_alert_problem"></div>
   <header html>
   <textarea name="<pid>" class="code-editor form-control [single if '/' in pid]"
             data-x-language="<language>" data-x-lines="8" data-x-first-line="<offset>"
             data-optional="True|False"><default></textarea>
   ```
2. On page load the textarea becomes a CodeMirror editor (`codeEditors[pid]`), mode loaded from `/static/js/codemirror/mode/<mode>/<mode>.js`, line numbers starting at `offset`, min 8 lines visible, indentation per user preference.
3. On submit the editor content (CodeMirror saves into the textarea) is sent as form field `<pid>`.
4. Server: `task_input[pid] = request.form.get(pid)` (`str`); consistency (`CodeProblem.input_is_consistent`): key present, `len(value) > 0` unless `optional` (then `""` stored); exception → inconsistent.
5. Stored in the submission input as a string; passed unchanged to the container (`getinput <pid>` / `input.get_input(pid)`).
6. Feedback for the problem (`submission.problems[pid] = [result, rst]`) is displayed in `#task_alert_<pid>` by `load_feedback_code`: card colour `success` if result == "success", `warning` for "timeout"/"overflow", else `danger`; icon ✓ / × / ? ; dismissible.
7. Reloading a submission (`load_input_code`): `codeEditors[pid].setValue(input[pid] or "")`; fallback to `input[name=pid]` value if no editor.

## Alternative / error flows
- Empty non-optional → client-side message "Please answer to all the questions." (JS `taskFormValid` checks every `textarea`/`input[type=text]` with a `name` whose value is empty and `data-optional != "True"`); server-side generic error (TASK-08).
- Field absent from the POST (even if optional) → server error "Please answer to all the questions…" (`len(None)` raises).
- In an `environment_type: mcq` task the mcq agent rejects the job: result `crash` ("Task wrongly configured as a MCQ" is raised as `CannotCreateJobException`).

## UI elements
CodeMirror editor; problem card header "Question n: name"; per-problem alert box above the header text.

## Data
- Submission input: `"<pid>": "<text>"` (string, may contain `\r\n` from browsers).
- No DB field specific to the problem type. Task YAML keys: `type, name, header, language, default, optional, offset`.

## Permissions & security
- `header` is author RST rendered to sanitized HTML.
- `default` is HTML-escaped in the textarea.
- `language` restricted to `[a-z0-9\-_\.]+` (it is used in the CodeMirror mode URL).

## Acceptance tests
- `task_showcase/code_python`: editor shows `def count_to(n):` at line 3; submitting the correct solution gives success 100% (TASK-09); submitting `def count_to(n):\n    return list(range(n))` gives failed 25% and per-problem feedback list with "expected …, got …".
- Submitting empty content → client error "Please answer to all the questions." and no POST; forced POST with `code=""` → JSON error "Please answer to all the questions and verify the extensions of the files you want to upload. Your responses were not tested." and no submission created.
- `single_line/notes` (optional code) submitted empty → accepted and stored as `""`.
- Reloading an old submission restores the editor content exactly.
