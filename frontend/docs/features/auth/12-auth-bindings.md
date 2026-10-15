# Authentication bindings (link/unlink external sign-in methods)

- **ID**: AUTH-12
- **Actors**: any logged-in user
- **Routes**: GET/POST `/preferences/bindings`; redirects to `/auth/signin/<auth_id>`
- **Depends on**: AUTH-14 (external auth flow), AUTH-11 (menu)
- **Legacy code**: `legacy/inginious/frontend/pages/preferences/bindings.py:L12-L47`, `legacy/inginious/frontend/user_manager.py:L276-L345` (`bind_user`, `revoke_binding`), template `templates/preferences/bindings.html`

## Use case
A user links additional sign-in providers (GitHub, Google, SAML, LDAP…) to their account so they
can sign in with any of them, refreshes the attributes stored for a provider, or removes a link.

## Preconditions
- Logged in; at least one auth plugin configured for the add/refresh actions.

## Main flow
1. `GET /preferences/bindings`: `user = users.findOne({username: session.username})`; for each registered auth method **that the user is bound to** (`id in user.bindings`), a card:
   - header: method name + refresh icon (link `/auth/signin/<id>`, tooltip "Refresh fields") + red trash icon (tooltip "Revoke access") that sets the hidden input of form `#revoke` and submits it (JS `onclick`).
   - body: method icon (`get_imlink()`), "Identifier: <bindings[id][0]>", and if `bindings[id][1]` non-empty: "Additional fields:" list `<id>.<key> : <value>`.
2. Section "Add a new binding": select `auth_binding` with empty option "Select a authentication binding" and one option per registered method **not yet bound**; button "Add new binding".
3. **Add**: POST `auth_binding=<id>`:
   - `id` not a registered method (incl. empty) → red "Incorrect authentication binding.".
   - not yet bound → 302 `/auth/signin/<id>` → provider → `/auth/callback/<id>` → `bind_user` (logged-in branch: `users.update({email: session.email}, {$set: {"bindings.<id>": [provider_user_id, additional]}})`) → redirect to `redir_url` (= the Referer, i.e. `/preferences/bindings`).
   - already bound → page re-rendered, nothing happens.
4. **Refresh**: link `/auth/signin/<id>` → same flow; `bind_user` finds the profile bound to that provider id with the same e-mail as the session and rewrites `bindings.<id>` (refreshes additional fields).
5. **Revoke**: POST `revoke_auth_binding=<id>` → `revoke_binding(username, id)`:
   - `id` not a registered method → error "Incorrect authentication binding." (so bindings of methods no longer configured can never be removed).
   - user has more than one binding **or** has a password → `users.update({username}, {$unset: {"bindings.<id>": 1}})`, no message.
   - else → "You must set a password before removing all bindings."

## Alternative / error flows
- After a successful revoke, the page is rendered with the bindings loaded **before** the revoke (stale card still shown, verified); a reload shows the correct state. Rewrite: show the updated list (+ a success message).
- Binding a provider account already bound to another INGInious user → silently ignored (logged "Tried to bind an already bound account !"), redirect to `redir_url`, no message.
- Provider error → `/signin?callbackerror` (shows sign-in page error while logged in → actually redirects to `/mycourses` since logged in; message lost).

## UI elements
- Title/breadcrumb "Authentication bindings" (`fa-id-card-o`), preferences menu (AUTH-11).
- Hidden form `#revoke` with input `revoke_auth_binding` (template uses invalid attribute `val=""`).
- Alerts red (error) / green (msg).

## Data
- `users.bindings`: object `{<auth_id>: [<provider user id: str>, <additional: object>]}` (a 2-element array; `additional` e.g. SAML extra attributes, `{}` for OAuth). Example `{"github": ["999", {}]}`.
- `users.password` presence decides whether the last binding can be removed.

## Permissions & security
- Add/revoke POSTs are protected by the origin check (CORE-04); an external flow (and thus a binding) can only be started by a POST (AUTH-14), and the callback is only accepted with the provider state stored in the same session.
- Revoke acts on `session.username` only.

## Acceptance tests
- User with `bindings.github=['999',{}]` and github configured: page shows card "Github", "Identifier: 999"; select does not list github.
- POST `auth_binding=github` when not bound → 302 `/auth/signin/github`.
- POST `auth_binding=nope` → "Incorrect authentication binding.".
- POST `revoke_auth_binding=github` for a user with a password → binding removed from DB; (rewrite) page no longer shows it.
- User without password and a single binding → "You must set a password before removing all bindings.", binding kept.
- POST `revoke_auth_binding=fakeauth` (method not configured) → "Incorrect authentication binding.".
- No auth plugin configured → no card, select has only the placeholder.
