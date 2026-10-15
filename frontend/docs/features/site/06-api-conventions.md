# REST API v0: common conventions (framework, formats, errors)

- **ID**: SITE-06
- **Actors**: API client (scripts, IDE plugins, mobile apps), any HTTP client
- **Routes**: every `/api/v0/*` route (SITE-07..11)
- **Depends on**: AUTH (session cookie)
- **Legacy code**: `legacy/inginious/frontend/pages/api/_api_page.py:L1-187`, `flask/mapping.py:L143-158`,
  `pages/utils.py:L20-56` (`INGIniousPage`)

## Use case
External programs interact with INGInious (list courses/tasks, submit, read results) with a
cookie-based session obtained from `POST /api/v0/authentication`.

## Main flow / behaviour
App behaviour (`app/src/lib/server/api/index.ts`, catch-all route `/api/v0/[...path]`): same
URLs, cookie session and JSON shapes as legacy, with these differences:
- the output format is negotiated on `Accept`, then on the request `Content-Type`: YAML
  (`text/yaml; charset=utf-8`) for `text/yaml`, `text/x-yaml`, `application/yaml`,
  `application/x-yaml`; JSON (`application/json; charset=utf-8`) otherwise (no `<pre>` HTML
  output);
- an unsupported method on a known URL → **405** `{"error": "This endpoint has no such
  method"}` with `Allow` (the implemented methods); an unknown URL → 404 `{"error": "Not found"}`;
  `HEAD` is answered like `GET`;
- POST bodies may be form data or a JSON object;
- authenticated endpoints refuse anonymous and LTI sessions with 403 `{"error": "You are
  not authenticated"}`;
- the language is the session language (or `Accept-Language` on the first request).

Legacy behaviour (reference):
1. **Routes** (all under `/api/v0`):
   | Path | Class | Methods implemented |
   |---|---|---|
   | `/auth_methods` | `APIAuthMethods` (APIPage) | GET |
   | `/authentication` | `APIAuthentication` (APIPage) | GET, POST |
   | `/courses`, `/courses/<courseid>` | `APICourses` (authenticated) | GET |
   | `/courses/<courseid>/tasks`, `/courses/<courseid>/tasks/<taskid>` | `APITasks` (authenticated) | GET |
   | `/courses/<courseid>/tasks/<taskid>/submissions` | `APISubmissions` (authenticated) | GET, POST |
   | `/courses/<courseid>/tasks/<taskid>/submissions/<submissionid>` | `APISubmissionSingle` (authenticated) | GET |
2. **Authentication**: the Flask/Mongo session cookie `inginious_session_id` (HttpOnly, SameSite=Lax,
   `Path=/`, expiry `session_parameters.timeout`, default 86400 s). The same session is shared with the
   web UI (a web login works for the API and vice versa). Every response sets/refreshes the cookie.
   Authenticated endpoints check `session.loggedin`; otherwise `403 {"error": "You are not authenticated"}`.
   There is **no API key / token authentication** for the REST API (the API key is only for WebDAV).
3. **Language**: `?lang=xx` (in available languages) sets `session.language`; else Accept-Language
   is used on first request (affects translated names in responses).
4. **Output format negotiation** is based on the **request `Content-Type` header** (not `Accept`!),
   `_api_convert_output` L162-187:
   - contains `text/json` (or header absent → default `text/json`) → body `json.dumps(value)`,
     response `Content-Type: text/json; charset=utf-8`;
   - contains `text/html` → `"<pre>" + yaml.dump(value) + "</pre>"`, `text/html; charset=utf-8`;
   - contains `text/yaml`, `text/x-yaml`, `application/yaml` or `application/x-yaml` → YAML dump,
     `Content-Type: text/yaml; charset=utf-8`;
   - anything else (e.g. `application/x-www-form-urlencoded`, `multipart/form-data` for POSTs) → JSON
     with `text/json; charset=utf-8`.
   Note: JSON uses Python `json.dumps` defaults (`", "` and `": "` separators, non-ASCII escaped as `\uXXXX`).
5. **Errors** (`APIError` subclasses) — body is JSON/YAML per the rule above:
   | Error | Status | Body |
   |---|---|---|
   | `APIInvalidArguments` | 400 | `{"error": "Invalid arguments for this method"}` |
   | `APIForbidden(msg)` | 403 | `{"error": "<msg>"}` (default "You are not authenticated") |
   | `APINotFound(msg)` | 404 | `{"error": "<msg>"}` (default "Not found") |
   | `APIError(500, str(ex))` | 500 | a **bare JSON string**, e.g. `"A submission is already pending for this task!"` |
   | `APIInvalidMethod` | **200 (bug)** | `{"error": "This endpoint has no such method"}` + header `Allow: GET` (comma-joined list of implemented methods). The code passes a pre-built `Response()` whose status is never set, so the status is 200 instead of 405. |
6. **HTTP methods**: `INGIniousPage` only defines Flask `get`/`post`, so Flask's `MethodView` only
   routes GET, POST (plus automatic HEAD/OPTIONS). Consequences (verified):
   - PUT/DELETE/PATCH on any API URL → Flask's own **HTML** `405 Method Not Allowed` with
     `Allow: POST, OPTIONS, GET, HEAD`;
   - POST on a GET-only endpoint (e.g. `POST /api/v0/auth_methods`, `POST /api/v0/courses`
     when logged in) → JSON "This endpoint has no such method", status 200, `Allow: GET`;
     when not logged in, authenticated endpoints answer 403 first;
   - `API_PUT/DELETE/PATCH/HEAD/OPTIONS` handlers in `APIPage` are dead code.
7. Unhandled exceptions → Flask HTML 500 page (`internalerror.html`), not JSON (several cases listed in SITE-10/11).

## Data
Session stored in MongoDB `sessions` collection (see AUTH). No other data.

## Permissions & security
- The session cookie is `HttpOnly` and `SameSite=Lax` by default; form-encoded API POSTs
  (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`) are refused (403)
  unless their `Origin` header is the site's own origin. No CORS headers are sent (browsers
  from other origins can't read responses, nor send JSON POSTs without a preflight).
- LTI sessions are not accepted by the API.
- Cookie-only auth means API clients must keep a cookie jar.
- See SITE-07 for session handling at login.

## Acceptance tests
- Each error type returns the documented status and body.
- `Accept: text/yaml` or `Content-Type: text/yaml` request header → YAML body and
  `text/yaml; charset=utf-8`; no header → JSON `application/json; charset=utf-8`.
- PUT on `/api/v0/courses` → 405; POST on `/api/v0/auth_methods` → 405 + `Allow: GET` +
  `{"error": "This endpoint has no such method"}` (legacy: status 200).
- A form-encoded POST without the site's `Origin` → 403.
- Unauthenticated GET `/api/v0/courses` → 403 `{"error": "You are not authenticated"}`.
