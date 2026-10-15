# Task page (display of a task)

- **ID**: TASK-01
- **Actors**: student, tutor, course admin, superadmin, anonymous (only on previewable courses), LTI user (via LTI task page)
- **Routes**: `GET /course/<courseid>/<taskid>` (endpoint `taskpage`); LTI: `GET /lti/task`, `GET /lti1.3/task` (same `BaseTaskPage`, `is_LTI=True`)
- **Depends on**: TASK-02..06 (problem rendering), TASK-10 (history), TASK-17 (random inputs), TASK-18 (accessibility), TASK-20 (tags), COURSE (registration, preview), AUTH-04 (sessions)
- **Legacy code**: `legacy/inginious/frontend/pages/tasks.py:L29-L150,L432-L440`, `templates/task.html` (all), `static/js/task.js:L7-L36,L823-L858`, `static/js/common.js` (CodeMirror init), `pages/utils.py:L91-L117` (auth/preview), `pages/course.py:L16-L23` (`handle_course_unavailable`)

## Use case
A student opens an exercise: they read the statement (context), see their status/grade/attempts,
the deadline and the submission policy, fill in the answers of every sub-problem and submit.
Staff additionally see administration links and debug tools.

## Preconditions
- Course exists (`course.yaml`) and task exists (`task.yaml` readable).
- User logged in, **or** anonymous with `course.allow_preview` and course accessible (`preview_allowed`).

## Main flow
1. `Course.get(courseid)` (404 `NotFound` if missing).
2. If LTI and not registered → force registration (`course_register_user(force=True)`).
3. `course_is_open_to_user(course, username, is_LTI)` false → `handle_course_unavailable`:
   reason `unregistered_not_previewable` + registration possible → **302 to `/register/<courseid>`**;
   otherwise render `course_unavailable.html` (reasons `closed`, `lti_only`, `lti_not_registered`, …).
4. `course.get_task(taskid)`; missing → 404. `task_is_visible_by_user` false (dispenser accessibility
   `after_start()` false and not staff) → render **`task_unavailable.html`** with **HTTP 200**
   (body "Error 403 Task unavailable").
5. Previous/next navigation: ordered TOC task list filtered to tasks with `after_start()` for the user;
   prev/next = neighbours in that list (None if the current task is not in it).
6. `user_saw_task(username, courseid, taskid)`: upsert of `user_tasks` (see Data).
7. If query has `submissionid` and `questionid` → file/input download (TASK-04), stop.
8. Random inputs (TASK-17): seed + generation, **`user_tasks.random` is overwritten at every display**.
9. `eval_submission` = `Submission(user_task.submissionid)` if set.
10. `submissions` = all submissions of the user for the task, newest first (only when logged in).
11. `visible_tags` = course tags with `visible: true` (or all tags for staff) — TASK-20.
12. Render `task.html` with `pdict = {pid: type}` and `is_input_list = {pid: 1 if input_type is list else 0}`.

## Alternative / error flows
- Anonymous on a non-previewable course → legacy renders the sign-in page (`auth.html`) in place (HTTP 200); the app redirects to the sign-in page.
- Anonymous on a previewable course → page displayed (no `user_tasks` document is written for anonymous visitors); left column shows the sign-in button.
- Logged-in but not registered, previewable course → page displayed, left column "Enroll in the course" (if registration possible) and the submit button replaced by disabled "Please enroll in the course to submit." (the server also refuses submissions from non-registered users — see TASK-08).
- Task YAML unreadable/invalid → HTTP 500.
- `user_tasks.submissionid` points to a deleted submission → `Submission.objects.get` raises → 500.

## UI elements
Layout = `layout.html` with left column (`{% block column %}`) and content.

**Breadcrumb**: icon link to `/mycourses` (registered) or `/courselist`; course name → `/course/<id>`; task name (active).

**Header** `<h2>` = task name; on the right (not in LTI): buttons
- `#load_loc` "Load my work from memory" → `load_from_storage(courseid, taskid)`: reads `localStorage["<courseid>/<taskid>"]` (JSON) and calls `load_input_<type>(null, pid, data)` for each problem (files cannot be restored). Throws if nothing was saved (JSON.parse(undefined)).
- `#save_loc` "Save my work in memory" → `save_to_storage`: `$('form').serializeArray()` of **all forms on the page** reduced to `{name: value}` (list for `is_input_list` problems, repeated names pushed) → `localStorage.setItem("<courseid>/<taskid>", JSON)`. Includes `@action`, `@random_i`.
- "Collapse context" toggles `#task_context` (Bootstrap collapse, shown by default).
- Previous / next task arrows (`btn-sm`) when available.

**Inline script** (before context): `var input = {"@lang": session.language, "@username": session.username, "@random": [floats], "@state": user_task.state if registered else ''}` — available to JS in the context (used by random-input tasks). A second `var input` without `@state` is re-declared at the end of the page.

**Context** `#task_context` = `task.get_context(lang)` RST → HTML (`| safe`).

**Alerts**: `#task_alert` (global result/feedback, loading spinner), per-problem `#task_alert_<pid>`.

**Hidden templates**: `#ssh_template` (SSH command + password, optional webterm iframe link from config `webterm`), `#messages` with translated strings `#answerall` "Please answer to all the questions.", `#internalerror` "Internal error", `#invalidext` "{} has not a valid extension.", `#filetooheavy` "{} is too heavy.".

**Form** `<form id="task" action="<task url or url_for('ltitaskpage') = /lti/task — also for LTI 1.3 sessions (legacy bug, LTI 1.3 page is /lti1.3/task)>" method="post" enctype="multipart/form-data">`:
- `data-wait-submission="<id>"` attribute for each waiting submission of the user (last one wins) → on load `loadOldSubmissionInput(id)` + `waitForSubmission(id)`.
- hidden `@random_<i>` inputs (all with the same `id="random_input"`), hidden `@action=submit`.
- One Bootstrap card per problem (`.problem.card`): header "Question n: name" (see task-model §4), body = `problem.show_input(lang, session.username)`.
- Submit area (in order of the template conditions):
  1. not registered → disabled "Please enroll in the course to submit."
  2. `task_can_user_submit(..., 'groups')` and `(..., 'tokens')` → enabled `#task-submit` "Submit"; for course admins also hidden `@debug-mode` (`#task-debug-mode`) and `#task-submit-debug` (terminal icon, tooltip "Start remote SSH console with this input") — TASK-12.
  3. task not open (`!accessibility.is_open()`) → disabled "The deadline is over, you cannot submit anymore".
  4. group task and no group → disabled "Please register in a group".
  5. no tokens → disabled "You have reached the submission limit." / "Your group have reached the submission limit." + "It will be refilled within the next {period} hour(s)" when period > 0.
  6. else disabled "You are not allowed to submit".

**Left column**:
- "Information" table: "Author(s)" (if any), "Contact" → "Contact link" (`contact_url.format(course_id, task_id, username)`, `target=_blank`), "Deadline" (not LTI): "It's too late" if never accessible, the soft end date (`show_time`) if any, else "No deadline"; row class `list-group-item-danger` when the task is open but past the soft deadline.
  Registered/staff only: "Status" (`#task_status`): "Not yet attempted" (no evaluated submission and no submission) / "Succeeded" (evaluated submission done+success) / "Waiting for verification" (any waiting) / "Failed"; "Grade" `#task_grade` = `user_task.grade` + "%"; "Attempts" `#task_tries` = `user_task.tried`.
  "Submission limit": "No limitation" or "{n} submissions<br/> every {h} hour(s)" or "{n} submissions".
  "Category tags": comma-joined dispenser `categories` ids (raw ids, not tag names).
- "Tags" (TASK-20) when `visible_tags` non-empty.
- Staff, not LTI: "Administration": warnings "This course is currently invisible for students…" / "This task is currently invisible for students…" (`!after_start()`), links "View submissions" (`/admin/<courseid>/submissions?tasks=<taskid>`), admins: "Edit task" (`/admin/<courseid>/edit/task/<taskid>`), "Debug information" (opens `#modal-debug`, TASK-21).
- Registered non-staff, not LTI: "Submitting as" → realname or "**Group**" for group tasks; link to `/group/<courseid>` labelled "Group : <description>" or "Group management".
- Plugin hook `task_menu(course, task)` entries (raw HTML).
- Registered: "For evaluation" ("Last submission" if evaluation_mode == last else "Best submission") with `#my_submission` (TASK-10) and "Submission history" list `#submissions` (TASK-10).
- Not logged in: sign-in button; logged in, not registered, registration possible: "Enroll in the course" alert + link `/register/<courseid>`.

**CodeMirror**: every `textarea.code-editor` becomes an editor (`registerCodeEditor(textarea, data-x-language, data-x-lines, data-x-first-line)`), stored in global `codeEditors[name]`; indentation follows the user preference (`code_indentation`).

## Data
- Reads `courses` (registration), `groups` (group of the user), `user_tasks`, `submissions` (list: all fields), course/task YAML.
- Writes `user_tasks` (on every display):
  - `user_saw_task`: `update_one({username, courseid, taskid}, {$setOnInsert: {username, courseid, taskid, tried: 0, succeeded: false, grade: 0.0, submissionid: null, state: ""}}, upsert)`.
  - `findAndModify({courseid, taskid, username}, {$set: {random: [floats]}})` (also `[]` when `input_random` is 0).
- `user_tasks` document example: `{_id, courseid:'task_showcase', taskid:'mcq_single', username:'task_alice', grade: 100.0, state:'{"capital": ""}', submissionid: ObjectId, succeeded: true, tried: 2, random: [], tokens: {amount: 2}}` (`tokens` only appears after the first graded submission; `tokens.date` may be absent).
- Config: `webterm` (SSH iframe), `allowed_file_extensions`, `max_file_size`.

## Permissions & security
- Registration is not required to *view* a task of a previewable course; staff see every task regardless of accessibility.
- "Task unavailable" is returned with HTTP 403 (legacy used 200; the message is kept).
- Context, problem headers and choice texts are author RST rendered to HTML; the HTML is sanitized before display. Plugin `task_menu` entries are rendered as plain links (label as text).
- `contact_url` placeholders `{course_id}`/`{task_id}`/`{username}` are substituted; a malformed template does not break the page; the link is only shown when the result is an `http(s):` or `mailto:` URL.
- Anonymous previews write nothing to `user_tasks`.
- GET records the visit in `user_tasks` (seen marker, random inputs); the page's state-changing actions are POST requests protected by the app's origin check.

## Acceptance tests
- Registered student opens `task_showcase/code_python`: title, breadcrumb, context (code block rendered), one card "Your function" (no "Question 1:" prefix), CodeMirror starting at line 3 with the default code, Information rows Author/Contact/Deadline "No deadline"/Status "Not yet attempted"/Grade "0.0%"/Attempts 0/Submission limit "No limitation"/Category tags "cat_basics", "Best submission" + "No submission".
- Opening the page creates `user_tasks{tried:0, grade:0, submissionid:null, state:"", random:[]}` once (idempotent).
- `mcq_centralize` shows "Question 1: …", "Question 2: …", "Question 3: …".
- Prev/next arrows follow the TOC order and skip tasks not yet started (`future_task`, `never_task` not reachable for students).
- `future_task` and `never_task` as student → "Task unavailable"; as tutor/admin → page with warning "This task is currently invisible for students…".
- `closed_task` → disabled button "The deadline is over, you cannot submit anymore", Deadline shows the end date.
- `soft_deadline` → deadline row has danger class, submit enabled.
- `limited_amount` → "2 submissions"; `limited_period` → "1 submissions every 1 hour(s)".
- `group_task` as `task_carol` (no group) → disabled "Please register in a group"; as `task_alice` → "Submitting as **Group**", "Group : Team A".
- Unregistered `task_dave` on `task_showcase` → 302 `/register/task_showcase`; on `task_preview/preview_mcq` → page with disabled "Please enroll in the course to submit.".
- Anonymous on `task_preview/preview_mcq` → page displayed with sign-in button; on `task_showcase/...` → sign-in page.
- Admin sees "Edit task", "Debug information" and the SSH button; tutor sees only "View submissions".
- Save/Load local storage round-trip restores code, single-line and MCQ answers.
- `contact_url` of `code_python` renders `mailto:teacher@example.org?subject=task_showcase/code_python/task_alice`.
