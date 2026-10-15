# INGInious web frontend

The web interface of INGInious: students solve tasks and read their feedback, teachers
manage courses, tasks, students and grades, administrators manage the platform. It is a
[SvelteKit](https://svelte.dev/docs/kit) application (Svelte 5, Skeleton, Tailwind CSS,
TypeScript) served by Node.js. It talks to the INGInious backend over ZeroMQ, reads the
course and task folders of `tasks_directory` and stores its data in MongoDB with the same
database format as the previous (Python) frontend: it is a drop-in replacement, using the
same `configuration.yaml`.

## Run it

Requirements: Node.js 24, a MongoDB server, an INGInious backend with its agents
(see the root `docker-compose.yml` for the complete stack).

```sh
npm ci
npm run build
# behind a reverse proxy that sets X-Forwarded-Proto and X-Forwarded-Host:
INGINIOUS_CONFIG=/path/to/configuration.yaml PORT=8000 PROTOCOL_HEADER=x-forwarded-proto HOST_HEADER=x-forwarded-host node build
```

- `INGINIOUS_CONFIG`: the configuration file (same format as before; keys added by this
  frontend are documented in [docs/reference/config.md](docs/reference/config.md) §8, e.g.
  `base_url` for the links sent by e-mail, `reverse-proxy-config` behind a proxy).
- Public URL: form submissions are accepted only from the page's own origin, which comes from the
  proxy headers (`PROTOCOL_HEADER`, `HOST_HEADER`); without a proxy, set `APP_ORIGIN` when building
  and running (`APP_ORIGIN=https://inginious.example.org`).
- WebDAV access to the course files is served by the same process under `/dav`.
- Plugins keep their `plugin_module` names (`inginious.frontend.plugins.scoreboard`, ...);
  the bundled plugins are listed in [docs/reference/plugin-hooks.md](docs/reference/plugin-hooks.md).
- Text in course and task files is reStructuredText; a text starting with `#MD` is Markdown.

With Docker: `deploy/Containerfile` (target `frontend`) and the root `docker-compose.yml`.

### Command-line tools

```sh
npm run build:cli
npx inginious-setup        # writes configuration.yaml and creates the superadmin
npx inginious-test-task    # runs the tests of a course's tasks against the backend
npx inginious-autotest     # re-grades recorded submissions and compares the results
```

See [docs/cli.md](docs/cli.md).

## Develop

```sh
npm ci
INGINIOUS_CONFIG=../configuration.yaml npm run dev
```

| Command                          | What it does                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `npm run check`                  | Type check (svelte-check)                                                        |
| `npm run lint`, `npm run format` | ESLint + Prettier check, Prettier write                                          |
| `npm run test:unit`              | Unit and component tests (Vitest, server + Chromium), coverage ≥ 95 %            |
| `npm run test:e2e`               | Integration tests (Playwright on the production build), coverage ≥ 95 %          |
| `npm run test:perf`              | Scale suite on a generated data set ([docs/performance.md](docs/performance.md)) |

The tests need MongoDB, the backend, the grading agents and Mailpit:

```sh
docker compose -f e2e/compose.yml up -d --build
E2E_TASKS_DIR=$PWD/e2e/.tasks npm run test:e2e
```

## Documentation

| Document                                                                               | Content                                                                                       |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)                                           | Structure, request pipeline, sessions, backend client, plugins, security model                |
| [docs/implementation-guide.md](docs/implementation-guide.md)                           | Conventions for contributors (components, server code, tests, comments)                       |
| [docs/ux-design.md](docs/ux-design.md), [docs/design-system.md](docs/design-system.md) | UX principles and the visual design system                                                    |
| [docs/features/](docs/features/INDEX.md)                                               | One use-case document per feature, mapped to its tests                                        |
| [docs/reference/](docs/reference)                                                      | Configuration, database schema, backend protocol, course/task model, LTI, i18n, RST rendering |
| [docs/performance.md](docs/performance.md)                                             | Scale suite, budgets and measurements                                                         |
| [docs/cli.md](docs/cli.md)                                                             | Command-line tools                                                                            |

## Layout

| Path                      | Content                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/routes/`             | Pages and endpoints (SvelteKit file routing)                                                       |
| `src/lib/server/`         | Server code: configuration, database, sessions, backend client, courses, submissions, LTI, plugins |
| `src/lib/components/`     | Reusable Svelte components, each displaying its own data                                           |
| `src/lib/i18n/`           | Translations (10 languages)                                                                        |
| `cli/`                    | Command-line tools                                                                                 |
| `e2e/`, `tests/`, `perf/` | Integration tests, unit-test fixtures, scale suite                                                 |
| `tools/`                  | Maintenance scripts (feature index, missing translations)                                          |
