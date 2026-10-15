# Layout chrome: sidebar user menu, anonymous menu, footer

- **ID**: AUTH-18
- **Actors**: anonymous, logged-in user, superadmin, LTI user
- **Routes**: every HTML page (`layout.html`)
- **Depends on**: AUTH-05, AUTH-06, AUTH-07, AUTH-10, AUTH-11
- **Legacy code**: `legacy/inginious/frontend/templates/layout.html:L128-L233`, `legacy/inginious/frontend/app.py:L177-L193` (Jinja globals, `template_helper` hook)

## Use case
Every page shows a left sidebar whose content depends on the authentication state: anonymous
visitors can pick a language, browse courses, register or sign in; logged-in users reach their
courses, preferences, service status and logout; superadmins get an administration section.

## Preconditions
None.

## Main flow
- Top bar: logo + "INGInious" linking to `/` (to `#` in LTI sessions); hamburger button toggling body classes `sidebar-state-0`/`sidebar-state-1` (title "Open menu"); `navbar` block (breadcrumbs) hidden in LTI sessions.
- Sidebar (hidden entirely for LTI sessions):
  - **Logged in** (`session.loggedin`):
    - If superadmin: collapsible "Administration" (`fa-shield`, `#collapseAdministratorMenu`) with "Users" → `/administrator/users`, "Marketplace" → `/marketplace`.
    - "Course list" → `/courselist` (`fa-th-list`).
    - Collapsible user entry `fa-user` + `session.realname` (`#collapseUserMenu`): "My courses" → `/mycourses`, "Preferences" → `/preferences`, "Service status" → `/queue` (`fa-dashboard`), "Log out" → `/logout` (`id="logoff_button"`, `fa-sign-out`).
  - **Anonymous**: collapsible language entry (`fa-globe`, label = `_("English")`, `#collapseLang`) with one link per language `?lang=<code>` "<code> (<name>)"; "Course list"; "Register" → `/register` (only if `allow_registration`); "Sign in" → `/signin`.
  - Below: optional `column` block (page-specific menus, e.g. preferences menu).
- Footer: non-LTI "Running INGInious v.<version>", "© 2014-2026 Université catholique de Louvain.", link "INGInious is distributed under AGPL license" → http://www.inginious.org; LTI: "Powered by INGInious v.<version>, a free and open-source grading tool."; if ToS defined: " - Privacy Policy" link.
- Global JS: `user_indentation_type`, `dtf` (AUTH-11); Sentry init with user `{username, realname}` when `sentry_io_url` configured and logged in; MathJax from cdnjs; plugin hooks `css`, `javascript_header`, `javascript_footer`, `header_html`.

## Alternative / error flows
- Realname empty → user entry shows only the icon.
- Template `<html lang="en">` is fixed (AUTH-10).

## UI elements
As listed above (Bootstrap 4 list-group with collapse).

## Data
- Reads only the session (`loggedin`, `realname`, `username`, `is_lti`, `language`, `timezone`, `code_indentation`) and config (`ALLOW_REGISTRATION`, `LANGUAGES`, `IS_TOS_DEFINED`, `PRIVACY_PAGE`, `SENTRY_IO_URL`, `USE_MINIFIED_JS`), `user_manager.user_is_superadmin()`.

## Permissions & security
- Sentry browser reporting is initialised with the DSN only; no user identity is passed to it (CORE-06).
- Administration menu only hides links; pages enforce superadmin themselves.

## Acceptance tests
- Anonymous: sidebar has language menu with 10 entries, "Course list", "Register" (absent when `allow_registration:false`), "Sign in".
- Logged-in student: "Course list", user menu with realname and the four entries; no Administration.
- Superadmin: Administration with Users and Marketplace.
- LTI session: no sidebar items, no breadcrumbs, logo links to `#`, "Powered by" footer.
- Footer privacy link present iff both ToS pages configured.
