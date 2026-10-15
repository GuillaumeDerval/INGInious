# Task editor plugin hooks (`task_editor_tab`, `task_editor_submit`) and the example plugin

- **ID**: CADM-13
- **Actors**: course admin, superadmin; plugin developers
- **Routes**: part of `GET|POST /admin/<courseid>/edit/task/<taskid>` (CADM-10)
- **Depends on**: CADM-10, plugin manager (CORE plugin hooks)
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/task_edit.py:L46-L54,L116-L122`; `templates/course_admin/task_edit.html:L57-L59,L90-L94`; `plugins/task_editor_hook_example/__init__.py:L1-L39`, `plugins/task_editor_hook_example/example_tab_2.html`; `plugins/plugin_manager.py` (`add_hook`, `call_hook`, `add_template_prefix`)

## Use case
Plugins extend the task editor with extra tabs (e.g. to edit plugin-specific task fields) and can modify or reject
the task data before it is saved.

## Main flow
1. GET: `plugin_manager.call_hook('task_editor_tab', course=course, taskid=taskid, task_data=task_data)` → list of tuples `(tab_id, link_html, content_html)`. For each: a nav tab `<a href="#<tab_id>">{{ link | safe }}</a>` after "Task files", and a pane `<div id="<tab_id>" class="card-body tab-pane">{{ content | safe }}</div>` **inside the form** — so inputs in the content are posted with the task.
2. POST: after parsing (CADM-10 step 4.1–4.6), `call_hook('task_editor_submit', course=course, taskid=taskid, task_data=data)`; hooks may **mutate `data`** (dict passed by reference). The first non-`None` return value is returned as the HTTP response body unchanged (expected to be a JSON string `{"status":"error","message":…}`) and the task is not saved.
3. Extra form fields of plugin tabs end up as top-level task keys (generic key pass-through of CADM-10).

### Example plugin `task_editor_hook_example` (enabled in the reference environment)
- Tab "Example tab" (`tab_example`, link `<i class="fa fa-edit fa-fw"></i>&nbsp; Example tab`, content "This is a test").
- Tab "Example tab 2" (`tab_example_2`): template text "This is an example tab for course "<name>" (id: "<id>"), and task "<taskid>". We can show data from the task descriptor, such as the name "<name>"", "We can also include some data for a form:", text input `example_task_hint` "Task hint" (value from `task_data.example_task_hint`), "Note that form data needs to be processed by a separate hook".
- Submit hook: sets `task_data['example_field'] = 'test'`; if `example_task_hint` is empty/missing returns `{"status": "error", "message": "You must provide a task hint in Example tab 2"}`.
- Consequence in the reference environment (verified): **every task save requires a non-empty "Task hint"**, and every saved task gets `example_field: test` and `example_task_hint: <hint>`.

## Alternative / error flows
- Hook exceptions propagate (HTTP 500).
- Returned error strings are displayed as escaped text in the status alert.

## Data
- Arbitrary top-level keys in `task.yaml` (`example_field`, `example_task_hint` for the example plugin).

## Permissions & security
- Plugins are trusted code. In the rewrite a plugin tab is declared as data (id, label, text, typed fields): its label
  and text are rendered as escaped text and only its declared fields are written to `task.yaml`.

## Acceptance tests
- With the example plugin enabled: editor shows "Example tab" and "Example tab 2"; saving without hint → error "You must provide a task hint in Example tab 2" and file unchanged; with hint → `example_field: test`, `example_task_hint: <hint>` in YAML.
- A test plugin returning a tab that declares a field `foo` gets `foo` saved in `task.yaml`.
- The rewrite must expose equivalent extension points (or reimplement the plugins in use) — check which production plugins use them.
