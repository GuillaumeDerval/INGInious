# Task editor: page, basic settings and AJAX save

- **ID**: CADM-10
- **Actors**: course admin, superadmin
- **Routes**: `GET /admin/<courseid>/edit/task/<taskid>`, `POST /admin/<courseid>/edit/task/<taskid>` (endpoint `coursedittask`, multipart AJAX)
- **Depends on**: CADM-02, CADM-11 (environment tab), CADM-12 (subproblems), CADM-13 (plugin tabs/hooks), CADM-14 (task files tab; files are saved first), CADM-17 (YAML), reference `docs/reference/task-model.md`, TASK-17 (random inputs)
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/task_edit.py:L26-L131`; `templates/course_admin/task_edit.html:L1-L149`; `templates/course_admin/edit_tabs/basic.html:L1-L49`; `static/js/studio.js:L24-L54,L245-L326`; `static/js/common.js:L74` (`registerCodeEditor`); `common/base.py:L107-L135` (`dict_from_prefix`); `tasks.py:L54-L112,L209-L213`

## Use case
The admin edits a task's descriptor (`task.yaml`) through a tabbed form — basic information, grading environment,
subproblems, task files and plugin tabs — and saves everything with one button without leaving the page.

## Preconditions
- Admin rights; `taskid` valid (`id_checker`) and `task.yaml` exists for GET.

## Main flow
1. `GET`: invalid task id → 404 "Invalid task id"; course/rights failure → 403; task not found → 404 (`TaskNotFoundException`); other task load errors (broken YAML) → 403 "This course is unreachable".
   Renders `task_edit.html` (title "Edit <taskid>"): menu with an extra "Save changes" button under it; breadcrumb course › admin › tasks › `Edit task "<taskid>"`; `<h2>` with buttons "Save changes" (green) and "View task" (→ `/course/<c>/<t>`); `<div id="task_edit_submit_status">`; form `#edit_task_form` (`method=post`, `enctype=multipart/form-data`) containing hidden `@action=edit_task` and a card with tabs: "Basic settings" (`#tab_basic`), "Environment" (`#tab_environment`), "Subproblems" (`#tab_subproblems`), "Task files" (`#tab_files`), then one tab per plugin hook result (CADM-13); a final full-width "Save changes" button.
   Template data: `task_data` = raw `task._data` (the parsed YAML), `problemdata` = `json.dumps(task_data['problems'])` emitted as `problem_data = {{ problemdata|tojson }}` and loaded by `studio_load(JSON.parse(problem_data))`.
2. **Basic settings** fields:
   - `name` text "Name" (placeholder "title for this task"), value `task_data.name`.
   - `context` textarea "Context" (CodeMirror rst, 10 lines).
   - `author` text "Author" (placeholder "Your name"): a list in YAML is shown joined with ", "; saved as a plain string.
   - `contact_url` text "Contact URL" (placeholder "Contact link").
   - `input_random` number "Random inputs" (default 0).
   - `regenerate_input_random` checkbox "Regenerate input random" (tooltip "Regenerate random inputs for each reloading of the task page").
3. **Save** (`studio_submit()`, also bound to form submit; re-entrance guarded by `studio_submitting`):
   1. Shows info "Saving...", disables `.task_edit_submit_button`, sets every `.subproblem_order` hidden input to its DOM index.
   2. For each open file-editor tab (CADM-14) **synchronous** POST `files` `{path, action: "edit_save", content}`; `{"error":…}` → "An error occurred while saving the file <path>".
   3. **Synchronous** `ajaxSubmit` (jquery.form) of `#edit_task_form` as `multipart/form-data`, `dataType: 'json'`.
   4. Response JSON `{"status": "ok"}` → green dismissible "Task saved." (fades after 3 s); `{"status": "error", "message": "<msg>"}` → red "Some error(s) occurred when saving the task: <ul><li><msg></li></ul>"; other/HTTP error → "An internal error occurred". The response is served as `text/html` but parsed as JSON.
4. **Server POST** (`POST_AUTH`): invalid course/task id → 404 "Invalid course/task id"; rights → 403. Then, from `request.form`:
   1. `problems = dict_from_prefix("problem", form)`; `environment_type = form.environment_type`; `environment_parameters = dict_from_prefix("envparams", form)[environment_type]` (or `{}`); `environment_id = dict_from_prefix("environment_id", form)[environment_type]` (or `""`).
   2. `data` = **every other form field** whose name does not start with `problem`, `envparams`, `environment_id` or `/` and is not `@action` — values kept as strings. (So the descriptor is rebuilt from the form: keys present in the old `task.yaml` but not in the form are **dropped**, and arbitrary extra fields are **added**.)
   3. `data.environment_id = environment_id`; `data.problems` = problems sorted by `int(@order)`, each passed to its type's `parse_problem` after removing `@order` (CADM-12); `data.environment_parameters` = raw `environment_parameters` (strings, not the cleaned version — CADM-11).
   4. `input_random` → `int()`; failure → `{"status":"error","message":"The number of random inputs must be an integer!"}`; < 0 → "The number of random inputs must be positive!".
   5. `data.network_grading = "network_grading" in form` — a top-level legacy key that the UI never sends → always `false` (the real flag is in `envparams[...]`).
   6. Any exception in 1–5 → "Your browser returned an invalid form (<exception>)".
   7. Hook `task_editor_submit(course, taskid, task_data=data)`: first non-null result is returned **as-is** as the response (CADM-13).
   8. `Task(courseid, taskid, data)` validates (problem ids/types, choices, environment type & parameters, `accessible` if present…) → failure "Invalid data: <exception>".
   9. `Task.save()` writes `task.yaml`; response `{"status": "ok"}`.

### Verified example of a written `task.yaml` (mcq env, all problem types, plugin enabled)
```yaml
author: Alice, Bob
contact_url: mailto:x@y.z
context: |-
    Some *rst* context
    line 2
environment_id: mcq
environment_parameters: {}
environment_type: mcq
example_field: test
example_task_hint: hint!
input_random: 2
name: Task One
network_grading: false
problems:
    q1:
        type: code
        name: Code Q
        ...
regenerate_input_random: 'on'
```
Top-level keys are **sorted** (plain dict); `problems` keeps the UI order; `regenerate_input_random` is the string
`'on'` when checked and **absent** when unchecked; `input_random` is an int; `author`, `contact_url`, `name`, `context`
strings (empty strings are written, e.g. `author: ''`).

## Alternative / error flows (verified)
- **No environment available** for the selected type (empty `<select name="environment_id[<type>]">`, e.g. backend without agents) → the field is not posted → `dict_from_prefix` returns `None` → "Your browser returned an invalid form ('NoneType' object has no attribute 'get')": tasks cannot be saved from the UI at all.
- POST to a non-existing task id **creates** the task folder and `task.yaml` (no existence check): `POST /admin/cadm1/edit/task/newtask_via_post` → `{"status":"ok"}` and folder created, not referenced by the TOC.
- Extra form fields are stored in `task.yaml` (e.g. `weight=7` → `weight: '7'` string, a legacy dispenser field which then breaks "Migrate tasks"); fields named `accessible` are validated by `Task` (`accessible=false` string → "Invalid data: Unknown format for false").
- Existing keys not represented in the form (custom keys, legacy dispenser fields, `evaluate`, `groups`…) are **lost** on save (verified: `custom_key` and `weight` removed).
- `@order` missing on a problem → "Your browser returned an invalid form ('@order')"; unknown problem type → "Your browser returned an invalid form ('NoneType' object has no attribute 'parse_problem')".
- Unknown environment type → "Invalid data: Environment type bogus is unknown".
- File saves happen before the task save and are not rolled back if the task save fails.

## UI elements
- Status area `#task_edit_submit_status` (alerts built by `getAlertCode`); the server message is displayed as escaped text.
- Three identical "Save changes" buttons (`.task_edit_submit_button`).
- CodeMirror editors for context/headers registered in `codeEditors` (keyed by textarea name).

## Data
- Reads/writes `<course>/<task>/task.yaml`. No MongoDB writes.

## Permissions & security
- Admin only. The multipart POST is protected against cross-site request forgery.
- YAML is written with a safe dumper. Only the fields of the editor (and the fields declared by plugin tabs) are
  taken from the post; other keys already in `task.yaml` are kept unchanged.
- `message` strings from the server/plugins are rendered as escaped text.

## Acceptance tests
- GET existing task → fields pre-filled; GET `a b` → 404; GET unknown → 404; tutor → 403.
- Save with valid data → `{"status":"ok"}` and YAML exactly as described (sorted top-level keys, typed `input_random`, `'on'` for checkbox, `network_grading: false`).
- `input_random=-1` / `abc` → the two error messages.
- Save drops keys not in the form (legacy parity) — document if the rewrite chooses to preserve unknown keys (recommended to preserve, but the YAML format must stay readable by the backend).
- Save without any environment id available → explicit error message.
- POST on an unknown task id → 404, nothing created.
