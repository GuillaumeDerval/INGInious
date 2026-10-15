# Self-registration and e-mail activation

- **ID**: AUTH-07
- **Actors**: anonymous
- **Routes**: GET `/register`, POST `/register` (field `register`), GET `/register?activate=<hash>`
- **Depends on**: AUTH-04, AUTH-02/AUTH-09 (ToS checkbox), SMTP configuration
- **Legacy code**: `legacy/inginious/frontend/pages/register.py:L24-L45,L61-L118,L187-L207`, `legacy/inginious/frontend/user_manager.py:L84-L98` (`sanitize_email`), `L268-L274` (`activate_user`), `L815-L843` (hashing), `legacy/inginious/frontend/app.py:L89-L100` (SMTP), template `templates/register.html`

## Use case
A visitor creates a local account (username/password). An activation e-mail is sent; the account
can sign in only after clicking the link.

## Preconditions
- `allow_registration: true` (default true).
- Visitor not logged in.
- SMTP configured (`smtp` key) — otherwise sending fails and the account is rolled back.

## Main flow
1. `GET /register` → `register.html`: left "Register in INGInious" form, right "Lost password ?" form (AUTH-08).
2. User fills `username`, `realname`, `email`, `passwd`, `passwd2`, (`term_policy_check` if ToS defined), clicks "Sign up" (`name="register"`).
3. Validation, in this order (first failing rule wins, message in a red alert):
   1. `username` matches `^[-_|~0-9A-Z]{4,}$` (case-insensitive; ASCII letters, digits, `-`, `_`, `|`, `~`; ≥4 chars; no max) else "Invalid username format."
   2. `sanitize_email(email)` not None else "Invalid email format." — regex (case-insensitive): local part dot-atom `[-!#$%&'*+/=?^_\`{}|~0-9A-Z]+(\.[-!#$%&'*+/=?^_\`{}|~0-9A-Z]+)*` or quoted-string, `@`, domain `(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?$`. Sanitized value = local part unchanged + `@` + domain lower-cased (e.g. `Auth_R@X.Org` → `Auth_R@x.org`).
   3. `len(passwd) >= 6` else "Password too short."
   4. `passwd == passwd2` else "Passwords don't match !"
   5. If `IS_TOS_DEFINED`: `term_policy_check` present else "Please accept the Terms of Service and Data Privacy".
   6. `users.findOne({username})` (exact, case-sensitive) found → "This username is already taken !". If the sanitized e-mail is already used by an account, no account is created: the normal success message (step 6) is shown and the owner of the address receives a mail pointing to the lost-password form.
4. Insert user: `{username, realname, email: sanitized, password: "argon2id-…", activate: <activation token from a CSPRNG, with expiry>, language: session.language, tos_accepted: true, code_indentation: "4", bindings: {}, ltibindings: {}, timezone: <server tz>, pinned_courses: []}` (mongoengine defaults are written). `realname` is required ("Name is too short." when blank).
5. Send e-mail: To `(realname, email)`, From `smtp.sendername` (default `no-reply@ingnious.org`), Subject "Welcome on INGInious" (translated), plain-text body:
   ```
   Welcome on INGInious !

   To activate your account, please click on the following link :
   <base_url>/register?activate=<activate token>
   ```
6. Success message (green): "You are succesfully registered. An email has been sent to you for activation." Form is shown again (empty).
7. User clicks the link → `GET /register?activate=<token>` shows an activation button (opening the link has no side effect); the button POSTs the token: if the token is well-formed and not expired, `users.findOneAndUpdate({activate: token}, {$unset: {activate: 1}})` → green "User successfully activated."; otherwise red "Invalid activation hash." (also for a second click).
8. User signs in (AUTH-05).

## Alternative / error flows
- Logged in, or `allow_registration` false → 403 `forbidden.html` "You're not allow to register." (GET and POST).
- SMTP failure → the just-created user is deleted (`users.deleteMany({username})`), red "Something went wrong while sending you activation email. Please contact the administrator.", error logged `Couldn't send email : <ex>`.
- Missing form fields (e.g. only `register` and `username`) → 400 (Werkzeug `BadRequestKeyError`).
- POST without `register`/`lostpasswd`/`resetpasswd` → 200 empty form.
- `GET /register?activate=…` also works while `reset` param absent; activation is not possible while logged in (403).
- Login before activation → "Invalid login/password".
- Note: AUTH-08 password reset also removes `activate` (reset activates the account).

## UI elements
- Alert box: red if `error`, green if `msg` and not error, dismissible.
- Registration form (`method=post`, no action): labels "Username (min. 4 alphanumerical characters) :", "Complete name :", "Email address :", "Password (min. 6 characters) :", "Confirm password :"; inputs `username` (text), `realname` (text), `email` (text, not `type=email`), `passwd`, `passwd2` (password); ToS checkbox `term_policy_check` with links (AUTH-02) when `IS_TOS_DEFINED`; submit button `name="register"` "Sign up" (`fa-sign-in`).
- No client-side validation; values are not preserved after an error.
- Sidebar "Register" link (anonymous, only if `allow_registration`) (AUTH-18).

## Data
- `users` document created (see step 4); `activate`: token string (legacy documents: 128 hex; issued by the app: `<64 hex>.<expiry in ms>`, valid 7 days); removed on activation.
- Indexes on `users.username` and `users.email` are **non-unique**.
- Config: `allow_registration`, `smtp.{host, port, starttls, usessl, username, password, sendername}`, `terms_page`, `privacy_page`.
- E-mail via Flask-Mail.

## Permissions & security
- Activation (and reset, AUTH-08) links are built from the configured public base URL (`base_url`, else the deployment origin `ORIGIN`/`APP_ORIGIN`), never from the request `Host` header (the request origin is only used for `localhost` development).
- Activation tokens come from a CSPRNG and expire.
- The answer does not reveal whether an e-mail address is already registered (same success message; the owner of the address is notified by mail).
- Uniqueness is checked before insert (the `users` indexes are non-unique for DB compatibility).
- E-mail uniqueness is exact-match: `a@X.org` vs `A@x.org` are different accounts (domain lower-cased only).
- Registration POSTs are protected by the origin check (CORE-04); registration and lost-password mails share a per-client limit (10 per 15 minutes).
- The legacy shared instance (port 8080) was started before SMTP was configured and fails with `Connection refused` (Flask-Mail defaults to localhost:25) — environment note, not a feature.

## Acceptance tests
- Each validation rule with its exact message (usernames `abc`, `auth_r!` → "Invalid username format."; email `bad` → "Invalid email format."; `12345` → "Password too short."; mismatch → "Passwords don't match !"; existing username → "This username is already taken !"; ToS unchecked when defined → "Please accept the Terms of Service and Data Privacy").
- Valid registration with email `Auth_R@X.Org` → user stored with `email:'Auth_R@x.org'`, `password` starting with `argon2id-$argon2id$`, `activate` token, `tos_accepted:true`, `language` = current session language; Mailpit receives "Welcome on INGInious" with link `…/register?activate=<token>`.
- Existing e-mail (domain in other case: `auth_alice@X.ORG`) → the normal success message, no new user document, and the owner of the address receives a mail pointing to the lost-password form.
- Registration with `?lang=fr` → French messages ("Ce nom d'utilisateur est déjà utilisé !") and `language:'fr'` stored.
- Login before activation fails; `GET /register?activate=<token>` then the activation button (POST) → "User successfully activated.", `activate` unset; second click → "Invalid activation hash."; login then succeeds. An expired token → "Invalid activation hash.".
- SMTP down → error message and no user document remains.
- Logged-in `GET /register` → 403; `allow_registration:false` → 403 and no "Register" sidebar link.
