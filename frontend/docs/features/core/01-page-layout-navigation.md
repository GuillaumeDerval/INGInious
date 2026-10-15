# Page layout and navigation (layout.html, sidebar, top bar, footer, language, RTL)

- **ID**: CORE-01
- **Actors**: anonymous | student | tutor | course admin | superadmin | LTI user
- **Routes**: all HTML routes (cross-cutting); `?lang=<code>` query parameter on any page
- **Depends on**: AUTH-04 / CORE-04 (session: `loggedin`, `realname`, `language`, `timezone`, `code_indentation`, `is_lti`), CORE-09 (static assets), CORE-06 (Sentry), AUTH-02 (privacy page link)
- **Legacy code**: `legacy/inginious/frontend/templates/layout.html:1-233`, `legacy/inginious/frontend/app.py:177-193` (template globals, context processor, LTI `url_defaults`), `legacy/inginious/frontend/pages/utils.py:33-39` (language selection), `legacy/inginious/frontend/i18n/__init__.py:13-38`, `legacy/inginious/frontend/plugins/plugin_manager.py:37-62,105-114` (hooks, template prefixes), `static/js/common.js:9-45`, `static/js/webapp.js:16-35`, `static/css/INGInious.less`, `static/css/INGInious-rtl.less`

## Use case
Every page of INGInious shares the same chrome: a dark top-left logo block with a sidebar toggle,
a top bar holding the page breadcrumb, a left sidebar with the global menu (sign-in / register /
language for anonymous users; administration / course list / user menu for logged-in users) and
page-specific blocks (course menu, task list, plugin entries), the page content, and a footer with
version and licence. Users can switch the UI language; Hebrew switches the whole layout to RTL.
Inside an LMS iframe (LTI session) the navigation is hidden.

## Preconditions
- None (rendered for anonymous visitors too). Every request has a session object (CORE-04).

## Main flow
1. Each page template does `{% extends "layout.html" %}` and fills blocks `title`, `navbar`
   (breadcrumb in the top bar), `column` (extra sidebar content) and `content`; `head` can be extended.
2. `<head>` (`layout.html:10-125`): charset, viewport, `<title>{block title} | INGInious</title>`,
   favicons/apple-touch icons/`msapplication-*` metas, CSS (Bootstrap 4.5.3 Bootswatch "Yeti" theme
   or its RTL build, `INGInious.css`/`INGInious-rtl.css`, tempusdominus datetimepicker, Font Awesome 4.7.0,
   CodeMirror, selectize), optional Sentry block (CORE-06), JS bundle (minified or individual files, CORE-09),
   `CodeMirror.modeURL = "/static/js/codemirror/mode/%N/%N.js"`, then plugin hooks:
   `css` (-> `<link rel=stylesheet>`), `javascript_header` (-> `<script src>`), `header_html` (raw HTML).
3. `<body class="sidebar-state-0">`. Top row `#inginious-top`:
   - `#inginious-logo` link to `url_for('indexpage')` (`/`), or `#` in an LTI session; image `static/images/header.png` + text "INGInious".
   - `#inginious-sidebar-toggle` button (title "Open menu", icon `fa-bars`) toggling body classes `sidebar-state-0`/`sidebar-state-1` (collapses/expands the sidebar; on small screens the sidebar is hidden by default, CSS media queries at 600px/992px).
   - `#inginious-topbar`: the page's `navbar` block (Bootstrap breadcrumb), omitted in LTI sessions.
4. Sidebar `#inginious-sidebar` (`layout.html:144-199`), omitted entirely (global menu) in LTI sessions:
   - Logged in: if superadmin, collapsible "Administration" (`fa-shield`) with "Users" (`/administrator/users`) and "Marketplace" (`/marketplace`);
     "Course list" (`/courselist`); collapsible user menu labelled with `session.realname` containing
     "My courses" (`/mycourses`), "Preferences" (`/preferences`), "Service status" (`/queue`), "Log out" (`/logout`, `id="logoff_button"`).
   - Anonymous: collapsible language menu labelled `_("English")` (i.e. the current language's own name) listing every
     `config.LANGUAGES` entry as `?lang=<code>` links shown as "`code` (`Name`)"; "Course list"; "Register" (only if `allow_registration`); "Sign in" (`/signin`).
   - Then, if the page defines a non-empty `column` block, a spacer and that block (page-specific menus;
     pages call plugin hooks `main_menu`, `course_menu`, `task_menu`, `course_admin_menu`, `prefs_menu`, `submission_admin_menu`, `task_list_item` inside their own blocks).
5. `#main-content`: the `content` block, then `#footer`:
   - normal: "Running INGInious v.{version}" / "© 2014-2026 Université catholique de Louvain." / link "INGInious is distributed under AGPL license" -> http://www.inginious.org;
   - LTI session: "Powered by INGInious v.{version}, a free and open-source grading tool." (link);
   - if `IS_TOS_DEFINED`: " - Privacy Policy" link to `/pages/<privacy_page>`.
6. End of body: MathJax 2.7.1 from cdnjs (`TeX-AMS-MML_HTMLorMML`), plugin `javascript_footer` scripts, then an inline script defining
   globals `user_indentation_type = INDENTATION_TYPES[session.code_indentation]` and
   `dtf = new Intl.DateTimeFormat([moment.locale(session.language), "en"], {dateStyle:"short", timeStyle:"medium", timeZone: session.timezone})`.
   `webapp.js` reformats every `<time datetime="ISO">` element with `dtf` on DOM ready (macro `show_time` in `layout.html:5-7` emits these).
7. Language selection (`pages/utils.py:33-39`, run before every `INGIniousPage` GET/POST): if `?lang=X` with X in
   `available_languages` -> `session.language = X` (persisted in the session doc, also for anonymous users);
   else if `session.language` empty -> best match of `Accept-Language` among available languages, default `en`.
   On login the session language is replaced by `users.language` (`user_manager.py:193`).
   All strings go through `gettext` (`_`), which looks up `session.language` (`i18n/__init__.py:13-15`).
   Available: en, de, el, es, fr, he, nl, nb_NO, pt, vi (`i18n/__init__.py:17-30`; folders `pt_BR`, `wa` exist but are not enabled).
8. RTL: when the translation of the msgid `"__is_rtl"` is `"true"` (only Hebrew, `i18n/he/LC_MESSAGES/messages.po:1383`),
   the RTL Bootstrap CSS/JS, `INGInious-rtl.css` and `all-minified-rtl.js` are used: sidebar on the right, mirrored text
   (verified with `/courselist?lang=he`, title "רשימת קורסים | INGInious"). `<html lang="en">` stays hard-coded and no `dir` attribute is set.
9. Template globals (`app.py:179-187`): `_` (gettext), `str`, `plugin_manager`, `pkg_version` (`inginious.__version__`),
   `user_manager`; Flask provides `config`, `session`, `request`, `url_for`. A context processor merges every dict
   returned by the plugin hook `template_helper` into the template context. `url_defaults` (`app.py:189-193`) appends
   `?session_id=<sid>` (or `lti_session_id` for the LTI bind pages) to every `url_for` when the session is an LTI session (CORE-04).
10. Plugin template folders are mounted under a prefix via `plugin_manager.add_template_prefix(prefix, folder)` (a `PrefixLoader` chained after the main loader, `app.py:178`).

## Alternative / error flows
- LTI session: no top-bar breadcrumb, no global sidebar menu, logo links to `#`, LTI footer text.
- No flash-message system exists (no `flask.flash` anywhere): feedback is passed as template variables
  (`msg`/`error` rendered as dismissible Bootstrap alerts `alert alert-danger|success alert-dismissable`)
  or shown by page JS.
- Bug (observed, `/mycourses` as superadmin with `upcoming_tasks` plugin): `mycourses.html`/`courselist.html`/`admin_users.html`
  print `{{ entry }}` for `main_menu` hook results without `|safe`, so the upcoming-tasks menu HTML is shown escaped as text in the sidebar.
  The rewrite must render plugin menu entries as HTML (or as structured items).

## UI elements
- IDs/classes relied on by JS/CSS: `#inginious-top`, `#inginious-sidebar-top`, `#inginious-logo`, `#inginious-logo-text`, `#inginious-sidebar-toggle`,
  `#inginious-topbar`, `#main-container`, `#inginious-sidebar`, `#inginious-sidebar-content`, `#main-content`, `#footer`,
  `#collapseAdministratorMenu`, `#collapseUserMenu`, `#collapseLang`, `#logoff_button`, body classes `sidebar-state-0|1`.
- Tooltips (`[data-toggle="tooltip"]`) and CodeMirror editors (`.code-editor` with `data-x-language`, `data-x-lines`, `data-x-first-line`) initialised by `init_common()` (`common.js:9-45`).
- Screenshots: anonymous `/courselist` (language menu, Course list, Register, Sign in + "Sign in" column block), superadmin `/mycourses` (Administration, Course list, user menu "INGInious superadmin").

## Data
- Reads session fields `loggedin`, `realname`, `username` (superadmin check), `is_lti`, `language`, `timezone`, `code_indentation` (collection `sessions`).
- Writes `sessions.language` (string, language code) on `?lang=` or first visit.
- Config: `LANGUAGES`, `ALLOW_REGISTRATION`, `IS_TOS_DEFINED`, `PRIVACY_PAGE`, `USE_MINIFIED_JS`, `SENTRY_IO_URL`, `INDENTATION_TYPES` (see `docs/reference/config.md`).

## Permissions & security
- Administration menu only rendered for superadmins (`user_manager.user_is_superadmin()`); the target pages re-check.
- Plugin menu entries are structured items (label + link) rendered as escaped text; auth-method icons are image URLs (`imlink`).
- A Content-Security-Policy is sent (`script-src 'self'` with SvelteKit nonces, `object-src 'none'`, `base-uri 'self'`); every response also carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY` outside the LTI paths, and HSTS on HTTPS.
- The language is changed only by a POST to `/language` and only to a known code (AUTH-10).

## Acceptance tests
- Anonymous GET `/courselist`: sidebar contains links "Course list" (`/courselist`), "Register" (`/register`), "Sign in" (`/signin`) and a language dropdown with exactly 10 `?lang=` entries (en, de, el, es, fr, he, nl, nb_NO, pt, vi); no "Administration".
- With `allow_registration: false`: the "Register" link is absent.
- Logged in as a student: sidebar shows "Course list" and a menu titled with the realname containing My courses, Preferences, Service status, Log out; no Administration.
- Logged in as superadmin: Administration menu with Users and Marketplace links.
- `GET /courselist?lang=fr` then `GET /courselist` (same cookie, no param): page still in French (`sessions.language == "fr"`).
- First visit with `Accept-Language: de` and no session: page rendered in German; with `Accept-Language: xx`: English.
- `?lang=he`: RTL stylesheet (`bootstrap-rtl.min.css`, `INGInious-rtl.css`) is linked and the sidebar is on the right.
- `<title>` is "<page title> | INGInious" on every page.
- Footer shows "Running INGInious v.<version>" and, when `privacy_page`+`terms_page` are configured, a "Privacy Policy" link to `/pages/<privacy_page>`.
- In an LTI session (`?session_id=` LTI session): no global sidebar menu, no breadcrumb, footer "Powered by INGInious", and every internal link carries `session_id=<sid>`.
- Sidebar toggle button switches `sidebar-state-0`/`sidebar-state-1` on `<body>`.
- `<time datetime="2026-01-01T00:00:00+00:00">` elements are re-rendered in the session timezone/locale.
- Plugin hooks: a test plugin returning a CSS URL from `css`, a script from `javascript_header`/`javascript_footer` and HTML from `header_html` sees them injected in head/footer; `main_menu` HTML is rendered as HTML (not escaped).
