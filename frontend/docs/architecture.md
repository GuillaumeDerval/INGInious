# INGInious SvelteKit frontend — architecture & conventions

This document is binding for everybody (humans and agents) writing code in `app/`.
Read `objective.md` (project goals) and the relevant `docs/features/**` specs first.

## 1. What is being replaced

The legacy *frontend* is the Python package `legacy/inginious/frontend` (Flask webapp,
Jinja templates, jQuery JS, bundled plugins, WebDAV server). It is replaced by **one
SvelteKit application** (`app/`) that:

* reads/writes the **same MongoDB database with exactly the same document format**
  (collections, field names, BSON types, GridFS usage) — see `docs/reference/db-schema.md`;
* reads/writes the **same course/task files on disk** (`course.yaml`, `task.yaml`, task
  files) in the configured `tasks_directory`;
* talks to the **unchanged Python backend** over ZeroMQ (DEALER socket, msgpack) — see
  `docs/reference/backend-protocol.md`. Nothing in `legacy/inginious/{backend,agent,common,client}`
  changes; the agents keep grading exactly as before;
* reads the **same `configuration.yaml`** keys (see `docs/reference/config.md`) so it is a
  drop-in replacement.

Both frontends can run side by side on the same database (useful for parity testing).

## 2. Stack

| Concern | Choice |
|---|---|
| Framework | SvelteKit 3 (Svelte 5 runes, `adapter-node`), TypeScript strict |
| UI | Skeleton 5 (`@skeletonlabs/skeleton`, `@skeletonlabs/skeleton-svelte`) + Tailwind 4 (+ forms, typography) |
| DB | official `mongodb` driver 7 (+ `GridFSBucket` on bucket `fs`, `bson` for submission input) |
| Backend link | `zeromq` 6 (`Dealer`) + `@msgpack/msgpack` |
| Passwords | `@node-rs/argon2` (legacy `argon2id-<PHC>` format) |
| YAML | `yaml` |
| RST | `rst-compiler` + INGInious plugins, output always sanitized (`sanitize-html`) |
| Validation | `zod` for structured form/API input |
| Mail | `nodemailer` |
| JWT / LTI 1.3 | `jose` |
| Unit/component tests | Vitest 4 (`server` project in node, `client` project in Chromium via `vitest-browser-svelte`) |
| Integration tests | Playwright against the built app + real MongoDB + real backend (Colima stack) |

SvelteKit 3 reminders: no `svelte.config.js` (options go to `sveltekit({...})` in
`vite.config.ts`); import with `#lib/...` (include the `.js` extension for TS modules);
`$app/state` (no stores); `$app/env/private`; `error(status, 'message')`; `redirect()` to an
external URL needs `{ external: true }`; the built-in CSRF origin check is replaced by our own
(§4.4). Docs:
the official documentation of SvelteKit (https://svelte.dev/docs/kit), Svelte (https://svelte.dev/docs/svelte) and Skeleton (https://www.skeleton.dev/docs).

## 3. Source layout (`app/src`)

```
hooks.server.ts            request pipeline: security headers, session, i18n, maintenance
params.ts                  route param matchers (course/task ids, ObjectIds, usernames)
lib/
  server/                  SERVER-ONLY code (SvelteKit refuses to bundle it client-side)
    config.ts              configuration.yaml loading + typed defaults
    db/                    Mongo connection, typed collections, GridFS helpers
    auth/                  password hashing, sessions, user manager, auth methods (OAuth, LDAP, SAML)
    courses/               course/task loading from disk, accessibility, dispensers, problems
    backend/               ZeroMQ client + job manager
    submissions/           submission manager (create, results, user_tasks, tokens, replay)
    lti/                   LTI 1.1 + 1.3
    rst/                   RST → sanitized HTML
    webdav/                WebDAV endpoint
    plugins/               plugin hook registry + bundled plugins
    security/              guards (authz), safe paths, rate limiting, CSV escaping
    mail.ts, i18n.ts, ...
  components/<area>/       reusable Svelte components (see §5)
  i18n/                    translation catalogs + `t()` helper usable on both sides
  utils/                   isomorphic helpers (dates, formatting, grades)
routes/                    pages and endpoints (thin: load data via lib/server, render via components)
```

Routes stay **thin**: a `+page.server.ts` validates input, checks permissions through
the guards (`lib/server/security/guards.ts`, `lib/server/courses/access.ts`), calls domain functions in `lib/server/**`, and returns
plain serialisable data. Domain logic never lives in route files.

## 4. Security rules (non-negotiable)

1. **Authorization is centralized**: every load/action/endpoint that needs a signed-in user
   or a permission calls a guard (`requireUser`, `requireSuperadmin` in `security/guards.ts`;
   `requireCourseAccess`, `requireCourseStaff`, `requireCourseAdmin` in `courses/access.ts`;
   ...) or a shared domain loader that calls one. Tests must cover the forbidden paths.
2. **No raw HTML from data**: `{@html}` is only allowed inside `components/common/RichText.svelte`,
   which only accepts the branded `SafeHtml` type produced by the sanitizer.
3. **Paths**: every filesystem access built from user input goes through
   `security/paths.ts` (`safeJoin`) — no `..`, no absolute paths, no symlink escape.
4. **CSRF**: `isCrossSiteForbidden` (lib/server/request.ts) refuses every mutating form
   request whose `Origin` is missing or foreign — same rule as SvelteKit's built-in check,
   which is disabled (`csrf.trustedOrigins: ['*']`) because it cannot exempt the endpoints
   that legitimately receive signed cross-site POSTs (LTI launches, SAML callback,
   simple_grader, WebDAV with Basic auth). Session cookie: `HttpOnly` and `SameSite=Lax` by
   default (`session_parameters`), `Secure` when configured, HMAC-SHA256-signed ObjectId
   verified in constant time, id rotated at login.
5. **Passwords**: argon2id; constant-time comparisons for tokens; login rate limiting.
6. **Input validation**: structured form/API inputs are parsed with zod schemas, single
   fields are coerced to strings; Mongo queries are never built from raw objects coming
   from the client (no operator injection), and user text used in `$regex` is escaped.
7. **Exports**: CSV cells escaped against formula injection; archive entry names sanitized.
8. **Headers**: CSP on pages rendered by SvelteKit (`csp` option in vite.config.ts:
   `script-src 'self'` plus SvelteKit's nonces, so components never use inline scripts);
   on every response `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
   `Cross-Origin-Opener-Policy`, `X-Frame-Options: DENY` (except LTI pages, which must be
   frameable) and, over HTTPS, `Strict-Transport-Security`.
9. Secrets never reach the client (no config object is serialized wholesale).

## 5. UI components

Every piece of UI is a reusable Svelte component **responsible for displaying its own
data**: it receives domain data through typed props and renders it completely
(formatting, empty states, badges, i18n). Pages only compose components.
* One component per file, `PascalCase.svelte`, under `lib/components/<area>/`.
* Props typed with an exported `Props` interface; documented with a `<!-- @component -->`
  block (purpose, props, events/snippets, example).
* Prefer Skeleton components/classes (`btn`, `card`, `input`, `table`, `badge`, presets)
  over custom CSS. No Bootstrap. Legacy task content (RST with Bootstrap classes such as
  `row`, `col-*`, `alert-*`) is styled by a small compatibility stylesheet scoped to
  `RichText`.
* Accessible by default: labels for inputs, keyboard navigation, `aria-*` where needed.

## 6. Comments

The code must be fully commented:
* every file starts with a header comment explaining its role;
* every exported function/type/constant and every component prop has a doc comment;
* non-obvious logic (legacy compatibility quirks, security checks, DB format constraints)
  is explained inline, referencing the feature ID (e.g. `// TASK-04: ...`).

## 7. Tests

* Unit tests: `*.test.ts` next to the module (server project, Node). DB-dependent units
  use a throw-away database on the Colima MongoDB (`INGInious_unit_<worker>`).
* Component tests: `*.svelte.test.ts` next to the component (client project, Chromium).
* Integration tests: `app/e2e/<area>/*.e2e.ts` (Playwright) against the built app,
  using dedicated test courses in `infra/tasks/test_*` and a dedicated database.
* Coverage goal: **≥ 95 %** (lines, branches, functions, statements) for unit+component
  tests, and ≥ 95 % for the integration suite (server V8 coverage + browser coverage).
* Every feature ID from `docs/features` has at least one integration test whose title
  starts with the ID (e.g. `test('TASK-04 student submits a code task', ...)`).

## 8. Size budget

Legacy frontend: 18,821 lines of code / 578,550 non-whitespace code characters (cloc,
comments/blanks excluded). Target: −40 %. The rewrite is always formatted with prettier
(printWidth 120, `npx prettier --check .` must pass) and measured with `tools/metrics.sh`,
which reports both cloc code lines and non-whitespace characters (formatting-independent).
Never join statements to save lines; favour mature libraries, shared helpers and small
components over duplication.
