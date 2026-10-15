# Logout

- **ID**: AUTH-06
- **Actors**: any logged-in user
- **Routes**: GET/POST `/logout`
- **Depends on**: AUTH-04, AUTH-05
- **Legacy code**: `legacy/inginious/frontend/pages/utils.py:L196-L203` (`LogOutPage`), `legacy/inginious/frontend/user_manager.py:L203-L212` (`disconnect_user`), `templates/layout.html:L167`

## Use case
A user ends their session on a shared computer.

## Preconditions
- Logged in (otherwise the auth gate shows the sign-in form).

## Main flow
1. User clicks "Log out" in the sidebar user menu (`<a id="logoff_button" href="/logout">`) → `GET /logout`.
2. Gate (AUTH-05) passes (note: a user with empty username or un-accepted ToS is redirected to the profile instead of being logged out!).
3. `disconnect_user()`: logs `User <username> disconnected - <realname> - <email> - <ip>` and sets `session.loggedin = False`.
4. 302 → `/courselist`.

## Alternative / error flows
- Anonymous `GET /logout` → 200 sign-in form (`auth.html`).
- Anonymous `POST /logout` with valid `login`/`password` → logs in then out → 302 `/courselist`.
- Logged-in user with empty `username` or (ToS defined and not signed) → `GET /logout` redirects to `/preferences/profile`.

## UI elements
- Sidebar user menu entry "Log out" with `fa-sign-out` icon (AUTH-18).

## Data
- `sessions`: the session document is deleted (legacy: `loggedin` set to `false`).

## Permissions & security
- Logout is a POST protected by the origin check like every state-changing request (CORE-04); `GET /logout` only shows a confirmation button.
- Logout deletes the session document and clears the cookie; the old cookie cannot be reused as logged-in.

## Acceptance tests
- Logged-in `GET /logout` → confirmation page, still logged in; `POST /logout` → 303 `/courselist`; next `GET /mycourses` redirects to the sign-in page; the session doc is deleted.
- Anonymous `GET /logout` → redirect to `/signin`.
- After logout, the sidebar shows the anonymous menu (language switcher, Course list, Register, Sign in).
- After logout the old cookie cannot be reused as logged-in.
