# Sentry browser error reporting

- **ID**: CORE-06
- **Actors**: every visitor (passive); operator (configures)
- **Routes**: all HTML pages (layout)
- **Depends on**: CORE-01, CORE-09
- **Legacy code**: `legacy/inginious/frontend/app.py:103-105` (copies `sentry_io_url` -> `SENTRY_IO_URL`), `legacy/inginious/frontend/templates/layout.html:62-75`, `legacy/inginious/frontend/static/js/libs/sentry-io-bundle.min.js` (`@sentry/browser 5.4.3`)

## Use case
An operator wants JavaScript errors happening in users' browsers to be reported to a Sentry project,
tagged with the logged-in user, to debug client-side problems (task editor, submission JS...).

## Preconditions
- `sentry_io_url: "<DSN>"` in configuration. Absent/empty -> nothing is loaded.

## Main flow
1. In `<head>` of every page (before the app JS), when `config.SENTRY_IO_URL` is truthy:
   ```html
   <script src="/static/js/libs/sentry-io-bundle.min.js?version=5.4.3" type="text/javascript" charset="utf-8"></script>
   <script>
       Sentry.init({ dsn: "<DSN>" });
       Sentry.configureScope(function(scope) { scope.setUser({"username": "<session.username>", "realname": "<session.realname>"}) });  // only if logged in
   </script>
   ```
   (verified on a scratch container with `sentry_io_url: "https://abc@sentry.example/1"`).
2. The Sentry SDK hooks `window.onerror`/unhandled rejections and sends events directly from the browser to the DSN host.
3. There is **no server-side Sentry** integration (no `sentry_sdk` in Python); Python exceptions are only logged.

## Alternative / error flows
- Sentry host unreachable: SDK fails silently; page unaffected.
- LTI sessions: user scope is set too if `session.loggedin`.

## UI elements
- None visible.

## Data
- Config `sentry_io_url` (string). Legacy sends `session.username` and `session.realname` to the third party; the new app initialises Sentry with the DSN only (no user identity).

## Permissions & security
- The DSN is passed as data to the bundled `@sentry/browser` module (no inline script); no username or realname is sent to Sentry.
- The CSP allows `connect-src https:` so that the browser can reach the configured ingest host.

## Acceptance tests
- Without `sentry_io_url`: no page contains `sentry-io-bundle` nor `Sentry.init`.
- With `sentry_io_url: X`: every HTML page loads the Sentry module and calls `Sentry.init({dsn: "X"})`.
- No user identity (username, realname) is attached to Sentry events.
