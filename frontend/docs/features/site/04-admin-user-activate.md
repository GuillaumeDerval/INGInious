# Site administration: manually activate a pending account

- **ID**: SITE-04
- **Actors**: superadmin
- **Routes**: POST /administrator/users?/activate (app form action); legacy: POST /administrator/user_action (`action=activate`)
- **Depends on**: SITE-01, AUTH registration (creates `activate` hashes)
- **Legacy code**: `pages/admin/admin.py:L44-47`, `user_manager.py:L268-274` (`activate_user`),
  `user_manager.py:L124-142` (`auth_user` refuses users with `activate`), `templates/admin/admin_users.html` (`#activate_modal`)

## Use case
A user registered through `/register` but never received/clicked the activation e-mail; the
superadmin activates the account by hand.

## Preconditions
- Logged in as superadmin; target user document has an `activate` field (pending registration).

## Main flow
App behaviour (action `activate`, `lib/server/site/users.ts` `activateUser`): the `activate`
field of the user named `username` is removed only if it exists; answer "User activated.",
or a failed action (404) "User not found" when there is no such pending account.

Legacy flow (reference):
1. Rows of users having an `activate` field show a green thumbs-up "Activate" button.
2. Modal "Activate <username>" — "This will activate <username>." — button "Activate".
3. AJAX POST `user_action` `username=<u>, action=activate`.
4. Server: `user = User.objects.get(username=username)`; `activate_user(user.activate)` →
   `User.objects(activate=<hash>).modify(unset__activate=True)`.
5. `{"message": ""}` → reload; the user can now log in (verified: login via API returns 403
   before, `{"status":"success"}` after).

## Alternative / error flows
Legacy (reference):
- Unknown username → `User.objects.get` raises `DoesNotExist` → **HTTP 500** (HTML error page; the
  JS `.done` handler never fires, the modal stays open without message).
- User already active (`activate` absent): `activate_user(None)` runs `modify` on the first user
  matching `activate: null` (i.e. any user without the field) and unsets it — harmless no-op that
  returns success `{"message": ""}`. The "User not found" message is only produced if no document
  at all matches.

## UI elements
Modal `#activate_modal`, alert `#feedback_activate`, buttons "Cancel" / "Activate".

## Data
`users`: `$unset: {activate: ""}` on the document whose `activate` equals the target's hash.

## Permissions & security
Superadmin only (anonymous → sign-in page, others → 403); the POST is protected by the origin
check of form POSTs.

## Acceptance tests
- Pending user (with `activate: "<hash>"`) cannot log in; after action, field removed and login works.
- Answer "User activated."; unknown or already active user → 404 "User not found" (legacy 500 / no-op).
- Button hidden for active users and for the current user.
