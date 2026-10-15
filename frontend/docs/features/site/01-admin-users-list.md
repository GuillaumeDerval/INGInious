# Site administration: list and paginate users

- **ID**: SITE-01
- **Actors**: superadmin
- **Routes**: GET /administrator/users?page=&q= (app); legacy: GET /administrator/users, POST /administrator/users (pagination)
- **Depends on**: AUTH (login, session), SITE-02..05 (actions launched from this page)
- **Legacy code**: `legacy/inginious/frontend/pages/admin/admin.py:L14-34` (`AdministrationUsersPage`),
  `pages/utils.py:L154-182` (`INGIniousAdministratorPage`), `templates/admin/admin_users.html`,
  `static/js/admin.js`, `templates/layout.html:L150-158` (menu entry), `flask/mapping.py:L159-162`

## Use case
A platform superadmin wants to see every account of the platform (including accounts that have not
been activated yet) and act on them (create, delete, activate, inspect/revoke external bindings).

## Preconditions
- The user is logged in and their username is listed in `superadmins:` of the configuration.

## Main flow
App behaviour (`app/src/routes/administrator/users`, `lib/server/site/users.ts`): the page
is read with `GET /administrator/users?page=<n>&q=<search>`; `page` is clamped to
`[1, pages]` (pages ≥ 1) and `q` filters case-insensitively on username, real name or
e-mail (the search text is escaped before being used as a regular expression). 10 users
per page, natural MongoDB order. Anonymous users are redirected to the sign-in page;
logged-in non-superadmins get 403.

Legacy flow (reference):
1. The superadmin opens the left menu "Administration" (only rendered when
   `user_manager.user_is_superadmin()`), sub-entry "Users" → `GET /administrator/users`.
2. The page lists 10 users of the `users` collection (page 1), in **natural MongoDB order** (no sort),
   with total pages = `ceil(count(users) / 10)`.
3. The superadmin clicks a page number in the pagination widget → JS fills the hidden form
   `#page_form` (`page=<n>`) and submits `POST /administrator/users` (form post, full page reload).
4. The page re-renders with `skip((page-1)*10).limit(10)`.

## Alternative / error flows
Legacy (reference; the app behaviour is described in the main flow):
- Anonymous GET → login form (`auth.html`, HTTP 200). Logging in through this form: POST with
  `login`/`password` is **not** handled (admin POST for anonymous returns the forbidden page).
- Logged-in non-superadmin GET → `forbidden.html` with message "Forbidden", **HTTP 200** (not 403).
- Non-superadmin or anonymous POST → `forbidden.html` "You have not sufficient right to see this part.", HTTP 200.
- `page` not an integer (`abc`), `0` or negative → unhandled exception → HTTP 500 (internal error page).
  (`int("abc")` ValueError; negative `skip` rejected by MongoDB.)
- `page` greater than the number of pages → empty table, pagination widget starts on that page (HTTP 200).
- `GET /administrator/users?page=2` is ignored (only the POST form field is read).
- Superadmin GET uses `INGIniousAdministratorPage.GET`, which does not show the ToS /
  empty-username prompts of `INGIniousAuthPage.GET`.

## UI elements
(see `img/admin-users.png`, `img/admin-users-add.png`)
- Title "Users Administration", breadcrumb "Users Admin".
- Left column: entries of hook `main_menu` printed **escaped** (raw HTML text visible: legacy bug).
- Button "Add user" (opens `#add_modal`, SITE-02).
- Table columns: "member" (`realname or username`), "username", "email address" (as `mailto:` link),
  a header button "Download CSV" (`href="#"`, **dead link, does nothing**), hidden cell
  `#binding_<username>` with `data-bindings`, and per-row action buttons:
  - cloud icon "Bindings" (always) → `#binding_modal` (SITE-05);
  - for rows other than the current user only: thumbs-up "Activate" (only if the user document has
    an `activate` field) → `#activate_modal` (SITE-04); trash "Delete" → `#delete_modal` (SITE-03).
- Pagination: `jquery.twbsPagination` (`totalPages`, `startPage`, `visiblePages: 5`, First/Previous/Next/Last).
  Note: twbsPagination throws if `totalPages` is 0 (impossible in practice: the superadmin exists).
- No search/filter feature exists in this legacy page despite the template comment
  (`displayed_selection` hidden inputs are always empty and unused).
- Realnames/usernames/emails are HTML-escaped.

## Data
- Reads `users` collection: `User.objects.skip(..).limit(10)` and `User.objects.count()`; fields
  displayed: `realname`, `username`, `email`, `bindings`, `activate` (presence only).
- No writes.

## Permissions & security
- Superadmin check: `username in config.superadmins` (`UserManager.user_is_superadmin`).
- Anonymous users are redirected to the sign-in page; non-superadmins get 403.
- Emails of all users are shown to superadmins only.
- Pagination is read-only; state-changing requests are protected by an origin check.

## Acceptance tests
- Superadmin GET → 200, title "Users Administration", 10 rows max, pagination with `ceil(N/10)` pages.
- `?page=2` → rows 11-20 of the natural order; `?q=` filters on username, real name, e-mail.
- Invalid page (`abc`, `0`, `-1`) or too large → clamped to the valid range (legacy 500).
- Logged-in non-superadmin GET → 403; anonymous GET → redirect to the sign-in page.
- Row of the logged-in superadmin has no Activate/Delete buttons; user with `activate` field shows Activate.
- Realname containing `<script>` is rendered as text.
