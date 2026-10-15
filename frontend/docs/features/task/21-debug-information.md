# Debug information (course admins) and stdout/stderr

- **ID**: TASK-21
- **Actors**: course admin, superadmin
- **Routes**: `@action=check` / `@action=load_submission_input` JSON field `debug`
- **Depends on**: TASK-08, TASK-09
- **Legacy code**: `legacy/inginious/frontend/pages/tasks.py:L211-L213,L324-L325,L374-L390`, `templates/task.html:L147-L149,L328-L347`, `static/js/task.js:L414-L438`, container API `scripts/INGInious.py` (stdout/stderr only in debug)

## Use case
Task authors inspect the raw result of the grading container (stdout, stderr, custom values,
state, tests…) directly from the task page to debug their grading scripts.

## Main flow
1. Every submission by a course admin is sent with `debug=True` → the container returns `stdout`/`stderr` of the run script (otherwise they are not collected: `null`/`""` in DB).
2. `submission_to_json(..., debug=is_admin)`: `tojson["debug"] = _cut_long_chains(submission.to_mongo())` — the full mongo document (top-level and nested dict strings/bytes longer than 1000 chars cut to 1000 + " <truncated>"), serialized with `json.dumps(default=str)` (ObjectIds/dates as strings).
3. JS `displayDebugInfo(data.debug)` renders a recursive `<dl><dt>key</dt><dd>value</dd>…` (text, escaped) in `#task_debug` inside the modal `#modal-debug` ("Debug information", opened from the left column link). The modal text: "The raw data from the container will be displayed here, helping you to debug the task.<br/> This box is only displayed because you are an administrator of this course. It is not displayed to students."

## Alternative / error flows
- Tutors (staff non-admin): no debug data, no modal.
- Lists (e.g. `username`, `problems` values) are not recursed (`isPlainObject` only) → shown as comma-joined text.

## UI elements
"Debug information" link + modal with definition list.

## Data
`submissions.stdout`, `submissions.stderr` (strings, admin jobs only), `custom`, `state`, `tests`, etc.

## Permissions & security
Admin-only; includes `user_ip`, `jobid`, the GridFS ids and (while running) ssh credentials.

## Acceptance tests
- As superadmin submit `code_python` → `check` JSON has `debug.stdout` "test 0 True\n…", `debug.stderr` "this goes to stderr\n", `debug.custom.passed`.
- As student → no `debug` key; DB `stdout`/`stderr` empty.
- Strings > 1000 chars are truncated with " <truncated>".
