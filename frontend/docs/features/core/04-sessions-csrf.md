# Sessions (MongoDB `sessions`, signed cookie) and CSRF protection

- **ID**: CORE-04  (complements AUTH-04, which describes the session lifecycle for login/LTI; this file pins the wire format, verified behaviour and the expected protections)
- **Actors**: every client (anonymous, logged-in, LTI user, API client)
- **Routes**: all routes (cross-cutting); `?session_id=<id>` accepted on the LTI paths (`/lti/...`, `/lti1.3/...`) for LTI sessions
- **Depends on**: —
- **Legacy code**: `legacy/inginious/frontend/flask/mongo_sessions.py:20-82`, `legacy/inginious/frontend/models/session.py:12-63`, `legacy/inginious/frontend/app.py:44-55,78-86,141-144,189-193`, `legacy/inginious/frontend/user_manager.py:171-212` (connect/disconnect), `legacy/inginious/frontend/pages/lti/v1_1/__init__.py`, `pages/lti/v1_3/__init__.py` (LTI sessions)

## Use case
Every browser gets a server-side session (stored in MongoDB) identified by a signed cookie, holding
login state and UI preferences. LTI launches inside LMS iframes use the same session documents but
carry the id in the URL instead of a cookie. The rewrite reads and writes the *same* documents; the cookie
signature (HMAC-SHA256 instead of the legacy itsdangerous HMAC-SHA1) differs, so sessions are not shared between both frontends.

## Preconditions
- `session_parameters.secret_key` configured (startup aborts otherwise, `app.py:44-55`).

## Main flow
1. **Open** (`open_session`, `mongo_sessions.py:35-68`), on every request:
   1. If the URL endpoint is an LTI launch (`LTI11LaunchPage.endpoint` = `ltilaunchpage`, `LTI13LaunchPage.endpoint` = `lti1.3launchpage`) -> brand-new `Session(permanent=True, is_lti=True)` (never reuses a cookie).
   2. `sid = request.args['session_id']` if present, else the cookie `<cookie_name>` (default `inginious_session_id`).
   3. No sid -> new `Session(permanent=True)` (fresh ObjectId, not yet saved).
   4. Cookie sid (not query) -> verify signature with `itsdangerous.Signer(secret_key, salt='flask-session', key_derivation='hmac')` (SHA-1). Bad signature -> new empty session. A query `session_id` is only accepted for a session with `is_lti: true`.
   5. Load `sessions` doc `_id = ObjectId(sid)`; if `expiration <= now` delete it and start a new session; if not found start a new one.
2. **Save** (`save_session`, `mongo_sessions.py:70-82`), on *every* response (including 404/403/500, excluding `/static/` served by middleware):
   - `session.expiration = now + PERMANENT_SESSION_LIFETIME` (`timeout`, default 86400 s) -> sliding expiration; `session.save()` (upsert of the whole document).
   - If `not session.is_lti`: `Set-Cookie: <name>=<sid>.<sig>; Expires=<expiration RFC1123>; [Domain]; Path=<cookie_path or />; [Secure]; [HttpOnly]; SameSite=<samesite, default Lax>`.
   - LTI sessions never get a cookie; `url_defaults` (`app.py:189-193`) adds `session_id=<sid>` (or `lti_session_id` on `ltibindpage`/`lti1.3bindpage`) to every `url_for` URL.
3. **Cookie format** (verified): `inginious_session_id=6acf1394d379057911ec074a.FZixqDtKGiixW2jnnp31BPs7LCM; Expires=Thu, 15 Oct 2026 05:31:00 GMT; HttpOnly; Path=/`
   - value = `<24-hex ObjectId>` + `.` + `base64url_nopad(HMAC-SHA1(key, sid))` where `key = HMAC-SHA1(secret_key, "flask-session")` (itsdangerous "hmac" key derivation).
     Node equivalent (verified to reproduce the live cookie):
     `key = createHmac('sha1', secret).update('flask-session').digest(); sig = createHmac('sha1', key).update(sid).digest('base64url')`.
   - With `cookie_name: core_test_cookie, secure: true, httponly: false, samesite: Strict, timeout: 600` (scratch container):
     `Set-Cookie: core_test_cookie=<sid>.<sig>; Expires=<now+600s>; Secure; Path=/` (no HttpOnly; the app adds `SameSite=Strict`).
4. **Document** (collection `sessions`, mongoengine `Session`, `models/session.py:38-63`):
   ```
   { _id: ObjectId, permanent: bool (true), is_lti: bool (false), loggedin: bool (false),
     auth_storage: {<auth_id>: {...}} (default {}; OAuth state, redir_url),
     expiration: Date,
     lti: {version, email, username, realname, roles[], task[courseid, taskid], redir_url, context_title, context_label,
           tool_description, tool_name, tool_url, consumer_key, outcome_service_url, outcome_result_id,
           message_launch_id, platform_instance_id, course_secret} | absent,
     code_indentation: "2"|"3"|"4"|"tabs" (default "4"), email: str?, language: str (default "" -> auto-detected),
     realname: str?, token: str|null (default null), tos_signed: bool?, username: str|null, timezone: str (default tzlocal of the server, "Etc/UTC" in the container) }
   ```
   Index: `{expiration: 1}` with `expireAfterSeconds: 0` (MongoDB TTL deletes expired docs; verified via `getIndexes()`).
   Anonymous example (verified): `{permanent: true, is_lti: false, loggedin: false, auth_storage: {}, expiration, code_indentation: '4', language: '', timezone: 'Etc/UTC'}`
   (`language` stays `''` on a 404 because the language pre-check only runs inside pages). Logged-in example adds `email`, `realname`, `tos_signed`, `username`, `language: 'en'`.
5. **Login** (`user_manager.connect_user`, `user_manager.py:186-198`) sets `loggedin=True, email, username, realname, language, timezone, code_indentation, tos_signed (= users.tos_accepted), token=None`; the session id is rotated.
   **Logout** (`disconnect_user`, `user_manager.py:202-210`) sets `loggedin=False`, clears username/email/realname and invalidates the id.
6. Empty anonymous sessions (crawlers, health checks, 404s) need not be persisted on every request.

## Alternative / error flows
- Tampered/invalid signature -> silently a new session (no error).
- Expired session -> deleted, new session; the user appears logged out.
- Session id rotation: the id is rotated at login; the session is deleted at logout.

## UI elements
- None (transport only).

## Data
- Collection `sessions` as above (read + upsert on every request, delete when expired).
- Config: `session_parameters.{secret_key, timeout, cookie_name, cookie_domain, cookie_path, httponly, secure, samesite}` (`docs/reference/config.md` §4).

## Permissions & security
- **CSRF protection**: state-changing requests are POST and protected by an origin check: a mutating (`POST`/`PUT`/`PATCH`/`DELETE`) request with a form content type (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, or none) whose `Origin` header is missing or foreign is refused with 403, except on endpoints authenticated by other means (LTI 1.1/1.3 launches and OIDC login, external sign-in callbacks, the simple_grader endpoint, WebDAV). Logout, language change, account activation and the start of external sign-in flows are POSTs.
- **Session ids**: the cookie value and the LTI `?session_id=` are `<id>.<HMAC-SHA256(secret, id)>` and are verified in constant time; a `?session_id=` is only honoured on the LTI paths and only for sessions with `is_lti: true`.
- The session id is rotated at login; logout deletes the session document. Sessions are not bound to IP/user agent.
- `HttpOnly` (config `httponly`, default true); `Secure` from config (default false, `secure: false` in the reference infra); `SameSite` from config (default `Lax`).

## Acceptance tests
- Once a session holds data, the response carries `Set-Cookie: inginious_session_id=<24hex>.<43-char base64url>; Expires=<now+86400s>; HttpOnly; Path=/; SameSite=Lax` and a `sessions` doc with `_id` = that hex, `loggedin:false`, `permanent:true`, `is_lti:false`, `expiration` ≈ now+86400 s.
- A cookie without a valid HMAC-SHA256 signature (including a legacy itsdangerous cookie) yields a fresh anonymous session.
- A cookie with a modified signature yields a fresh anonymous session (no error, new id).
- Requests refresh `expiration` and the cookie `Expires` (sliding window, at most once a minute); a doc with `expiration` in the past is deleted and ignored.
- `session_parameters` options change cookie name/domain/path/Secure/HttpOnly/SameSite accordingly (`SameSite=Lax` by default).
- Login rotates the session id and sets `loggedin:true` + user fields; logout deletes the session document and clears the cookie.
- LTI launch creates a new `is_lti:true` session, sets no cookie, and all links contain `session_id=<id>`.
- Test: `?session_id=<id of a non-LTI logged-in session>` does not authenticate.
- Test: a cross-origin form POST (or one without `Origin`) to a state-changing endpoint (e.g. profile update) is rejected with 403.
- TTL index `{expiration:1}, expireAfterSeconds:0` exists on `sessions`.
