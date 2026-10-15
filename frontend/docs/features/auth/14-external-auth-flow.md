# External authentication: generic sign-in / callback flow and account binding

- **ID**: AUTH-14
- **Actors**: anonymous (sign-in / sign-up through a provider), logged-in user (binding)
- **Routes**: GET/POST `/auth/signin/<auth_id>`, GET/POST `/auth/callback/<auth_id>`
- **Depends on**: AUTH-04, AUTH-05, AUTH-11 (username completion), AUTH-12; plugins AUTH-15/16/17
- **Legacy code**: `legacy/inginious/frontend/pages/social.py:L12-L53`, `legacy/inginious/frontend/user_manager.py:L35-L72` (`AuthMethod` interface), `L104-L122` (registry), `L276-L325` (`bind_user`), `legacy/inginious/frontend/plugins/plugin_manager.py:L88-L95` (`register_auth_method`), `legacy/inginious/frontend/flask/mapping.py:L75-L78`

## Use case
Institutions plug in identity providers (OAuth, SAML, LDAP). A user clicks a provider button, is
redirected to the provider, comes back, and is signed in — the account is created automatically on
first use (with an empty username to be chosen on the profile page), or linked to the logged-in user.

## Preconditions
- At least one auth plugin configured under `plugins:` with a unique `id`.

## AuthMethod plugin interface (to re-implement as a provider abstraction)
- `get_id()` → method id (from plugin config `id`), used in URLs and as key in `users.bindings`.
- `get_name()` → display name (config `name`, defaults per plugin).
- `get_imlink()` → raw HTML for the button/icon (rendered `| safe`).
- `get_auth_link(auth_storage)` → URL to redirect the user to; may store state in `auth_storage` (per-method dict in the session).
- `callback(auth_storage)` → `(provider_user_id: str, realname: str, email: str, additional: dict)` or `None` on failure.
- Registered in an ordered dict (config order = button order).

## Main flow
1. **Start**: `/auth/signin/<auth_id>` (the flow is only started by a POST; a GET does not start it):
   - LTI session → 302 to itself (with `session_id` appended by `url_defaults`) — infinite redirect loop (legacy bug).
   - Unknown `auth_id` → intended 404 "Auth method doesn't exist", actual **500** (`current_app.notfound` does not exist).
   - `auth_storage = session.auth_storage[auth_id]` (created if missing); `auth_storage.redir_url` = the same-origin page to come back to (anything else → `/`); 302 to `get_auth_link(auth_storage)`.
2. **Callback**: `GET|POST /auth/callback/<auth_id>` (LTI → redirect to signin; unknown id → 500):
   - `user = callback(auth_storage)`; `None` → 302 `/signin?callbackerror=`.
   - `bind_user(auth_id, user)`; `False` → 302 `/signin?binderror=`.
   - 302 → `auth_storage.redir_url` (default `/`).
3. **`bind_user(auth_id, (pid, realname, email, additional))`**:
   1. `email = sanitize_email(email)`; invalid → `False` (→ binderror message, misleading).
   2. `profile = users.findOne({"bindings.<auth_id>": pid})` — NB: matches when the array `bindings.<auth_id>` *contains* `pid` (MongoDB array semantics; first element is the id).
   3. Cases:
      - profile found, not logged in → `connect_user(profile)` (sign-in). The provider's realname/email are **not** refreshed.
      - profile found, logged in with the same e-mail → `bindings.<auth_id> = [pid, additional]` saved (refresh).
      - profile found, logged in as someone else → nothing (log "Tried to bind an already bound account !"), returns True.
      - no profile, logged in → `users.update({email: session.email}, {$set: {"bindings.<auth_id>": [pid, additional]}})` (new binding).
      - no profile, not logged in, e-mail already used by an account → `False` (binderror: "An account using this email already exists and is not bound with this service. For security reasons, please log in via another method and bind your account in your profile.").
      - no profile, not logged in, e-mail unused → **create** `users` doc `{username: "", realname, email, bindings: {<auth_id>: [pid, additional]}, language: session.language, code_indentation:"4", ltibindings:{}, tos_accepted:false, timezone:<server tz>, pinned_courses:[]}` and `connect_user` → the gate then forces `/preferences/profile` to choose a username (AUTH-11) and accept ToS.
4. Callback errors visible on `/signin`: see AUTH-05 messages.

## Alternative / error flows
- Callback reached without a prior `/auth/signin` (no `oauth_state` in storage) → OAuth plugins raise `KeyError` outside their try → 500 (verified for GitHub).
- Provider returns an e-mail failing the regex → binderror (confusing message).
- New accounts have `username: ""`: several users can be in that state simultaneously; course registration refuses empty usernames.

## UI elements
- Buttons on `auth.html` (AUTH-05), refresh/add actions on bindings page (AUTH-12). No page of its own.

## Data
- `sessions.auth_storage.<auth_id>`: `{redir_url: str, oauth_state?: str, ...}` (e.g. `{github: {redir_url: '/course/x', oauth_state: 'YQT6…'}}`).
- `users.bindings.<auth_id>`: `[pid, additional]`.
- New user documents as above.

## Permissions & security
- `redir_url` only accepts same-origin relative paths; anything else redirects to `/`.
- The flow is started by a POST protected by the origin check (CORE-04); the callback is only accepted with the provider state stored in the same session (OAuth `state`).
- An existing account is never linked automatically by e-mail (binderror instead).
- Unknown auth id → 404.
- The callback accepts POST (needed for SAML) from the provider's origin; it is validated by the provider protocol (state, signed response).

## Acceptance tests
- With GitHub configured (`client_id: dummyid`): `POST /auth/signin/github` with return page `/course/x` → 302 to `https://github.com/login/oauth/authorize?response_type=code&client_id=dummyid&redirect_uri=<root>/auth/callback/github&scope=user%3Aemail&state=<30 chars>`; session `auth_storage.github = {redir_url:'/course/x', oauth_state:<state>}`.
- An external return target is ignored (redirect to `/`); `GET /auth/signin/github` does not start a flow.
- `GET /auth/signin/nope` → 404 (rewrite; legacy 500).
- `GET /auth/callback/github?code=x&state=y` with bad state → 302 `/signin?callbackerror=`.
- Unit tests of `bind_user` with a fake AuthMethod covering the 6 cases above (DB state after each).
- New external user → `users` doc with `username:""`, `bindings.<id>=[pid,{}]`; next protected GET → 302 `/preferences/profile`.
- Existing local account with same e-mail, anonymous provider login → 302 `/signin?binderror=` with the message.
