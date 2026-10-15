# REST API v0: authentication (auth methods, login, session status)

- **ID**: SITE-07
- **Actors**: API client, anonymous
- **Routes**: GET /api/v0/auth_methods, GET /api/v0/authentication, POST /api/v0/authentication
- **Depends on**: SITE-06, AUTH (password login, `UserManager.auth_user`)
- **Legacy code**: `pages/api/auth_methods.py:L11-49`, `pages/api/authentication.py:L14-50`,
  `user_manager.py:L124-201` (`auth_user`, `connect_user`)

## Use case
A script logs in with an INGInious local account (username + password) to obtain a session cookie,
then checks whether the session is still valid.

## Main flow
App behaviour: as below, with these differences — the POST body may also be a JSON object;
credentials go through the same check as the web sign-in (`authenticate`: account without
`activate` field and with a password, argon2id or legacy SHA-512 hash, legacy hashes
upgraded to argon2id on success, rate limiting); the session id is rotated at login.

1. `GET /api/v0/auth_methods` (no auth required) → 200, constant (retro-compatibility, ignores configured auth plugins):
   ```json
   [{"id": 0, "name": "INGInious account", "input": [{"id": "login", "name": "Login", "type": "text"}, {"id": "password", "name": "Password", "type": "password"}]}]
   ```
2. `POST /api/v0/authentication` with form fields `login`, `password`
   (`application/x-www-form-urlencoded` or multipart; legacy did not read JSON bodies):
   - `auth_user(login.strip(), password)`: finds `users` doc with `username == login` and **no
     `activate` field**, password non-empty; password stored as `"<method>-<hash>"` (`argon2id` or
     `sha512`; no prefix = legacy sha512 hex); verifies; on success `connect_user` fills the session
     (`loggedin, email, username, realname, language, timezone, code_indentation, tos_signed, token=None`)
     and logs `User <u> connected - <realname> - <email> - <ip>`.
   - success → 200 `{"status": "success", "username": "<username>"}`.
3. `GET /api/v0/authentication` → always 200:
   `{"authenticated": true, "username": "<u>"}` or `{"authenticated": false}`.

## Alternative / error flows
- Missing `login` or `password` field → 400 `{"error": "Invalid arguments for this method"}`.
- Wrong password, unknown user, pending (not activated) user, user without password, or too
  many failed attempts → 403 `{"status": "error"}`.
- Login by e-mail is not supported (username only).
- Already logged-in session posting other credentials → silently switches the session to the new user.
- No logout endpoint in the API (use web `GET /logout`).
- ToS acceptance is not checked by the API login.

## UI elements
None (JSON API).

## Data
Reads `users` (`username`, `activate`, `password`, `email`, `realname`, `language`, `timezone`,
`code_indentation`, `tos_accepted`). `connect_user` also runs
`User.objects(email=user.email).update(realname, username, language)` (rewrites the same values).
Writes the session document in `sessions`.

## Permissions & security
- The session id is rotated at login: the cookie id obtained anonymously changes after a successful
  `POST /api/v0/authentication`.
- Sign-in failures are rate-limited per account (20 failures per 15 minutes) and per client
  address (100 failures per 15 minutes), shared with the web sign-in; a throttled attempt is
  refused without checking the password.
- Unknown users and wrong passwords are answered identically (`403 {"status": "error"}`), and
  both cost a password-hash computation.

## Acceptance tests
- `GET /auth_methods` returns exactly the constant list above (200, no auth).
- `GET /authentication` anonymous → `{"authenticated": false}`; after login → `{"authenticated": true, "username": ...}`.
- POST valid credentials → 200 success + cookie usable on other API routes and on web pages.
- POST wrong password / pending account → 403 `{"status": "error"}`; missing field → 400.
- Users with `sha512-` and legacy unprefixed sha512 hashes can log in.
- Test: the session id changes after a successful login.
