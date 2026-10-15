# Task files management (list, create, upload, edit, rename/move, delete, download)

- **ID**: CADM-14
- **Actors**: course admin, superadmin
- **Routes**: `GET /admin/<courseid>/edit/task/<taskid>/files[?action=download|delete|rename|create|edit&path=…&new_path=…]`, `POST /admin/<courseid>/edit/task/<taskid>/files` (`action=upload|edit_save`) (endpoint `coursetaskfiles`)
- **Depends on**: CADM-10 (embedded as the "Task files" tab; file editors are saved by the task save button), CADM-02
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/task_edit_file.py:L17-L246`; `templates/course_admin/edit_tabs/files.html:L1-L69`, `edit_tabs/file_modals.html:L1-L32`; `static/js/studio.js:L56-L243,L685-L750`; `common/filesystems/local.py:L36-L168`, `common/filesystems/__init__.py:L50-L57`

## Use case
The admin manages the files of a task folder (grading script `run`, templates, student files…) directly from the
task editor: browse, create files/folders, upload (button or drag & drop), edit text files in CodeMirror tabs,
rename/move, delete, download a file or the whole folder as a zip.

## Preconditions
- Admin rights and an existing, loadable task (`get_course_and_check_rights(courseid, taskid)`). In the rewrite: 403
  without admin rights, 404 for an unknown or invalid course or task id.

## Main flow
1. **List** (`GET …/files` without action, also the response of every action except edit/edit_save/download): HTML fragment `files.html` = `<div class="tab-pane show active" id="tab_file_list">`, optional error alert (centered `alert-danger`), table (`upload-area`) with columns "Path", "Download", "Edit", "Move", "Delete":
   - first row "/" (folder icon) with a download link (`?action=download&path=/`; its `onclick` calls an undefined `studio_task_edit_downloadfile` → JS ReferenceError, so `return false` is never reached and the browser follows the link: the zip is downloaded as `files.zip` (verified));
   - one row per entry of `get_task_filelist(task_fs)`: recursive listing excluding the root `task.yaml` (hidden files are **not** excluded despite the docstring), each level sorted by name, files before sub-directories, indentation 6 `&nbsp;` per level, folder icon for directories, row attribute `data-x-path="<complete path>"` (paths start with `/`, directories end with `/`). Buttons: Download (link), Edit (files only: `studio_task_file_open_tab('<path>')`), Move/Rename (`studio_task_file_rename('<path>')`), Delete (`studio_task_file_delete('<path>')`).
   - footer: "Create a new file" (`studio_task_file_create()`), "Upload a file" (opens `#modal_file_upload`).
   - after the table `<p id="dragtext">` "Drag and drop a file here." (shown while dragging).
2. **Create** (`studio_task_file_create`): `prompt("Enter the path to the file", "newfile.sh")` → GET `?action=create&path=<p>`. Server: strip; prepend `/` if missing; trailing `/` → directory (`ensure_exists`), else empty file; `verify_path(new_path=True)` must succeed (else "Invalid new path").
3. **Upload**: modal "Upload a file" — form `#task_upload_form` (multipart): hidden `action=upload`, file input `file` ("File:", on change copies the base file name into the path field), text `path` "File path:" (default `my_new_file.zip`), buttons "Close"/"Upload" → `ajaxSubmit` POST to `…/files`. **Drag & drop** a file on the table: POST FormData `{action: "upload", file, path: <file name>}` (first file only). Server: strip, prepend `/`, `verify_path(new_path=True)` (existing path → "Invalid new path"; no overwrite), `task_fs.put(path, file.read())` (sub-directories created) → list; write error → "An error occurred while writing the file".
4. **Edit**: opens (or focuses) a tab `task_file_editor_<n>` labelled with the path and a close button; GET `?path=<p>&action=edit` (`dataType: json`) → `{"content": "<utf-8 text>"}` or `{"error": "not-readable"}` (non UTF-8, verified with `\xff\xfe`) → "INGInious can't read this file."; invalid path → plain text "Internal error" (JSON parse error client-side). CodeMirror mode from file name (`CodeMirror.findModeByFileName`), else `text/plain`; if path is `/run` → python; shebang `#!` → mode by interpreter name (CodeMirror modeInfo, then hints bash/sh/zsh→shell, python, php); 20 lines. Editor registered in `codeEditors[path]`.
   Closing a modified tab asks "You have unsaved change to this file. Do you really want to close it?".
5. **Save edited files**: only through the task "Save changes" (CADM-10): synchronous POST `{path, action: "edit_save", content}` per open tab → `{"ok": true}` (editor marked clean) / `{"error": true}`. The path must already exist (`verify_path` with `new_path=False`) — edit_save cannot create files.
6. **Rename/Move** (`studio_task_file_rename`): `prompt("Enter the new path", path)` → GET `?action=rename&path=<old>&new_path=<new>` (closes the tab of the old path first). Server: both normalised; old must exist ("Internal error"), new must not exist ("Invalid new path"); `task_fs.move` (creates parent dirs, `shutil.move`) → error "An error occurred while moving the files".
7. **Delete** (`studio_task_file_delete`): `confirm("Are you sure you want to delete this?")` → GET `?action=delete&path=<p>` → file unlinked or directory `rmtree`; invalid → "Internal error"; failure → "An error occurred while deleting the files".
8. **Download**: GET `?action=download&path=<p>`: file → streamed with guessed mimetype or `application/octet-stream`, **no Content-Disposition** (displayed inline by the browser); directory → `application/zip` streamed (zipstream) with relative paths, files only (empty dirs omitted), **including `task.yaml`** for `/` (verified). Invalid path → 404 "This path doesn't exist.".
9. All list responses replace `#tab_file_list` in the editor (`$("#tab_file_list").replaceWith(data)`); "Loading" is shown during requests.

### `verify_path(task_fs, path, new_path=False)`
Returns the relative path or `None`: task folder must exist; path **must start with `/`** (then removed); contains `..` → None; `task_fs.exists(path) == new_path` → None (must exist for existing-path actions, must not exist for new paths); `path == "task.yaml"` → None. Then the FS provider `_checkpath` also rejects leading `/`, `..`, leading/trailing whitespace (raising → caught as generic errors).

## Alternative / error flows (verified)
- `create path=run` twice → "Invalid new path"; `../evil` → "Invalid new path"; `task.yaml` → "Invalid new path".
- `edit_save path=run` (no leading slash) → `{"error": true}`; `edit_save` on a non-existing path → `{"error": true}`.
- Paths are normalised before any check: the root `task.yaml` cannot be read, written, renamed or deleted through this endpoint, whatever its spelling (e.g. `/./task.yaml`).
- Delete or rename of the root `/` is refused.
- Upload to an existing path → "Invalid new path" (no overwrite option).
- Leading/trailing spaces are stripped for create/upload/rename/delete (`" /x y.txt"` → `x y.txt`), but not for edit/edit_save/download.
- All operations are confined to the task folder: paths are resolved through their real path, so a path that goes
  through a symlink pointing outside the task folder is refused; symlinks are not followed when a folder is zipped.

## Data
- Disk only: `<tasks_directory>/<courseid>/<taskid>/**`.

## Permissions & security
- Admin only.
- State-changing actions (create, upload, edit_save, rename, delete) are POST requests protected against cross-site request forgery.
- File names and paths are handled as data and always escaped when rendered (list, buttons, editor tab labels).
- Downloads are sent as attachments (`Content-Disposition: attachment`) with `X-Content-Type-Options: nosniff`.
- Uploads are subject to the server's request body size limit (`BODY_SIZE_LIMIT` of the Node adapter, 512 KB by
  default).

## Acceptance tests
- List shows nested files/dirs in the documented order and hides only the root `task.yaml`.
- Create `run`, `/dir/sub/`, `/dir/a.txt`; duplicates → "Invalid new path"; `..` → error.
- Upload via modal and via drag & drop; existing path → error.
- Edit `/run`, change content, click task "Save changes" → file updated; non-UTF-8 file → "INGInious can't read this file.".
- Rename `/dir/a.txt` → `/moved/b.txt` (parent created).
- Delete a file and a directory.
- Download a file (mimetype) and `/` (zip containing task.yaml).
- Test: `/./task.yaml` cannot be read/written; `path=/` delete refused; destructive actions require POST with origin check; file names with quotes/HTML render safely; downloads are attachments.
