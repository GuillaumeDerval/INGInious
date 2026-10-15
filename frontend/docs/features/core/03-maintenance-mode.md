# Maintenance mode

- **ID**: CORE-03  (same feature as AUTH-03; this file adds the live verification on a scratch container)
- **Actors**: everyone
- **Routes**: GET/POST `/` (endpoint `maintenancepage.alias`) and `/<path:path>` (endpoint `maintenancepage`) when `maintenance: true`
- **Depends on**: CORE-01 (layout), CORE-09 (static assets)
- **Legacy code**: `legacy/inginious/frontend/app.py:68,218-221`, `legacy/inginious/frontend/flask/mapping.py:53-55`, `legacy/inginious/frontend/pages/maintenance.py:12-21`, `legacy/inginious/frontend/templates/maintenance.html:1-11`

## Use case
An operator upgrading INGInious (DB migration, course moves) sets `maintenance: true` and restarts
the frontend so that every URL shows "under maintenance" instead of the application.

## Preconditions
- `maintenance: true` in `configuration.yaml` at start-up (read once; toggling requires a restart).
- MongoDB must still be reachable: `get_app` connects and checks `db_version` *before* the maintenance branch (`app.py:132-137`), and sessions are still stored.

## Main flow (intended)
1. `get_app` builds the Flask app, session interface, ZMQ loop + backend `Client` object (created but **not started**), mail, template globals, error handlers.
2. Because `config["MAINTENANCE"]` is true, only `init_flask_maintenance_mapping` runs (`app.py:219-221`): the URL map contains `/` and `/<path:path>` -> `MaintenancePage`, plus Flask's own `/static/<path>`.
   Plugins are **not** loaded and `client.start()` is **not** called; `get_app` returns `(wsgi_app, lambda: None)`.
3. `MaintenancePage.get/post(path=None)` renders `maintenance.html` for any path and method GET/POST (`pages/maintenance.py:15-21`): title "Maintenance | INGInious",
   logo `static/images/logo_maintenance.png`, red alert "<b>This INGInious instance is currently under maintenance.</b> Please come back in a few minutes!" (translated, `|safe`). Intended status 200.
4. Static files are still served by `SharedDataMiddleware` at `/static/` (`scripts/webapp.py:46-48`).

## Alternative / error flows
- **Legacy bug, verified live** (scratch container `inginious-local/core-frontend:latest` started with `maintenance: true`, removed afterwards):
  `GET /`, `GET /course/tutorial`, `POST /` all return **HTTP 500** with gunicorn's bare page
  (`<title>Internal Server Error</title>`, `Content-Type: text/html`, no session cookie). Log:
  `werkzeug.routing.exceptions.BuildError: Could not build url for endpoint 'indexpage'. Did you mean 'maintenancepage' instead?`
  — `maintenance.html` extends `layout.html`, which calls `url_for('indexpage')`, `url_for('courselistpage')`, `url_for('signinpage')`, ...; the 500 handler's
  `internalerror.html` extends the same layout and fails again. `GET /static/images/logo_maintenance.png` -> 200.
- The rewrite must implement the intended behaviour: a maintenance page for every non-static URL, rendered with a layout that does not link to disabled pages.
  Recommended: status 503 + `Retry-After` (document the deviation from the intended 200).
- Other methods (PUT/DELETE...) -> 405 (only GET/POST defined; HEAD/OPTIONS automatic).

## UI elements
- Logo image + red alert box, inside the standard layout (sidebar/footer). No navigation is useful in this mode.

## Data
- Config: `maintenance` (bool, default false). No collection is read except `db_version` (startup) and `sessions` (each request creates/updates a session document).
- No messages are sent to the backend.

## Permissions & security
- Applies to everyone, superadmins included; there is no bypass.
- The LTI, API and WebDAV (`/dav`) endpoints of the app are also answered with the maintenance page (legacy: the WebDAV server was a separate process not affected by this key).

## Acceptance tests
- With `maintenance: true`: `GET /`, `GET /courselist`, `GET /course/x/y`, `POST /signin`, `GET /api/v0/courses` all return the maintenance page (body contains "This INGInious instance is currently under maintenance."), never the real page, with the chosen status (503 recommended; legacy intent 200).
- With `maintenance: true`: `GET /static/images/logo_maintenance.png` -> 200 image.
- With `maintenance: true`: no plugin routes exist (`/plugindemo` -> maintenance page), and no job is ever sent to the backend.
- With `maintenance: false` (default): `/` behaves normally (redirect to `/courselist` or welcome page).
- Regression: the maintenance page renders without server error (no reference to routes that are not registered).
