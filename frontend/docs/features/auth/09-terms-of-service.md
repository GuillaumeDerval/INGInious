# Terms of Service / privacy acceptance

- **ID**: AUTH-09
- **Actors**: any logged-in user (non-LTI)
- **Routes**: all `INGIniousAuthPage` GETs (gate), POST `/preferences/profile`, POST `/register`
- **Depends on**: AUTH-02 (pages), AUTH-05 (gate), AUTH-07, AUTH-11
- **Legacy code**: `legacy/inginious/frontend/app.py:L103-L105,L115`, `legacy/inginious/frontend/pages/utils.py:L96-L99`, `legacy/inginious/frontend/pages/preferences/profile.py:L121-L124`, `legacy/inginious/frontend/pages/register.py:L81-L83,L96-L98`, `legacy/inginious/frontend/user_manager.py:L196`, templates `preferences/profile.html:L44-L49,L103-L108`, `register.html:L46-L50`, `layout.html:L212-L214`

## Use case
An institution must make every user accept its Terms of Service and Privacy Policy before using
the platform (GDPR). Once both pages are configured, users who have not accepted are forced to the
profile page until they tick the checkbox.

## Preconditions
- Config has **both** `terms_page` and `privacy_page` (`IS_TOS_DEFINED`). If only one is set, the feature is entirely off.

## Main flow
1. Registration (AUTH-07): checkbox `term_policy_check` mandatory; new users get `tos_accepted: true`.
2. Login (any method): `session.tos_signed = user.tos_accepted` (missing field → mongoengine default `false`).
3. Any GET on a protected page while `tos_signed` is false → 302 `/preferences/profile`, which shows the warning alert "Please accept the Terms of Service and Data Privacy" and the checkbox (unchecked).
4. User ticks the checkbox and saves the profile (`save` + `term_policy_check=on`) → `users.update({username}, {$set:{tos_accepted: true}})`, `session.tos_signed = True`, "Profile updated.".
5. Protected pages accessible again.

## Alternative / error flows
- Saving the profile *without* the checkbox writes `tos_accepted: false` and sets `session.tos_signed` to the same value → the user stays gated.
- Profile save while ToS defined and checkbox unchecked by a user who had accepted earlier → `tos_accepted` becomes `false` (revocation) — keep this behaviour (DB) but the session must reflect it.
- Both GET and POST requests to protected pages are gated by ToS.
- The ToS update is executed after the other profile fields, only when no earlier validation error returned.
- Users created by external auth/LTI start with `tos_accepted:false` → gated.
- LTI pages: the gate logic is in `INGIniousAuthPage.GET`; LTI pages use other base classes (see LTI area).

## UI elements
- Checkbox `term_policy_check` + "I have read the Terms of service and the Privacy policy." with links to `/pages/<terms_page>` and `/pages/<privacy_page>` (profile: pre-checked if `session.tos_signed`).
- Warning alert on profile page as above.
- Footer link "Privacy Policy".

## Data
- `users.tos_accepted`: bool (default false).
- `sessions.tos_signed`: bool.
- Config: `terms_page`, `privacy_page`.

## Permissions & security
- The session flag always mirrors `users.tos_accepted`. Only a boolean is stored (no record of *when* or *which version* of the ToS was accepted).

## Acceptance tests
- ToS defined, user with `tos_accepted` absent: login → `GET /mycourses` 302 `/preferences/profile`, warning displayed.
- Saving profile with `term_policy_check=on` → DB `tos_accepted:true`, `/mycourses` 200.
- Saving without the checkbox → DB `tos_accepted:false` and still gated.
- ToS not defined (or only one page configured) → no gate, no checkbox, no footer link.
- Registration without checkbox when defined → "Please accept the Terms of Service and Data Privacy".
