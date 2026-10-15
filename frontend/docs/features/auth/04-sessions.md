# Sessions (MongoDB-backed, signed cookie, LTI session id)

- **ID**: AUTH-04
- **Actors**: every client (anonymous, logged-in, LTI)
- **Routes**: all routes (cross-cutting); LTI launch routes create sessions specially
- **Depends on**: — (used by every other feature)
- **Legacy code**: `legacy/inginious/frontend/flask/mongo_sessions.py:L20-L82`, `legacy/inginious/frontend/models/session.py:L12-L63`, `legacy/inginious/frontend/app.py:L39-L87,L143-L144,L189-L193`, `legacy/inginious/frontend/user_manager.py:L171-L212` (connect/disconnect)

## Use case
Every visitor (even anonymous) gets a server-side session stored in MongoDB that carries the
login state, UI preferences (language, timezone, indentation), OAuth state and LTI launch data.
Browsers identify it with a signed cookie; LTI iframes (where third-party cookies are blocked)
identify it with a `session_id` query parameter.

## Preconditions
- `session_parameters.secret_key` must be configured, otherwise the app prints a generated key and exits(1) (`app.py:L44-L55`).

## Main flow
1. **open_session** (each request):
   1. Read `session_id` from the query string (LTI mode).
   2. If the matched endpoint is an LTI launch page (`LTI11LaunchPage.endpoint`, `LTI13LaunchPage.endpoint`), return a brand-new `Session(permanent=True, is_lti=True)` (no lookup).
   3. `sid = request.args['session_id'] or cookie[<cookie_name>]`. None → new `Session(permanent=True)`.
   4. If the sid came from the cookie, unsign it with `itsdangerous.Signer(secret_key, salt='flask-session', key_derivation='hmac')` (default digest SHA1). Bad signature → new empty session. A sid taken from the `session_id` query parameter is only accepted when it designates an LTI session (`is_lti=true`).
   5. Load `sessions` document `_id = ObjectId(sid)`; if `expiration <= now(UTC)` delete it and start a new session; if missing start a new session.
2. **save_session** (each response, unconditionally): `expiration = now(UTC) + PERMANENT_SESSION_LIFETIME` (sliding expiration), `session.save()` (upsert of the whole document). For non-LTI sessions set the cookie: name `cookie_name` (default `inginious_session_id`), value `<sid>.<signature>` (e.g. `6acf1325d379057911ec0717.jJnPw9IH-DO8125HEvfTSgjTRhY`), `Expires=<expiration>`, `HttpOnly` (config `httponly`, default true), `Domain`=`cookie_domain`, `Path`=`cookie_path` (default `/`), `Secure`=`secure` (default false). LTI sessions never set a cookie.
3. **URL propagation for LTI**: a `url_defaults` hook adds `session_id=<session.id>` to every `url_for()` when `session.is_lti` (or `lti_session_id=` for endpoints `ltibindpage` and `lti1.3bindpage`).
4. **connect_user** (login, any method) sets on the session: `loggedin=True`, `email`, `username`, `realname`, `language`, `timezone`, `code_indentation`, `tos_signed=user.tos_accepted`, `token=None`; it also runs `users.update({email}, {$set: {realname, username, language}})`. The session id is rotated at login.
5. **disconnect_user** (logout): sets `loggedin=False`, clears the identity fields; the session id is invalidated.

## Alternative / error flows
- Expired session in DB → deleted and replaced (also removed by the TTL index on `expiration`, `expireAfterSeconds: 0`).
- Tampered signature → a fresh anonymous session (new cookie), no error.
- Unsigned cookie value (`inginious_session_id=<sid>` without dot) → treated as bad signature → new session.

## UI elements
None (infrastructure).

## Data
- Collection `sessions` (mongoengine `Session`):
  - `_id`: ObjectId (generated at object creation; doubles as session id)
  - `permanent`: bool (always `true`)
  - `is_lti`: bool (default `false`)
  - `loggedin`: bool (default `false`)
  - `auth_storage`: object `{<auth_id>: {redir_url: str, oauth_state: str, ...}}` (default `{}`)
  - `expiration`: Date (UTC) — TTL index `expiration_1` with `expireAfterSeconds: 0`
  - `lti`: embedded `LTIData` or absent: `version, email, username, realname, roles[], task[courseid, taskid], redir_url, context_title, context_label, tool_description, tool_name, tool_url, consumer_key, outcome_service_url, outcome_result_id, message_launch_id, platform_instance_id, course_secret`
  - `code_indentation`: `"2"|"3"|"4"|"tabs"` (default `"4"`)
  - `email`, `realname`: str (absent until login)
  - `language`: str (default `""`, filled by AUTH-10 on first request)
  - `token`: str|null (danger-zone confirmation token, set by course admin pages)
  - `tos_signed`: bool
  - `username`: str|null
  - `timezone`: str (default = server local zone name, `Etc/UTC` in Docker)
- Example (logged-in): `{_id, permanent:true, is_lti:false, loggedin:true, auth_storage:{}, expiration:ISODate(...), code_indentation:'4', language:'en', timezone:'Etc/UTC', email:'auth_alice@x.org', realname:'Alice', tos_signed:false, username:'auth_alice'}`.
- Config `session_parameters`: `secret_key` (required), `timeout` (seconds, default 86400), `cookie_name`, `cookie_domain`, `cookie_path`, `samesite` (default `Lax`, applied to the cookie), `httponly` (default true), `secure` (default false).

## Permissions & security
- A `session_id` in the query string is accepted only on the LTI paths and only for sessions with `is_lti=true`; a non-LTI session id in the URL never authenticates.
- Session ids (cookie or `session_id` parameter) are only accepted with a valid HMAC-SHA256 signature computed with the server secret (`<id>.<signature>`, checked in constant time); an unsigned or forged value gives a fresh anonymous session.
- LTI session ids travel in URLs (needed inside LMS iframes where cookies are blocked); they are scoped to LTI sessions only.
- The session id is rotated at login (every sign-in method).
- Logout deletes the session document and clears the cookie.
- A password change (profile or reset) closes the user's other sessions.
- Cookie attributes: `HttpOnly` (config `httponly`, default true), `SameSite` from config (default `Lax`), `Secure` from config (default false).
- Empty anonymous sessions need not be persisted on every request.
- The cookie signature format (itsdangerous SHA1-HMAC in legacy) may change, but the `sessions` collection format stays readable if sessions are to survive a cut-over (not required).

## Acceptance tests
- Once an anonymous session holds data → `Set-Cookie: inginious_session_id=<24hex>.<sig>; Expires=<now+timeout>; HttpOnly; Path=/; SameSite=Lax` and a `sessions` document with `loggedin:false`, `language` set.
- Requests move `expiration` forward to now+timeout (sliding; refreshed at most once a minute).
- Request with expired session (set `expiration` in the past) → a new session id is issued, old document deleted.
- Tampered cookie signature → new anonymous session, no error.
- Login → the session gets `loggedin:true, username, email, realname, language, timezone, code_indentation, tos_signed`; session id rotated.
- Logout → session document deleted, cookie cleared.
- Test: `?session_id=<id of a non-LTI session>` does not authenticate; an LTI session id in the URL works only for LTI sessions.
- Config `cookie_name: foo` → cookie named `foo`; `secure: true` → `Secure` flag; `samesite` applied.
- TTL index exists on `sessions.expiration` with `expireAfterSeconds: 0`.
