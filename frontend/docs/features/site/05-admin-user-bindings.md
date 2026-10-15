# Site administration: view and revoke a user's external auth bindings

- **ID**: SITE-05
- **Actors**: superadmin
- **Routes**: GET /administrator/users (bindings listed with each row), POST /administrator/users?/revoke (app); legacy: POST /administrator/user_action (`action=get_bindings`, `action=revoke_binding`)
- **Depends on**: SITE-01, AUTH (external auth methods / bindings)
- **Legacy code**: `pages/admin/admin.py:L51-56`, `user_manager.py:L327-345` (`revoke_binding`),
  `static/js/admin.js:L5-49` (`revoke_binding`, `get_bindings`, `display_bindings`),
  `templates/admin/admin_users.html` (`#binding_modal`, `#hidden-template`)

## Use case
The superadmin checks which external identity providers (GitHub, Google, SAML, LDAP...) are linked
to an account, and can unlink one (e.g. compromised external account).

## Preconditions
Logged in as superadmin.

## Main flow
App behaviour (action `revoke`, `lib/server/auth/external.ts` `revokeBinding`, shared with
the user's own preferences page): the bindings (method id → identifier) are part of each
row of the user list. Revoking posts `username` and `binding_id`: unknown user or no such
binding on the user → "Incorrect authentication binding."; last binding of a user without
password → "You must set a password before removing all bindings."; otherwise
`$unset bindings.<binding_id>` and "Binding revoked.". Errors are failed actions (400).

Legacy flow (reference):
1. Click the cloud "Bindings" button of a row → modal "Available bindings".
2. On `show.bs.modal`, JS does a **synchronous** AJAX POST `user_action` `{username, action: "get_bindings"}`.
3. Server returns `jsonify(user.bindings)` or `{}` if the user doesn't exist. Example (verified):
   `{"github": ["12345", {}], "google": ["g@x.org", {}]}` — keys = auth method ids, value =
   `[external_identifier, additional_data]`.
4. For each binding, a card is cloned from `#hidden-template`: header = binding id (method),
   body "Identifier :" + `bindings[id][0]`, red trash link "Revoke access".
5. Clicking "Revoke access" → AJAX POST `{username, action: "revoke_binding", binding_id}`.
6. Server `revoke_binding(username, binding_id)`:
   - `binding_id` not among the **currently configured** auth methods →
     `{"error": true, "message": "Incorrect authentication binding."}`;
   - user exists and (has more than one binding **or** has a `password` field) →
     `$unset bindings.<binding_id>` → `{"message": ""}` → page reload;
   - otherwise → `{"error": true, "message": "You must set a password before removing all bindings."}`.
   Errors are shown in `#feedback_bindings`.

## Alternative / error flows
- Legacy: bindings of an auth method that is no longer configured could not be revoked
  (always "Incorrect authentication binding."); the app accepts any binding present on the
  user.
- Legacy: unknown username with `get_bindings` → `{}`.
- The "has a password" condition is a non-empty `password` field (legacy tested the presence
  of the mongoengine attribute).

## UI elements
`#binding_modal` ("Available bindings", alert `#feedback_bindings`, button "Cancel"); cards with
`.binding_method`, `.binding_identifier`, `.binding_revoke` (tooltip "Revoke access"). Identifier
inserted as text (`.text()`). Card element ids are `<binding_id>-template` (jQuery selector
built by string concatenation).

## Data
Reads `users.bindings` (map auth_id → `[id, extra]`); writes `$unset: {"bindings.<id>": 1}`.

## Permissions & security
Superadmin only (anonymous → sign-in page, others → 403); the POST is protected by the
origin check of form POSTs. The same revocation logic is used by the user's own
preferences page (`/preferences/bindings`, AUTH area).

## Acceptance tests
- The user list shows each stored binding (method id and identifier).
- revoke with a method id the user has no binding for → "Incorrect authentication binding.".
- revoke last binding of a user without password → "You must set a password before removing all bindings.".
- revoke one of two bindings → removed from DB, "Binding revoked.".
