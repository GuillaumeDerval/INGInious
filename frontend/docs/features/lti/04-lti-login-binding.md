# LTI login and account binding (LMS user ↔ INGInious account)

- **ID**: LTI-04
- **Actors**: LTI user; logged-in INGInious user (in a separate window/tab)
- **Routes**: GET|POST /lti/login, GET|POST /lti/bind?lti_session_id=…, GET|POST /lti1.3/login, GET|POST /lti1.3/bind?lti_session_id=…
- **Depends on**: LTI-02 / LTI-09 (session.lti), LTI-03, password login (AUTH area)
- **Legacy code**: `legacy/inginious/frontend/pages/lti/__init__.py:26-102`
  (`LTIBindPage`, `LTILoginPage`), `pages/lti/v1_1/__init__.py:210-215`,
  `pages/lti/v1_3/__init__.py:200-207`, `templates/lti/login.html`, `templates/lti/bind.html`,
  `legacy/inginious/frontend/user_manager.py:171-201` (`connect_user`),
  `legacy/inginious/frontend/models/user.py:19` (`ltibindings`),
  `legacy/inginious/scripts/database_update.py:146-180` (db_version 19 migration)

## Use case
The LMS identifies its users with opaque ids. The first time an LMS user launches an
INGInious activity, they must *bind* the LMS identity to an existing INGInious account
(by logging into INGInious in a popup). Afterwards every launch from the same LMS
context logs them in automatically.

## Preconditions
- The current request carries an LTI session (`session.lti` not null), created by a launch.
- For binding: the user has an INGInious account (created beforehand through the normal
  registration or any auth method; INGInious does not auto-provision accounts from LTI).

## Main flow
Binding key ("field"):
- LTI 1.1: `field = "<courseid>/" + consumer_key.replace(".", "").replace("$", "")`
  (e.g. `lti_test/ltikey`).
- LTI 1.3: `field = platform_instance_id.replace(".", "").replace("$", "")` with
  `platform_instance_id = "<iss>/<client_id>/<deployment_id>"`
  (e.g. `https://platformexample/tool-client-1/dep-1`). Note: **not scoped by course** —
  one binding per platform deployment.

Behaviour of the app (`app/src/lib/server/lti/common.ts`, `pages.ts`); legacy differences
are noted at the end of the section.

Login (`/lti/login`, `/lti1.3/login`, GET, in the LTI session of the iframe):
1. No LTI data in the session → 403 "No LTI data available.".
2. If the session is not logged in yet, look up `users` where
   `ltibindings.<field> == session.lti.username`. If found → the session is logged in as
   that user (`loggedin`, `email`, `username`, `realname`, `language`, `timezone`,
   `code_indentation`, `tos_signed`), its id is rotated and `redir_url` gets the new
   session token.
3. If (now) logged in → `302` to `session.lti.redir_url` (`/lti/task?session_id=…`,
   `/lti1.3/task?session_id=…` or `/lti1.3/deeplink?session_id=…`).
4. Otherwise render the login card: "Hello!" / "Welcome on the INGInious platform.",
   "In order to use INGInious via this platform, please bind your existing account or
   create a new one.", and:
   - **Bind your INGInious account** — link opening `/lti[1.3]/bind?lti_session_id=<bind token>`
     in a new tab; the bind token is a signed token designating the LTI session, valid
     15 minutes, never the raw session id;
   - **Refresh** — reloads the login step; the page also re-checks automatically every
     3 seconds, so it continues as soon as the binding is done.

Binding (`/lti/bind`, `/lti1.3/bind`), opened in a new tab that uses the **normal cookie
session** of the browser:
5. Not signed in → redirect to the sign-in page, which comes back to the bind page.
6. GET: check the bind token (signature, expiry) and load the LTI data of the LTI session
   it designates. Missing, invalid or expired token, or unknown session → 400 error page
   "Invalid LTI session id". Otherwise render the confirmation card: the INGInious account
   **<realname> [<username>]** and the tool and context (Tool name, Tool description, Tool
   URL, `<context_label> - <context_title>`, `<lms username> - <lms realname>`), "This
   operation cannot be undone."; buttons **Bind my account** (POST, same URL) and
   **Cancel** (`window.close()`).
7. POST (bind token checked again):
   - If nobody else is bound to this LMS user and the current user has no binding for
     `field` (or the same one) → set `users.ltibindings[field] = lms_username`;
   - binding again the same pair succeeds (idempotent);
   - otherwise (LMS user bound to someone else, or current user already bound to another
     LMS user in this context) → 400 with "Your account is already bound with this
     context." (card still shown).
8. On success the page shows "Your account is now bound. You can close this window and go
   back to your LMS."; the login step in the iframe finds the binding at its next check and
   redirects to the task.

Legacy differences (functional): the login step accepted POST, the bind link was an
`onclick="window.open(…)"` with `href="#"`, the bind window showed the full login form
itself, and on success it reloaded `window.opener` and closed itself.

## Alternative / error flows
- Malformed `lti_session_id` → "Invalid LTI session id".
- POST to bind with a stale/expired bind token or LTI session → "Invalid LTI session id".
- LTI task pages reached by a session that is not logged in send the user to the login
  step: the iframe offers no password login, so the INGInious account is always reached
  through a binding.
- There is no UI to list or revoke LTI bindings (preferences/bindings page only handles
  auth-method bindings; superadmin user admin does not show them).

## UI elements
- LTI login card (`LtiLogin.svelte`) and bind confirmation card (`LtiBind.svelte`),
  described above. The bind page is rendered with the normal (non-LTI) layout, since it
  runs in the user's normal session.

## Data
- `users.ltibindings`: `MapField(StringField)` — flat map `{field: lms_user_id}`, e.g.
  `{ 'lti_test/ltikey': 'lms-user-1', 'https://platformexample/tool-client-1/dep-1': 'plat-user-1' }`.
  Before db_version 19 the 1.1 format was nested `{courseid: {consumer_key: user_id}}`;
  migration 19 flattened it to `"courseid/consumer_key"`. The field key contains `/` and
  `:`; `.` and `$` are stripped because Mongo keys cannot contain them.
- Reads `sessions` by id (the LTI session designated by the bind token) for the bind page.
- Logging in through a binding writes the session (new id).

## Permissions & security
- The bind page only accepts a token signed by the server (HMAC, own context, constant-time
  comparison) that designates an LTI session and expires after 15 minutes; the bind POST
  is protected by the origin check of form POSTs and requires the explicit confirmation of
  the signed-in user.
- Logging in through a binding rotates the LTI session id; the account is then usable in
  the LTI session, limited to the LTI pages (LTI-03).
- LMS roles are ignored; an LMS user can only be bound to an INGInious account its user
  can sign into.
- One LMS user per account and per binding key, one account per LMS user and binding key.
- Binding cannot be undone by the user.
- The iframe session is identified by the signed LTI token (LTI-03).

## Acceptance tests
- Launch with an unbound LMS user → login page with bind link
  `/lti/bind?lti_session_id=<bind token>`.
- Bind tab, not signed in → sign-in page then back to the bind page; confirmation card
  with tool info; click Bind → `users.ltibindings['<courseid>/<key>'] = <user_id>`; the
  iframe login step then redirects to the task.
- LTI 1.3: binding key `iss/client/deployment` with `.`/`$` removed.
- Next launch by the same LMS user → `/lti/login` redirects straight to `redir_url`.
- Second INGInious account trying to bind the same LMS user → "Your account is already
  bound with this context."; same account rebinding → success.
- Account already bound to LMS user A trying to bind LMS user B in the same context →
  error.
- `/lti/login` without LTI data → 403; `/lti/bind` without `lti_session_id` → "Invalid LTI
  session id".
- Test: a forged or expired bind token → "Invalid LTI session id"; a not logged-in LTI
  session is never logged in without a binding.
