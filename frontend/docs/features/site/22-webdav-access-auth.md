# WebDAV server: deployment, authentication and per-course access rights

- **ID**: SITE-22
- **Actors**: course admin (and superadmin) using a WebDAV client (davfs, Cyberduck, Windows/macOS Finder, curl)
- **Routes**: app: every method on `/dav/<courseid>/...` of the web application (set `webdav_host` to
  `<public url>/dav`); legacy: separate WSGI app (default port 8080 of `inginious-webdav`; reference env:
  http://localhost:8081), every path `/<courseid>/...`; info panel on GET /admin/<courseid>/tasks
- **Depends on**: COURSE-ADMIN task list page (info panel), AUTH (users), SITE-23
- **Legacy code**: `legacy/inginious/frontend/webdav.py:L26-75` (domain controller), `L203-239` (`get_app`),
  `legacy/inginious/scripts/webdav.py:L1-76`, `user_manager.py:L252-266` (`get_user_api_key`), `L785-796`
  (`has_admin_rights_on_course`), `templates/course_admin/task_list.html:L64-84`

## Use case
Course administrators edit their course files (course.yaml, task folders, run scripts, `$common`)
with their usual tools by mounting the course folder over WebDAV, authenticating with their
username and a personal API key.

## Preconditions
App: `webdav_host` configured (used for the info panel URL); the WebDAV tree is served by the
web application itself under `/dav/` (`app/src/lib/server/webdav/index.ts`). Legacy (reference):
- `inginious-webdav` running with the same `configuration.yaml` as the frontend: needs `tasks_directory`
  (local FS only: otherwise `RuntimeError("WebDav access is only supported if INGInious is using a local filesystem to access tasks")`),
  `mongo_opt.host`, `superadmins`, `plugins` (only for problem-type registration), `webdav_host`.
  Note: the WebDAV app reads `config["database"]` (not `mongo_opt.database`) for the DB name, default `INGInious`.
- Start: `inginious-webdav --config <file> --host <h> --port <p>` (env `INGINIOUS_WEBAPP_CONFIG`,
  `INGINIOUS_WEBDAV_HOST` default `localhost`, `INGINIOUS_WEBDAV_PORT` default 8080); also importable as
  WSGI `inginious.scripts.webdav:application` (gunicorn in the reference env). Werkzeug `get_input_stream`
  middleware bounds PUT bodies by Content-Length.
- WsgiDAV 4.3.3 with its `DEFAULT_CONFIG` (dir browser enabled, basic + digest accepted, digest offered by default, in-memory lock manager).

## Main flow
1. Course admin opens **Tasks** page of a course (`/admin/<courseid>/tasks`). If `webdav_host` is
   configured, a collapsible card "WebDAV access" shows (`img/webdav-info.png`): "Use this URL to access
   your course folder using WebDAV:" and a table: URL = `<webdav_host>/<courseid>`, Username =
   `session.username`, Password = `user_manager.get_user_api_key(session.username)` (**the API key is
   generated and stored at that moment if missing**: 80 hex chars from a CSPRNG).
2. The client connects to `<webdav_host>/<courseid>/`. The **realm = first path segment** (course id).
3. Authentication (app):
   - the path is normalised first; its first segment must be an existing course (else 404);
   - authentication is always required (no anonymous access), HTTP Basic only;
   - allowed iff the password equals the user's API key (constant-time comparison) and the user
     administers that course (course `admins` or superadmin; tutors are refused);
   - failed attempts are counted per account and per client address; once a limit is reached
     further attempts are refused without checking the key (shared credential limiter: 20
     failures per account and 100 per client per 15 minutes);
   - legacy also offered Digest (MD5, qop=auth) computed from the API key; the app does not.
4. Every request re-authenticates (no session/cookie).

## Alternative / error flows
- No credentials → `401` + `WWW-Authenticate: Basic realm="<courseid>"` (legacy: a Digest challenge).
- Wrong key → 401. Tutor (even with own key) → 401. Admin of course A on course B → 401.
- Too many failed attempts → 401 until the window ends, even with correct credentials.
- Correct Basic credentials → normal WebDAV behaviour (e.g. PROPFIND Depth 1 → 207).
- Unknown username → 401.
- Request to the root or a non-course first segment → 404 — there is no root listing of courses.
- Authentication attempts never create an API key (keys are only created by the info card).
- Legacy only: `webdav_host` sub-path handling used `host.lstrip("https://")`, which strips a
  character set, not a prefix (e.g. `https://test.org/dav` → `est.org/dav`).

## UI elements
Card "WebDAV access" (collapsed by default, chevron), shown on the Tasks page to course admins only
(the users WebDAV accepts).

## Data
- `users.apikey` (string, 80 hex chars), created lazily by `get_user_api_key(username, create=True)`
  (task list page). See AUTH for viewing/renewing it.
- course.yaml `admins`, config `superadmins`.

## Permissions & security
- API key = WebDAV password, compared in constant time.
- Authentication failures are rate-limited per account and per client address.
- The path is normalised before the course (realm) is selected (see SITE-23), so a request is always
  checked against the course whose files it accesses.
- Only course realms are accepted; the course admin check applies to every request.
- No cookie session is used, so the `/dav/` endpoints are exempt from the origin check of form POSTs.

## Acceptance tests
- Info card shows URL `<webdav_host>/<courseid>`, username, API key (and creates key if missing); absent when `webdav_host` unset.
- Admin with key: PROPFIND 207; wrong key 401; tutor 401; other course 401; superadmin OK on any course.
- No credentials → 401 with a Basic challenge, realm = course id.
- Repeated wrong keys for an account → further attempts refused (401) for the rest of the window.
- Key generation format: 80 lowercase hex chars stored in `users.apikey`.
