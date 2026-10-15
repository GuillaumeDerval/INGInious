# Index page and welcome page

- **ID**: AUTH-01
- **Actors**: anonymous, student, tutor, course admin, superadmin
- **Routes**: GET/POST `/`, GET/POST `/index`
- **Depends on**: AUTH-02 (static page rendering), AUTH-10 (language), course list feature (`/courselist`)
- **Legacy code**: `legacy/inginious/frontend/pages/index.py:L11-L23`, `legacy/inginious/frontend/pages/utils.py:L206-L242` (`INGIniousStaticPage.show_page`), `legacy/inginious/frontend/flask/mapping.py:L59-L60`, `legacy/inginious/frontend/app.py:L103-L105` (config key), template `templates/static.html`

## Use case
A visitor opening the root URL of the instance either lands on an operator-defined welcome page
(e.g. a presentation of the platform) or, when none is configured, is sent to the public course list.

## Preconditions
- Instance not in maintenance mode (otherwise AUTH-03 catches every route).
- Optional configuration key `welcome_page: <pageid>` (string; stored in Flask config as `WELCOME_PAGE`).

## Main flow
1. Client requests `GET /` or `GET /index` (POST behaves identically: `POST()` calls `GET()`).
2. Language pre-check runs (AUTH-10: `?lang=` or Accept-Language on first visit).
3. If `welcome_page` is configured: render the static page `<welcome_page>` exactly like `/pages/<welcome_page>` (AUTH-02) — HTTP 200, `static.html` with the YAML `title` as page title and the RST `content` rendered to HTML.
4. Otherwise: HTTP 302 redirect to `/courselist`.

## Alternative / error flows
- `welcome_page` configured but neither `<static_directory>/<page>.yaml` nor `<static_directory>/<page>.<lang>.yaml` exists → 404 with `notfound.html` and message "File doesn't exist.".
- Malformed YAML / missing `title` or `content` key → unhandled exception → 500.
- The index page does not require authentication; a logged-in user sees the same page (with the logged-in sidebar).

## UI elements
- Same layout as AUTH-02 (`static.html` extends `layout.html`): `<title>` = `" {title}  | INGInious"`; body = rendered RST (headers start at `<h2>`, `initial_header_level=2`).
- Sidebar/user menu: see AUTH-18.

## Data
- Config: `welcome_page` (optional), `static_directory` (default `./static`, relative to the frontend's CWD).
- Files read: `<static_directory>/<welcome_page>.yaml` and `<static_directory>/<welcome_page>.<session.language>.yaml` (language-specific one wins if both exist). YAML keys: `title` (str), `content` (reStructuredText str).
- Session: a session document is created/refreshed for every request, even anonymous (see AUTH-04).
- No user/course collection read.

## Permissions & security
- Public. No CSRF relevance (read-only).
- The RST content is operator content (`.. raw:: html` blocks allowed, no file insertion); the rendered HTML is sanitized before display. Only operator-provided files are rendered here, never user-controlled content.

## Acceptance tests
- With no `welcome_page`: `GET /` → 302 `Location: /courselist`; `GET /index` → same; `POST /` → same.
- With `welcome_page: auth_welcome` and `auth_welcome.yaml` (`title: Welcome AUTH`, `content` with an RST section): `GET /` → 200, `<title>` contains "Welcome AUTH", body contains `<strong>world</strong>` and `<h2>Section</h2>`.
- With `auth_welcome.fr.yaml` also present: `GET /index?lang=fr` → page shows the French title/content ("Bienvenue AUTH"); `GET /` with English session shows the default file.
- `welcome_page` pointing to a missing file → 404 "File doesn't exist.".
- Logged-in user `GET /` → same welcome page (200), sidebar shows user menu.
