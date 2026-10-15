# Plugin "task_editor_hook_example": extra tabs and validation in the task editor

- **ID**: SITE-17
- **Actors**: course admin (task editor)
- **Routes**: GET/POST /admin/<courseid>/edit/task/<taskid> (core page; plugin adds content)
- **Depends on**: SITE-12, TASK-EDIT (task editor)
- **Legacy code**: `plugins/task_editor_hook_example/__init__.py:L1-39`, `plugins/task_editor_hook_example/example_tab_2.html`,
  `pages/course_admin/task_edit.py:L46,L117-122`, `templates/course_admin/task_edit.html:L57-59,L90-94`

## Use case
Example for plugin authors: add custom tabs (with custom form fields) to the task editor and
validate/transform the task data before it is saved.

## Preconditions
Plugin enabled (it is in the reference config `infra/legacy-configuration.yaml`, **so every task
save in the reference environment requires the hint field**).

## Main flow
App behaviour: same tabs, field, stored keys and error message; the tabs are declared as
data (`EditorTab`: id, label, text, fields) instead of HTML templates. Legacy flow (reference):
1. Task editor GET: hook `task_editor_tab` adds two tabs after the core tabs (`img/task-editor-hook-tab.png`):
   - `tab_example`: link `<i class="fa fa-edit fa-fw"></i>&nbsp; Example tab`, content `This is a test`;
   - `tab_example_2`: link "Example tab 2", content rendered from `example_tab_2.html`: text
     `This is an example tab for course "<course name>" (id: "<courseid>"), and task "<taskid>". We can show data from the task descriptor, such as the name "<name>"`,
     then "We can also include some data for a form:" and a text input "Task hint"
     (`name="example_task_hint"`, value from task.yaml), then "Note that form data needs to be processed by a separate hook".
2. Task editor save (AJAX POST): hook `task_editor_submit(course, taskid, task_data)`:
   - sets `task_data["example_field"] = "test"`;
   - if `example_task_hint` is empty/missing → returns the string
     `{"status": "error", "message": "You must provide a task hint in Example tab 2"}` which is sent as
     the response; the save is aborted (verified) and the editor shows the error.
3. Otherwise the task is saved with two extra top-level keys in task.yaml:
   `example_task_hint: <value>` (form field kept because every non-special form field is saved) and `example_field: test`.

## Data
task.yaml extra keys `example_task_hint` (str), `example_field: "test"`.

## Permissions & security
Inherits task editor checks (course admin). In the app, plugin tabs are data (label, text and
field specifications) rendered as text by the editor, never raw HTML.

## Acceptance tests
- With the plugin enabled: editor shows "Example tab" and "Example tab 2"; saving without hint fails
  with the exact message; saving with hint stores `example_task_hint` and `example_field: test`.
- With plugin disabled: no extra tabs, no extra keys.
