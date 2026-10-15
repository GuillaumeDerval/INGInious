# Submissions CSV export

- **ID**: CSTU-12
- **Actors**: course admin, tutor, superadmin
- **Routes**: `POST /admin/<courseid>/submissions` with `csv` and `displayed_selection`
- **Depends on**: CSTU-11
- **Legacy code**: `pages/course_admin/submissions.py:L37-L43`, `pages/course_admin/utils.py:L169-L226` (`make_csv`), `templates/course_admin/submissions.html:L74-L87`

## Use case
Export the metadata of all currently selected submissions (not only the visible page) to a
spreadsheet, e.g. to compute custom grades.

## Preconditions
Staff rights; a `displayed_selection` JSON (from CSTU-11).

## Main flow
1. Table header button "Download CSV" (`<button name="csv" formmethod="post">`) in the form carrying `displayed_selection`.
2. Server: `params = get_input_params(json.loads(displayed_selection))`; `data = get_selected_submissions(...)` **without limit/skip** (all matching), with `eval` honoured; then `make_csv(data)`.

## Legacy status: BROKEN
- Verified: returns **HTTP 500** (`AttributeError: 'Submission' object has no attribute 'items'`) because `make_csv`
  expects dicts but receives mongoengine `Submission` documents. The feature is therefore unusable in the current legacy build.
- Intended format (upstream INGInious, where submissions were dicts): `text/csv; charset=utf-8`, `filename=export.csv`;
  one row per submission; columns = sorted union of the submission document keys (`_id`, `courseid`, `taskid`,
  `username` (Python list repr), `status`, `submitted_on`, `grade`, `result`, `text`, `problems`, `tests[...]`
  flattened as `tests[<tagid>]`, `custom[...]`, `input` (GridFS id), `archive`, `user_ip`, `state`, `stdout`, `stderr`,
  `jobid`, `last_replay`, `best`, …); dict values flattened as `key[subkey]`; values `str()`-ed.
- Recommendation for the rewrite: implement it (parity with intended behaviour) with an explicit, documented column
  list (e.g. `id, courseid, taskid, username (comma-joined), submitted_on (ISO), last_replay, status, result, grade, best, tests[…]`),
  neutralise formula prefixes in cells, never include the raw input or archive.

## Alternative / error flows
- Missing `displayed_selection` ⇒ 500 (`json.loads("")`).

## UI elements
Info-coloured table icon button, tooltip "Download CSV".

## Data
Read-only on `submissions`, `user_tasks`.

## Permissions & security
Tutors allowed (same as listing). CSV text cells starting with a formula character (`=`, `+`, `-`, `@`, tab, carriage return) are neutralised (prefixed with `'`).

## Acceptance tests
- POST `csv` with a selection of N submissions ⇒ `text/csv` attachment with N data rows (all pages), header as specified.
- Selection with `eval` ⇒ only evaluation submissions.
- Cells beginning with `=`/`+`/`-`/`@` are escaped.
