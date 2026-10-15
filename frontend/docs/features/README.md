# INGInious frontend — feature inventory

This directory enumerates **every feature of the legacy INGInious frontend** (the
`legacy/inginious/frontend` Python package, including its bundled plugins and the
WebDAV server) and describes the use case behind each one. It is the specification
for the SvelteKit rewrite (`app/`): every feature listed here must be re-implemented
(design may change, behaviour and database format may not) and covered by tests.

## Files

* `INDEX.md` — the list of all features with their dependencies (built at the end).
* `<area>/<NN>-<slug>.md` — one file per feature (see template below).
* `../reference/` — cross-cutting reference documents (DB schema, YAML formats,
  backend protocol, configuration, ...).

## Exploration environment

* Legacy frontend: <http://localhost:8080> (superadmin / superadmin).
* Legacy WebDAV: <http://localhost:8081>. Mail catcher (Mailpit): <http://localhost:8025>
  (REST: `curl -s localhost:8025/api/v1/messages`).
* MongoDB: `docker compose -f infra/compose.yml exec -T db mongosh INGInious --quiet --eval '<js>'`.
* Courses/tasks live on disk in `infra/tasks/<courseid>/` (shared with the containers).
* Browser: `node tools/browse/browse.mjs <path> --as user:pass [--shot f.png --full] [--text] [--html f.html] [--script steps.mjs]`
  (a Playwright helper; `--script` modules export `default async (page) => {}`).
  Screenshots can be viewed with the Read tool. Logged-in sessions are cached in
  `tools/browse/.auth/` (delete the file to log in again).
* Legacy source code: `legacy/inginious/frontend/` (pages, templates, static/js, plugins, models).
* Example tasks: `examples/demo-tasks/tutorial` (installed as course `tutorial`).

## Feature file template

```markdown
# <Feature title>

- **ID**: <AREA>-<NN>            (e.g. AUTH-03)
- **Actors**: anonymous | student | tutor | course admin | superadmin | LTI user | API client
- **Routes**: GET/POST /path ... (legacy routes; new app may differ)
- **Depends on**: <other feature IDs>
- **Legacy code**: `legacy/inginious/frontend/...py:Lx-Ly`, templates, JS files

## Use case
Short narrative: who wants to do what and why.

## Preconditions

## Main flow
1. ...

## Alternative / error flows
- ...

## UI elements
Fields, buttons, tables, modals, client-side behaviour (JS), messages shown.

## Data
Exact MongoDB collections/fields read and written (with types), files read/written
on disk, config keys used, messages sent to the backend.

## Permissions & security
Who may do it, the access checks and protections the new app applies (CSRF, HTML
sanitization, input validation, ...).

## Acceptance tests
Bullet list of concrete test scenarios (unit + integration/E2E) that the new
implementation must pass to prove parity.
```
