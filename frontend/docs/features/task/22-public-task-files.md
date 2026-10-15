# Public task files (`/course/<courseid>/<taskid>/<path>`)

- **ID**: TASK-22
- **Actors**: anyone who can open the course (incl. previewing users; LTI sessions through `/lti/asset`, LTI-06)
- **Routes**: `GET /course/<courseid>/<taskid>/<path:path>` (endpoint `taskpagestaticdownload`); `taskid = $common` for course-wide files
- **Depends on**: TASK-18, COURSE access
- **Legacy code**: `legacy/inginious/frontend/pages/tasks.py:L393-L429`, `common/filesystems/__init__.py:L50-L56` (`_checkpath`), `common/filesystems/local.py:L150-L170` (`distribute`)

## Use case
Statements embed images, data files or downloadable templates stored in the task's `public/`
folder (or the course `$common/public/` folder) through relative links.

## Preconditions
Files under `<task>/public/` or `<course>/$common/public/`.

## Main flow
1. `INGIniousPage` (no login required by the page itself; `is_lti_page = True` so LTI sessions are kept).
2. `course_is_open_to_user(course, session.username)` false → `handle_course_unavailable` (anonymous on a non-previewable course → **302 `/register/<courseid>`**, verified).
3. `path_norm = posixpath.normpath(unquote(path))`.
4. `taskid == "$common"` → `course_fs/$common/public`; else the task must exist (404) and be visible (`task_is_visible_by_user`, else `task_unavailable.html` 200) → `task_fs/public`.
5. `public_folder.distribute(path_norm, allow_folders=False)`: malformed paths (leading `/`, `..`, surrounding spaces) → 404; missing → `("invalid")` → 404; folder → 404; file → `("local", mimetypes.guess_type or application/octet-stream, open file)` → `Response(file, content_type)` (inline, no Content-Disposition, no caching headers). Other FS providers may return `("url", …)` → 302 redirect.

## Alternative / error flows
| Request (verified) | Result |
|---|---|
| `task_info/hello.txt` | 200 `text/plain` |
| `task_info/sub/data.json` | 200 `application/json` |
| `task_info/pixel.svg` | 200 `image/svg+xml` |
| `$common/common.txt` | 200 |
| `task_info/sub` (folder) | 404 |
| `task_info/secret.txt` (outside public) | 404 |
| `task_info/%2e%2e/secret.txt`, `task_info/..%2fsecret.txt`, `task_info/%20hello.txt` | 404 |
| `future_task/x.txt` as student | 403 "Task unavailable" (legacy: 200 task_unavailable page) |
| any path as anonymous (non-preview course) | 302 to the sign-in page (legacy: 302 `/register/task_showcase`) |

## UI elements
None (raw file responses). Links in the context are relative (`task_info/hello.txt` from `/course/<c>/<t>`).

## Data
Filesystem only.

## Permissions & security
- Paths are confined to the `public/` folder (symlinks included): paths leaving it through `..`, absolute paths and NUL bytes → 404; folders and missing files → 404.
- Known inline types (images, SVG, HTML, PDF, text, JSON, CSS, CSV) are served with a sandboxing Content-Security-Policy (`default-src 'none'; …; sandbox`), so author-provided files cannot run scripts; other files are sent as attachments.

## Acceptance tests
- Table above (status codes and content types), for a registered student of `task_showcase`.
- LTI sessions fetch the files of their task through the LTI asset route `/lti/asset/<path>` (LTI-06).
- Anonymous on `task_preview` (previewable) can fetch public files.
