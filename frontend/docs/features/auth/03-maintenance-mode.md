# Maintenance mode

- **ID**: AUTH-03
- **Actors**: anyone (anonymous and logged-in alike)
- **Routes**: GET/POST `/` and `/<path:path>` (every route) when `maintenance: true`
- **Depends on**: —
- **Legacy code**: `legacy/inginious/frontend/app.py:L68,L218-L221`, `legacy/inginious/frontend/flask/mapping.py:L53-L55`, `legacy/inginious/frontend/pages/maintenance.py:L12-L21`, template `templates/maintenance.html`

## Use case
The operator takes the web application offline (DB migration, upgrade) while keeping a friendly
page for every URL. The instance is started with the config key `maintenance: true`.

## Preconditions
- Config `maintenance: true` at start-up (read once; requires a restart to toggle).

## Main flow (intended behaviour)
1. At start-up `get_app()` installs only the maintenance URL map: `/` (endpoint `maintenancepage.alias`) and `/<path:path>` (endpoint `maintenancepage`). No other page, no plugin, no backend client start (`plugin_manager.load` and `client.start()` are skipped; the function returns before them).
2. Any GET or POST on any path renders `maintenance.html`: logo `static/images/logo_maintenance.png` centered and a red alert "<b>This INGInious instance is currently under maintenance.</b> Please come back in a few minutes!" (translated, rendered `| safe`). Title "Maintenance | INGInious".
3. Flask's `/static/<path>` route still works (tested: `/static/images/logo_maintenance.png` and `/static/css/INGInious.css` → 200).

## Alternative / error flows
- **Legacy bug (observed)**: every maintenance request returns **HTTP 500** "Internal Server Error". `maintenance.html` extends `layout.html`, which calls `url_for('indexpage')`, `url_for('courselistpage')`, `url_for('signinpage')`… — endpoints that do not exist in the maintenance map → `werkzeug.routing.BuildError`; the 500 error handler renders `internalerror.html`, which also extends `layout.html` and fails again → bare 500 page. The rewrite must implement the *intended* behaviour (maintenance page for every URL). Recommended status: 503 with `Retry-After` (legacy intent was 200).
- Session handling still runs (a `sessions` document is created/refreshed per request).

## UI elements
- Logo image + alert box text above. Layout chrome must not link to pages that do not exist in maintenance mode.

## Data
- Config: `maintenance` (bool, default `false`).
- No DB reads/writes other than the session interface (DB connection and DB-version check still happen at start-up: the app refuses to start if `db_version` ≠ `DB_VERSION`).

## Permissions & security
- No authentication possible during maintenance (superadmins are locked out too).
- No information disclosure beyond the static page.

## Acceptance tests
- With `maintenance: true`: `GET /`, `GET /courselist`, `GET /course/x/y`, `POST /signin`, `GET /api/v0/courses` → all return the maintenance page (status chosen for the rewrite, never a stack trace), body contains "currently under maintenance".
- Static assets still served (`/static/...` 200).
- No backend job can be submitted while in maintenance mode.
- With `maintenance: false` (default): normal routes are served.
