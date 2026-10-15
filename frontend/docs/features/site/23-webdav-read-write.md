# WebDAV server: reading and writing course files

- **ID**: SITE-23
- **Actors**: course admin, superadmin (WebDAV client)
- **Routes**: WebDAV methods on `<webdav_host>/<courseid>/<path>` (app: `/dav/<courseid>/<path>`): OPTIONS,
  HEAD, GET, PROPFIND, PUT, MKCOL, DELETE, COPY, MOVE, LOCK, UNLOCK (legacy also PROPPATCH)
- **Depends on**: SITE-22, COURSE/TASK loading (`Course.get`, filesystem cache)
- **Legacy code**: `webdav.py:L77-200` (`INGIniousDAVCourseFile`, `INGIniousFilesystemProvider`),
  `common/filesystems/__init__.py:L151-167` (`fetch_or_cache`, mtime-based cache)

## Use case
Bulk-edit or version-control course content: upload task folders, edit run scripts, fix course.yaml,
download everything.

## Main flow
App behaviour (`app/src/lib/server/webdav/index.ts`):
- the path is normalised (`..` and percent-encoded forms) and must stay below the DAV root, its
  first segment must be an existing course (else 404), and every file access is joined with
  path confinement to that course folder, symbolic links included;
- GET on a folder returns a plain-text listing; PROPFIND supports depth 0/1 (`resourcetype`,
  `getcontentlength`, `getlastmodified`, `getetag`); OPTIONS → `DAV: 1, 2`,
  `Allow: OPTIONS, GET, HEAD, PROPFIND, PUT, MKCOL, DELETE, COPY, MOVE, LOCK, UNLOCK`;
- PUT writes the file atomically (201 create / 204 overwrite; 409 when the parent folder is
  missing, 405 on a folder); a PUT of an invalid `course.yaml` (course root) or `task.yaml`
  (task root) → 400 "Invalid descriptor", nothing written;
- DELETE, MOVE and COPY of the course root or of `course.yaml` → 403; COPY/MOVE destinations must
  stay inside the same course and cannot be the course root, `course.yaml` or the source itself
  (403); `Overwrite: F` on an existing destination → 412;
- LOCK/UNLOCK are advisory (a fresh `opaquelocktoken` is returned, nothing is enforced);
- the web application reloads course and task descriptors whose mtime changed, so writes are
  visible on the next request.

Legacy flow (reference):
1. Path mapping: `/<courseid>/<inner...>` → `abspath(join(<course fs prefix>, *inner))`; the course
   must load (`Course.get(courseid)`) else 404 "Unknown course <id>". Resources are the WsgiDAV
   filesystem `FolderResource`/`FileResource` (full read/write).
2. Reading: GET file content (e.g. `run` script), PROPFIND (Depth 0/1; properties incl.
   `getlastmodified`, `getetag`, `getcontentlength`, `getcontenttype`, quota, `lockdiscovery`),
   GET on a folder → WsgiDAV HTML directory browser ("WsgiDAV - Index of /<course>/").
   OPTIONS → `DAV: 1,2`, `Allow: OPTIONS, HEAD, GET, PROPFIND, DELETE, COPY, MOVE, PROPPATCH, LOCK, UNLOCK` (+PUT/MKCOL where applicable).
3. Writing anything except `course.yaml`/`course.json` at the course root: plain filesystem semantics
   (PUT 201 create / 204 overwrite, MKCOL 201, DELETE 204 incl. recursive folder delete, COPY/MOVE).
   An invalid `task.yaml` was accepted and the task became unreadable in the frontend.
4. `course.yaml` / `course.json` (special `INGIniousDAVCourseFile`):
   - DELETE, MOVE, COPY (as source) → **403**;
   - PUT: content written to `course.yaml.webdav_tmp`; on success the original is copied to
     `course.yaml.webdav_backup`, the new content written to `course.yaml`, then `Course.get(courseid)`
     is attempted: if it fails the original content is **restored silently**; backup removed.
     The client always receives success (204) — verified: invalid YAML PUT → 204 but file unchanged;
     valid PUT → 204 and new name visible immediately in the frontend/API.
5. Frontend pick-up: no explicit invalidation; the frontend's course/task cache (`fetch_or_cache`)
   reloads a file whenever its **mtime** is newer than the cached one, so WebDAV writes are visible on
   the next request (verified for course name and a new task folder created with MKCOL+PUT, which
   appeared immediately in `/api/v0/courses`).
6. Locks: in-memory WsgiDAV lock manager (LOCK 200 with `opaquelocktoken`, UNLOCK 204); locks are lost on restart
   and not honoured by the frontend's own editors.

## Alternative / error flows
- Paths are normalised (`..`, `%2e%2e`) before the course is selected, so `/A/../A2/file` designates
  `A2/file` and is checked against course `A2`; a path leaving the DAV root is refused (404).
- Symlinks cannot lead outside the course folder.
- Request for a nonexistent file → 404; nonexistent course → 404.

## Data
Filesystem under `tasks_directory/<courseid>/`; temporary files `course.yaml.webdav_tmp`,
`course.yaml.webdav_backup` (removed after write). No DB writes (except API key creation, SITE-22).

## Permissions & security
- Course admins can upload arbitrary `run` scripts/executables (by design: they define grading).
- Upload size is bounded by the request body limit of the Node server (`BODY_SIZE_LIMIT` of
  adapter-node).
- Paths are confined to the course folder (see above); files, including `course.yaml`, are
  replaced atomically; invalid course and task descriptors are refused.
- Concurrent edits from the web task editor and WebDAV are not coordinated.

## Acceptance tests
- GET/PROPFIND/PUT/MKCOL/DELETE on task files work for a course admin.
- course.yaml: DELETE/MOVE/COPY → 403; invalid content PUT → 400 and file unchanged; valid PUT → updated and visible in the web app without restart.
- Invalid `task.yaml` PUT → 400, file unchanged.
- A task created through WebDAV appears in the course task list/API.
- `/A/../A2/file` is checked against course `A2` (an admin of `A` only gets 401); `/../x` → 404.
