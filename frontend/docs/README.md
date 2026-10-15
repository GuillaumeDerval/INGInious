# Documentation of the web frontend

Written while the frontend was rebuilt (feature parity with the previous Python frontend,
then the new implementation). Start with [architecture.md](architecture.md) and
[implementation-guide.md](implementation-guide.md).

| Document                                                           | Content                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)                                 | Structure, request pipeline, sessions, backend client, plugins, security model                              |
| [implementation-guide.md](implementation-guide.md)                 | Conventions for contributors                                                                                |
| [ux-design.md](ux-design.md), [design-system.md](design-system.md) | UX principles, visual design system                                                                         |
| [features/](features/INDEX.md)                                     | One use-case document per feature (148), mapped to the tests that cover it                                  |
| [reference/](reference)                                            | Configuration, database schema, backend protocol, course/task model, LTI, i18n, RST rendering, plugin hooks |
| [performance.md](performance.md)                                   | Scale suite, budgets, measurements                                                                          |
| [cli.md](cli.md)                                                   | Command-line tools                                                                                          |
| [screenshots/](screenshots)                                        | Screenshots of the interface                                                                                |

Conventions used in these documents:

- `legacy/…` paths refer to the previous Python frontend as of upstream commit
  [`76ddb145`](https://github.com/INGInious/INGInious/tree/76ddb145da81de3b0bc27b8530fcef2d6e5cd5a8)
  (for example `legacy/inginious/frontend/pages/tasks.py` is `inginious/frontend/pages/tasks.py`
  there). They document what the new code had to stay compatible with.
- `infra/…` paths refer to the development stack used during the rewrite: its services are
  those of [`../e2e/compose.yml`](../e2e/compose.yml) (MongoDB, backend, agents, Mailpit), its
  `infra/tasks` courses are [`../tests/fixtures/sample-courses`](../tests/fixtures/sample-courses).
- Code paths without a prefix (`lib/server/...`, `routes/...`) are relative to `src/`.
- Regenerate the feature index with `node tools/feature-index.mjs`; list missing translations
  with `node tools/i18n-missing.mjs`.
