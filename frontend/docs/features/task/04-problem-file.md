# Problem type `file` (file upload) and download of submitted inputs

- **ID**: TASK-04
- **Actors**: student (upload, re-download own files), tutor/admin (download any student's file)
- **Routes**: rendered in `GET /course/<courseid>/<taskid>`; upload with TASK-08 (multipart); download `GET /course/<courseid>/<taskid>?submissionid=<id>&questionid=<pid>` (legacy) / `GET /course/<courseid>/<taskid>/$input/<submissionid>/<pid>` (app)
- **Depends on**: TASK-01, TASK-08, TASK-10
- **Legacy code**: `legacy/inginious/common/tasks_problems.py:L217-L269` (`FileProblem`), `legacy/inginious/frontend/task_problems.py:L125-L155`, `templates/tasks/file.html`, `pages/tasks.py:L84-L110` (download), `static/js/task.js:L219-L248,L568-L570,L704-L718`, `app.py:L59-L69` (defaults)

## Use case
The student uploads a file (archive, source file, report) that the grading container reads;
later they (or staff) can download the file they submitted; PDFs are previewed inline.

## Preconditions
Problem `{type: file, header?, allowed_exts?, max_size?}` (task-model §4.3).

## Main flow
1. Render `tasks/file.html`:
   ```html
   <div id="task_alert_<pid>" class="task_alert_problem"></div>
   <header html>
   <a href="" id="download-input-file-<pid>" style="display:none" class="btn btn-info btn-block">Click here to download the file you submitted previously</a>
   <input type="file" name="<pid>" data-max-size="<max_size>" data-allowed-exts='["...", ...]'/><br/>
   <object id="download-input-file-pdf-<pid>" data="" type="application/pdf" style="display:none; width:100%; min-height:800px"><embed src="" type="application/pdf"/></object>
   Max file size: <filesizeformat(max_size, binary)> e.g. "1.0 KiB"
   Allowed extensions: .txt, .py
   ```
   `allowed_exts` defaults to config `allowed_file_extensions`, `max_size` to config `max_file_size`.
2. Client validation (`taskFormValid`): a file must be selected ("Please answer to all the questions." — file inputs can never be optional); extension check: some ext with `filename.lastIndexOf(ext) === filename.length - ext.length` (JS bug: the result is compared `> 0`, a boolean, so effectively "ends with"); else "<filename> has not a valid extension."; size `files[0].size > data-max-size` → "<filename> is too heavy.".
3. Server: `task_input[pid] = request.files.get(pid)` then `adapt_input_for_backend` → `{"filename": fs.filename, "value": fs.read()}`; on any exception (no file) → `{}`.
4. Consistency (`FileProblem.input_is_consistent`): key present; `filename.endswith(tuple(allowed_exts or default))` (case-sensitive); `sys.getsizeof(value) <= (max_size or default)` — **`sys.getsizeof(bytes)` = len + 33**, so the effective maximum is `max_size - 33` bytes (verified: 991 bytes accepted, 1000 rejected for `max_size: 1024`).
5. Stored inside the BSON input in GridFS as `{"filename": str, "value": BinData}`; the container sees `getinput <pid>` (content bytes) and `getinput <pid>:filename`.
6. When a submission is (re)loaded (`load_input_file`), if the input has the key: show the download link `href = <form action>?submissionid=<id>&questionid=<pid>`; if the filename ends with `.pdf`, also show the inline `<object>` PDF viewer with the same URL. (The input JSON returned by `load_submission_input` has file `value` blanked to `""`.)
7. Download (GET with both query params): the submission must belong to the course and task of the URL and be owned by the user (any submission of the course for its staff); `questionid` must be a problem id present in the input, else 404; value is a dict →
   - `mimetypes.guess_type(filename)`; non-`.pdf` files → `Content-Disposition: attachment` with the RFC 5987-encoded filename; `.pdf` → served inline;
   - value is not a dict (e.g. a code answer) → `text/plain` body = the value. Metadata keys (`@…`) are not downloadable (404).

## Alternative / error flows
- Wrong extension / too big / no file → JSON `{"status":"error","title":"Error","text":"Please answer to all the questions and verify the extensions of the files you want to upload. Your responses were not tested."}` (no submission).
- Download of a submission the user may not access, or invalid/unknown submission id → 404.
- Download through another task URL: the submission must belong to the course and task of the URL, else 404.

## UI elements
Client error card (verified, `bad.pdf` of 2000 bytes): `<div class="card border-danger mb-3" role="card"><div class="row no-gutters"><div class="col"><div class="card-header bg-danger text-white">Error</div><div class="card-body"><span>bad.pdf has not a valid extension.</span><br><span>bad.pdf is too heavy.</span></div></div></div></div>` (not dismissible). With no file: body "Please answer to all the questions.".

File input, max size and allowed extensions text, download button and PDF preview (hidden until a submission is loaded). LocalStorage save/load cannot restore files.

## Data
- Submission input: `"<pid>": {"filename": "my report.txt", "value": Binary(b"...")}`.
- Config: `allowed_file_extensions` (list), `max_file_size` (bytes, default 1 MiB).
- Archive download (staff) puts files under `<base>/uploaded_files/<pid><ext>` (TASK-23).

## Permissions & security
- Access: logged-in user with `username in submission.username`, or staff of the submission's course; the submission must belong to the course and task of the URL (same rule for `@action=check` and `load`, TASK-09/10).
- Only problem inputs are downloadable; `@`-metadata (`@email`, `@username`, `@state`, `@time`) is not served.
- The `Content-Disposition` header carries an ASCII fallback `filename` (characters other than letters, digits, `_`, `.`, `-` replaced by `_`) and the RFC 5987-encoded `filename*`.
- Downloads are served with `X-Content-Type-Options: nosniff`; PDFs are shown inline under a sandboxing `Content-Security-Policy`, other files are forced to download.
- Extension check is case-sensitive (`.TXT` refused) and based on the file name; the size check uses the real byte length (`max_size` bytes accepted).

## Acceptance tests
- `task_showcase/file_upload`: page shows "Max file size: 1.0 KiB" and "Allowed extensions: .txt, .py".
- Upload `ok.txt` starting with `INGInious` → success; feedback "File ``ok.txt`` accepted.".
- Upload `a.pdf` → client error "a.pdf has not a valid extension."; forced POST → generic JSON error, no DB write.
- Upload 1025-byte `.txt` → server rejects (`max_size: 1024`); 1024-byte → accepted.
- After a submission, clicking it in the history shows the download link; GET returns the exact bytes with `Content-Disposition: attachment; filename="my_report.txt"; filename*=UTF-8''my%20report.txt` and `text/plain`.
- A `.pdf`-named upload (task allowing `.pdf`) is shown inline via `<object>`.
- Another student requesting the download URL → refused (404).
- A tutor of another course requesting it through a task page of their own course → refused (404).
- Unknown `questionid` → 404.
