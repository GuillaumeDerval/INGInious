# Table-of-contents dispenser editor (sections, drag & drop, add/create/delete/wipe tasks)

- **ID**: CADM-07
- **Actors**: course admin, superadmin
- **Routes**: rendered inside `GET /admin/<courseid>/tasks`; saved by `POST /admin/<courseid>/tasks` with `course_structure`, `new_tasks`, `deleted_tasks`, `wiped_tasks`
- **Depends on**: CADM-06 (page), CADM-08 (per-task settings modal and `config`), CADM-17 (YAML format of created tasks), course page rendering of the TOC (student side)
- **Legacy code**: `legacy/inginious/frontend/task_dispensers/toc.py:L18-L140`; `task_dispensers/util.py:L210-L379` (`SectionsList`, `Section`, `check_toc`, `parse_tasks_config`, `check_task_config`); `pages/course_admin/task_list.py:L51-L114`; templates `course_admin/task_dispensers/{toc,util,section,empty_section,task_list,section_config,section_menu,task_buttons,util_delete_modal,util_move_modal}.html`; `static/js/task_dispensers.js:L1-L542` (Sortable.js)

## Use case
The admin organises the course tasks into (nested) sections shown to students on the course page, creates new
tasks, places existing task folders, reorders by drag & drop, and deletes tasks (optionally their files and/or all
their submissions).

## Preconditions
- Course `task_dispenser` is `toc` (or absent → TOC by default).

## Main flow
1. The structure is rendered from `dispenser_data.toc` (`SectionsList`): a section is *terminal* if it has `tasks_list`, *non-terminal* if it has `sections_list`. Empty sections are rendered with `empty_section.html` (can receive either tasks or sub-sections, placeholder "Drag tasks or section here."). Root container `#course_structure` (`data-level="2"`), section titles `h3`, `h4`… by depth.
2. Each section header has a checkbox (grouped actions, checks all children), the title, and a "hamburger" dropdown: "Add tasks" (terminal/empty only), "Add subsection" (non-terminal/empty only), "Rename", "Delete".
   Each section has a config card with checkboxes (`section_config.html`, `input.section-config-item` with `id` = config key):
   - `closed` "Closed by default" (bool, default false), `hidden_if_empty` "Hidden if empty" (bool, default false).
3. Each task row (`#task_<taskid>`): grouped-action checkbox, task name (bold) + hidden "pills" lines for each config item (CADM-08), buttons: Task settings (`fa-cogs`, opens `#edit_task_modal`), View task (→ `/course/<c>/<t>`), Edit task (→ `/admin/<c>/edit/task/<t>`), View submissions (→ `/admin/<c>/submissions?tasks=<t>`), Delete task (opens `#delete_task_modal`).
4. **Add section**: button "Add section" at the bottom (`dispenser_util_create_section($('#course_structure'))`) or "Add subsection": clones `#empty_section`, puts an inline text input (focus, select); Enter or blur commits the title; the section DOM id becomes `section_<slug>` (`string_to_id`: lowercase, spaces→`_`, non-word removed, `_+`→`_`, uniqueness suffix `_1`, `_2`…). Default title "New section".
5. **Rename**: same inline input on an existing title.
6. **Add tasks** modal `#addTaskModal`: "Create new task" — text `#new_task_id` + button "Create new task" (JS check `/^[a-zA-Z0-9_\-]+$/` else alert 'Task id should only contain alphanumeric characters (in addition to "_" and "-").'), appends a row "New task with id: <id>" and pushes the id to `dispenser_new_tasks`; "Import from course filesystem" — search box (filters by name), list of all on-disk tasks **not already placed** ("No unassigned tasks in the filesystem of this course" if none), click toggles selection, button "Add" appends clones of the selected tasks and initialises `dispenser_config[taskid] = {}` if missing.
7. **Drag & drop** (Sortable.js, handle `.handle`): tasks between task lists (group `tasks_list`), sections between section lists (group `sections_list`); hovering a collapsed section header for 0.7 s expands it; empty sections morph into task lists or section lists depending on what is dropped (`dispenser_util_content_modified`), and back to empty when emptied.
8. **Delete section** modal: "Once saved, this will **permanently** delete this section, all its subsections and remove all the tasks and their files from INGInious." checkbox "Wipe all submissions"; buttons "Cancel", "Keep files" (remove section + tasks from the structure only), "Delete section" (also push every contained task to `dispenser_deleted_tasks`). With "Wipe" checked, every contained task is pushed to `dispenser_wiped_tasks`.
9. **Delete task** modal: "Once saved, this will **permanently** remove the task and its files from INGInious." + "Wipe all submissions" checkbox; "Keep files" (remove from structure only) / "Delete task" (+ `deleted_tasks`). The row and `dispenser_config[taskid]` are removed. Invalid tasks (red rows) show a direct delete button calling `dispenser_util_delete_task(this, '<id>')`; because the id is passed as the `keep_files` argument this throws `Cannot read properties of null (reading 'to_taskid')` and **does nothing** (verified) — the only way to remove a ghost entry is to drag it out / delete its section. Rewrite: make it work.
10. **Grouped actions** menu: "Change selection" (enabled once a setting filter pill is active; opens the grouped edit modal, CADM-08), "Move to section..." (modal with select of sections, non-task-list sections disabled, prefixed by `-` per depth; "Move tasks"), "Delete" (modal: "Keep files" / "Delete tasks"), "Compact view" (toggle; limits `#course_structure` height to the viewport). Next to it: "On setting:" filter pills (one per config item) showing the corresponding pill line on each task.
11. Leaving the page with unsaved changes triggers `beforeunload` ("All change will be lost! Are you sure you want to leave?").
12. **Save** (`dispenser_submit('toc')`): builds and submits a hidden form (classic POST, full page reload):
    - `course_structure` = `JSON.stringify({"toc": [...], "config": dispenser_config})` where each section is `{"title": <text>, "config": {"closed": bool, "hidden_if_empty": bool}, "tasks_list": [ids]}` or `{"title", "config", "sections_list": [...]}` (empty sections are serialised as task lists `[]`);
    - `new_tasks`, `deleted_tasks`, `wiped_tasks` = JSON arrays of task ids.
    Example (verified): `{"toc":[{"title":"Week 1","config":{"closed":false,"hidden_if_empty":false},"tasks_list":["task1","task2"]}],"config":{}}`, `new_tasks=["task1","task2"]`.
13. Server (`POST_AUTH`, in this order):
    1. `update_dispenser(course, json.loads(course_structure))` → `check_dispenser_data`: `check_toc` (every section needs a non-empty `title` → "No title for one section"; needs `tasks_list` or `sections_list` → "One section don't contain a sections list nor a tasks list"; task ids must pass `id_checker` → "One task id contains non alphanumerical characters"); then `check_task_config` over the tasks **referenced in the TOC**: config entries for tasks not in the TOC are **deleted**, missing ones set to `{}`, each item validated (CADM-08). `imported` = posted `imported` or previous `imported` (default false). On success writes `task_dispenser: toc` and `dispenser_data` = **the posted object itself** (with the cleaned config and `imported`). Error → "Something wrong happened: Invalid course structure: <msg>" (JSON parse error → "Something wrong happened: Expecting value: line 1 column 1 (char 0)").
    2. For each id in `new_tasks`: if `<task>/task.yaml` exists → "Couldn't create task <id> : Task with id <id> already exists."; else `Task(courseid, id, {"name": id, "problems": {}, "environment_type": "mcq"}).save()` (invalid id → "Couldn't create task <id> : Task with invalid id: <c>/<id>"). Written file (sorted keys): `environment_type: mcq\nname: task1\nproblems: {}\n`.
    3. For each id in `deleted_tasks`: `Task.get(...).delete()` → removes the whole task folder (`shutil.rmtree`) and invalidates the cache; missing → "Couldn't delete task <id> : " (empty exception text).
    4. For each id in `wiped_tasks`: delete GridFS `input` and `archive` of every submission of that task, then `user_tasks.deleteMany({courseid, taskid})`, `submissions.deleteMany({courseid, taskid})`; log "Task <c>/<t> wiped.". Works even if the folder no longer exists.
    5. Re-render with all collected errors or "Changes saved.". **Steps are independent**: the structure is saved even if task creation/deletion fails, and vice-versa.

### Written YAML (verified)
```yaml
task_dispenser: toc
dispenser_data:
    config:
        task1: {}
        task2: {}
    imported: false
    toc:
    -   config:
            closed: false
            hidden_if_empty: false
        tasks_list:
        - task1
        - task2
        title: Week 1
```
`dispenser_data` keys are alphabetically sorted (plain dicts from `json.loads`). Arbitrary extra keys posted in
sections or at top level (e.g. `"junk": "x"`, `"extra": 1`) are persisted verbatim (verified).

## Alternative / error flows (verified)
- The same task id may appear in several sections (no duplicate check); ids referenced in the TOC but absent on disk are kept (`config.ghost: {}`) and shown in red "No valid task with id: ghost".
- On-disk tasks not placed in the TOC are not visible to students but keep no config (their config is removed at save).
- A task newly created through the TOC gets no `dispenser_config` entry client-side and its "Task settings" button targets `#edit_<taskid>`, a modal that does not exist → nothing opens (verified); its settings can only be edited after saving (it is then saved with config `{}` = defaults).
- `deleted_tasks` deletion is immediate and irreversible (whole folder incl. files); submissions are kept unless also wiped.
- Combinatory test uses the same editor with differences (CADM-09).

## Data
- `course.yaml` `task_dispenser`, `dispenser_data` (`toc`, `config`, `imported`).
- Disk: `<course>/<task>/task.yaml` created; task folders removed.
- MongoDB on wipe: `submissions` (and GridFS `fs.files`/`fs.chunks` of `input`/`archive`), `user_tasks` deleted for (courseid, taskid).

## Permissions & security
- Admin only for POST; the POST is protected against cross-site request forgery. Destructive actions are applied on "Save changes" without server-side confirmation.
- Section titles and section config values are escaped when rendered.

## Acceptance tests
- Create section "Week 1", create tasks `task1`,`task2` in it, save → YAML above + two `task.yaml` files.
- Nested sections (section with `sections_list`) round-trip; drag task between sections changes `tasks_list` order.
- Delete task with "Keep files" → removed from TOC and config only; with "Delete task" → folder removed; with "Wipe" → DB submissions/user_tasks/GridFS files of that task removed (verified with seeded data).
- Each validation message above returned for the corresponding malformed `course_structure`.
- Creating an existing task id → "Couldn't create task … already exists." while the structure is still saved.
- Invalid task id client-side → alert; server-side → the whole post is refused ("Invalid form"), nothing written.
