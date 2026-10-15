# Task list administration page, task dispenser switch, WebDAV info and legacy migration

- **ID**: CADM-06
- **Actors**: course admin, superadmin (tutors: read-only GET)
- **Routes**: `GET /admin/<courseid>/tasks`, `POST /admin/<courseid>/tasks` (endpoint `coursetasklistpage`) with one of: `task_dispenser=<id>` | `migrate_tasks` | `course_structure`+`new_tasks`+`deleted_tasks`+`wiped_tasks` (CADM-07)
- **Depends on**: CADM-02, CADM-07 (TOC editor), CADM-08 (per-task settings), CADM-09 (combinatory test), contests plugin (`contest` dispenser), WebDAV feature
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/task_list.py:L20-L142`; `templates/course_admin/task_list.html:L1-L131`; `task_dispensers/__init__.py:L4-L132`; `task_dispensers/toc.py:L142-L158` (`has_legacy_tasks`, `import_legacy_tasks`); `tasks.py:L200-L207`; `app.py:L103-L105,L160-L161`

## Use case
The admin manages the list/structure of tasks of the course, chooses how tasks are dispensed to students
(table of contents, combinatory test, contest), gets the WebDAV credentials to edit course files, and migrates
old task files that still contain dispenser settings.

## Preconditions
- GET: staff (admin or tutor). POST: admin (`allow_all_staff=False`, tutors 403).

## Main flow
1. GET renders `course_admin/task_list.html`: `<h2>Tasks` with a right button "Switch task dispenser" (`btn-warning`, `fa-exchange`) opening modal `#taskDispenserModal`.
2. Data prepared by `page()`: for every readable task folder (`course.get_readable_tasks()` = sub-folders containing `task.yaml`) try `course.get_task(id)`; failures are collected in `tasks_errors[taskid] = str(exception)`. `tasks` = natsorted by translated name: `{taskid: {"name": name, "url": "?format=taskid%2Fusername&tasks=<taskid>"}}`.
3. **WebDAV box** (only if config `webdav_host` is set): collapsible card "WebDAV access" — "Use this URL to access your course folder using WebDAV:" table URL `<webdav_host>/<courseid>`, Username `<session.username>`, Password = the user's API key (`user_manager.get_user_api_key(username)`, generated if missing). (Not visible in the shared env at the time of the test.)
4. Messages: each error in `alert-danger` (dismissible); else if `validated` → `alert-success` "Changes saved.".
5. **Legacy banner**: if `task_dispenser.has_legacy_tasks()` (some `task.yaml` contains one of the legacy fields of the current dispenser) → warning "This course currently includes legacy tasks with settings that have to be imported to the task dispenser settings to be effective." with a form button `name="migrate_tasks"` "Migrate tasks" (`fa-rocket`).
6. `<div id="dispenser_data">` = `task_dispenser.render_edit(course, tasks, tasks_errors)` (CADM-07 / CADM-09 / contest).
7. Bottom: "Cancel" (`location.reload()`) and "Save changes" (`dispenser_submit('<dispenser id>')`, CADM-07).

### Switch task dispenser (modal)
- Text: "This will wipe your current course structure. Tasks file won't be deleted but you'll have to import them again."; select `name="task_dispenser"` (`#new_task_dispenser`) listing all registered dispensers (`toc` "Table of contents", `combinatory_test` "Combinatory test", `contest` "Contest" from the contests plugin), current one selected; buttons "Cancel" / "Save changes" (form POST).
- POST `task_dispenser=<id>`: unknown id → error "Invalid task dispenser"; else `task_dispenser: <id>` and **`dispenser_data: {}`** written (verified; even when re-selecting the same dispenser → structure wiped).

### Migrate tasks (POST `migrate_tasks`)
- `import_legacy_tasks()`: deep copy of `dispenser_data`; for each task on disk, `config[taskid].update(task.get_dispenser_settings(legacy_fields))` where legacy fields map (TOC): `weight→weight`, `submission_limit→submission_limit`, `stored_submissions→no_stored_submissions`, `groups→group_submission`, `evaluate→evaluation_mode`, `accessible→accessibility`, `categories→categories` (combinatory test: same without `groups`).
- Then validated and saved like a normal structure update, then `clean_task_files`: every task's `task.yaml` is re-saved **without** the legacy keys (other keys kept in order).
- Verified: task with `weight: 4, submission_limit {2,-1}, stored_submissions: 1, groups: true, evaluate: last, accessible: "2025-01-01 00:00:00/2030-01-01 00:00:00", categories: [old], custom_key: keep me` → `dispenser_data.config.legacy1 = {weight: 4, submission_limit: {amount: 2, period: -1}, no_stored_submissions: 1, group_submission: true, evaluation_mode: last, accessibility: "2025-…/2030-…", categories: [old]}`, and `task.yaml` reduced to `name, environment_type, custom_key, problems`.
- Errors → "Something wrong happened: <message>" (e.g. "In task <id> : <error>", invalid values such as `weight: '7'` → "Invalid course structure: In taskid …").

## Alternative / error flows
- After any POST the course is reloaded and the page re-rendered (HTTP 200, no redirect → browser refresh re-posts).
- Tasks whose `task.yaml` fails to load appear in red in the structure ("Error in task with id <id> : <error>") if referenced by the TOC; tasks referenced but absent → red "No valid task with id: <id>" with a delete button.
- Tutor GET works (sees the editor, without the WebDAV box); every POST → 403.

## Data
- `course.yaml`: `task_dispenser` (str id), `dispenser_data` (dispenser-specific; reset to `{}` on switch).
- `task.yaml` of every task rewritten on migration (legacy keys removed).
- `users.apikey` may be generated on GET when WebDAV is enabled.

## Permissions & security
- Switch/migrate are destructive and confirmed through the modal; the POSTs are protected against cross-site request forgery.
- The WebDAV box is shown to course admins only; the password shown is the current user's own API key,
  displayed only to that user.

## Acceptance tests
- GET as admin lists all on-disk tasks in the "add tasks" modal and the structure; tutor GET 200, tutor POST 403.
- Switch to `combinatory_test` → YAML `task_dispenser: combinatory_test`, `dispenser_data: {}`; `task_dispenser=bogus` → "Invalid task dispenser".
- Course with legacy `task.yaml` fields shows the banner; migrate → config imported exactly as above, legacy keys removed from `task.yaml`, banner disappears.
- WebDAV card shown iff `webdav_host` configured and the user is a course admin, with URL `<host>/<courseid>`.
