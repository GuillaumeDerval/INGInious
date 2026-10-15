# Password sign-in and the authentication gate

- **ID**: AUTH-05
- **Actors**: anonymous (becoming student/tutor/admin/superadmin)
- **Routes**: GET/POST `/signin`; additionally **POST to any `INGIniousAuthPage` URL** with `login`+`password` fields (the login form posts to the current URL)
- **Depends on**: AUTH-04 (sessions), AUTH-09 (ToS gate), AUTH-11 (profile, username completion)
- **Legacy code**: `legacy/inginious/frontend/pages/utils.py:L80-L193` (`INGIniousAuthPage`, `INGIniousAdministratorPage`, `SignInPage`), `legacy/inginious/frontend/user_manager.py:L124-L201` (`auth_user`, `verify_hash*`, `connect_user`), `L815-L843` (hashing), template `templates/auth.html`, `templates/signin_button.html`

## Use case
A user with a local INGInious account (username + password) signs in to access their courses.
Any protected page shows the sign-in form in place when the visitor is anonymous, so following
a deep link and signing in lands directly on the requested page.

## Preconditions
- User document with `username`, a `password` hash, and **no `activate` field** (account activated).

## Main flow
1. Anonymous `GET /signin` (or any protected page) → 200 `auth.html` (title "Welcome | INGInious"): password form (only if `allow_registration` is true!) and "Sign in with" buttons for each registered external auth method (AUTH-14).
2. User submits `POST <same URL>` with `login`, `password`.
3. `auth_user(login.strip(), password)`:
   1. `users.findOne({username: login, activate: {$exists: false}})`; no user or empty/absent `password` → failure.
   2. Hash format: if the stored `password` contains `-`, split on the first `-` → `(method, hash)`; otherwise `("sha512", whole value)`.
   3. `method == "sha512"`: compare `hashlib.sha512(password.encode('utf-8')).hexdigest()` with the stored hex (constant-time comparison). `method == "argon2id"`: `argon2.PasswordHasher().verify(hash, password)` (parameters are read from the encoded hash). Any other method → `AuthInvalidMethodException` (uncaught → HTTP 500 on `/signin`; API returns 403).
   4. On success `connect_user(user)` (see AUTH-04): session fields set, user doc `$set {realname, username, language}` by email.
4. On success the page's `GET_AUTH` is executed in the same POST response: for `/signin` → 302 to `/mycourses`; for another protected page → that page is rendered (200) — note it is `GET_AUTH`, not `POST_AUTH`.
5. Logged-in `GET /signin` or `POST /signin` → 302 `/mycourses`.

## Gate logic for protected pages (`INGIniousAuthPage`)
- GET, logged in:
  - if `not session.username` **or** (`IS_TOS_DEFINED` and `not session.tos_signed`) and page is not `ProfilePage` → 302 `/preferences/profile`.
  - if page is not LTI-enabled and `session.is_lti` → `disconnect_user()` and render `auth.html` (LTI sessions cannot browse the normal UI).
  - else `GET_AUTH`.
- GET, anonymous: if `preview_allowed()` → `GET_AUTH`; else render `auth.html`, with error:
  - `?binderror` → "An account using this email already exists and is not bound with this service. For security reasons, please log in via another method and bind your account in your profile."
  - `?callbackerror` → "Couldn't fetch the required information from the service. Please check the provided permissions (name, email) and contact your INGInious administrator if the error persists."
- POST, logged in: the empty-username and ToS checks (AUTH-09), then the LTI check, then `POST_AUTH`.
- POST, anonymous: if form has `login` and `password` → try login (success → `GET_AUTH`; failure → `auth.html` with "Invalid login/password", HTTP 200); else if `preview_allowed()` → `POST_AUTH`; else `auth.html`.
- `INGIniousAdministratorPage` (superadmin pages): logged-in non-superadmin GET → `forbidden.html` "Forbidden" (HTTP **200**); POST by non-superadmin (or anonymous) → `forbidden.html` "You have not sufficient right to see this part." (HTTP 200).

## Alternative / error flows
- Wrong password / unknown user / not activated → 200, `auth.html`, red alert "Invalid login/password" (same message for all cases).
- Stored hash with unknown prefix (e.g. `md5-…`) → 500 (verified).
- `allow_registration: false` → the password form is **not rendered** (only external methods), but POSTing `login`/`password` still works.
- Login on `/logout` → logs in then immediately logs out (GET_AUTH of LogOutPage) → 302 `/courselist`.

## UI elements
- `auth.html`: card with optional red dismissible alert (error); form `method=post` (no action → current URL): text `login` (placeholder "Username", tabindex 1), password `password` (tabindex 2), link "Lost password?" → `/register#lostpasswd` (tabindex 4), submit "Sign in" (tabindex 3, `btn-block`).
- If ≥1 auth method: `<hr/>` (only if registration allowed) + heading "Sign in with" + grid of method icons (`get_imlink()` HTML, `| safe`), max 4 per row, each linking to `/auth/signin/<id>`.
- `signin_button.html` (included on course list, course, task, marketplace pages for anonymous users): heading "Sign in", warning "Please register or sign in to see the complete list of courses and be able to submit answers to problems.", link "Sign in" → `/signin`.
- The dismiss button's sr-only text is literally `$:_("Close")` (legacy template bug).

## Data
- Reads `users` (`username`, `password`, `activate`, `realname`, `email`, `language`, `timezone`, `code_indentation`, `tos_accepted`).
- Writes `users.updateMany({email}, {$set:{realname, username, language}})` on each login (no-op values), and the session (AUTH-04).
- Password hash formats accepted (`users.password`):
  - `argon2id-$argon2id$v=19$m=…,t=…,p=…$<b64 salt>$<b64 hash>` — current format; new hashes made with argon2-cffi defaults (`m=65536,t=3,p=4`, 16-byte salt, 32-byte hash).
  - `sha512-<128 hex>` — SHA-512 of the UTF-8 password.
  - `<128 hex>` (no dash) — older SHA-512 format.
  - Writing always produces `argon2id-…` (`hash_password`). On successful login, SHA-512 hashes are transparently re-hashed to `argon2id-…`.
- Config: `allow_registration` (controls form display), `superadmins` (list of usernames).
- Log line: `User <username> connected - <realname> - <email> - <ip>`.

## Permissions & security
- State-changing POSTs, including the login form, are protected by an origin check (CORE-04).
- Password sign-in failures are rate-limited.
- The session id is rotated at login (AUTH-04).
- All three hash formats are accepted (DB compatibility); SHA-512 hashes are re-hashed to argon2id on successful login (keeping the `argon2id-` prefix format).
- Hash comparisons are constant-time.
- Superadmin pages answer non-superadmins with status 403.
- Usernames are matched exactly (case-sensitive); input is `.strip()`ed (password is not).

## Acceptance tests
- `POST /signin login=auth_alice password=wrong` → 200 with "Invalid login/password".
- `POST /signin login=" auth_alice " password=superadmin` → 302 `/mycourses`, session `loggedin:true`, `username:'auth_alice'`.
- Users whose `password` is (a) `argon2id-$argon2id$v=19$m=65536,t=3,p=1$…`, (b) `sha512-<hex(sha512("secret123"))>`, (c) `<hex(sha512("secret123"))>` all log in with the right password and fail with a wrong one.
- After (b)/(c) login, hash upgraded to `argon2id-…` and the same password still works.
- User with `activate: "<hash>"` cannot log in ("Invalid login/password").
- User without `password` field cannot log in by password.
- Anonymous `GET /mycourses` → 200 login form; `POST /mycourses` with valid credentials → my-courses page rendered directly.
- Logged-in `GET /signin` → 302 `/mycourses`.
- `GET /signin?binderror` and `?callbackerror` → the respective messages.
- `allow_registration:false` → `/signin` shows no username/password form; external buttons only.
- Logged-in user with empty `username` → any protected GET redirects to `/preferences/profile`.
- Non-superadmin `GET /administrator/users` → forbidden page.
