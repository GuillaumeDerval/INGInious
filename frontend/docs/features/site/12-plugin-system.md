# Plugin system (configuration-driven extensions)

- **ID**: SITE-12
- **Actors**: platform operator (configuration), plugin code
- **Routes**: none by itself; plugins add routes (SITE-13..21, AUTH plugins)
- **Depends on**: — (every feature exposing a hook depends on this one)
- **Legacy code**: `legacy/inginious/frontend/plugins/plugin_manager.py:L1-115`, `plugins/__init__.py`,
  `app.py:L181-187,L225-226`, `webdav.py:L210-215`, `task_problems.py:L20-35`
- **Reference**: `docs/reference/plugin-hooks.md` (complete hook list with kwargs/returns/call sites)

## Use case
The operator enables optional features (scoreboards, contests, external auth, external grader...)
by listing Python modules under `plugins:` in `configuration.yaml`, each with its own options.
Plugins add pages, hook into templates/business events, register auth methods, task dispensers and
problem types.

## Preconditions
Plugin module importable in the frontend's Python environment.

## Main flow
App behaviour (`app/src/lib/server/plugins/index.ts`): plugins are enabled through the same
`plugins:` list; each supported legacy `plugin_module` name maps to a bundled TypeScript
implementation, and unknown modules (third-party Python plugins) are reported and ignored.
Hooks keep the legacy ordering (priority desc, then registration order); a failing
callback is logged and ignored. Plugin routes answer 404 while their plugin is disabled.

Legacy flow (reference):
1. At start-up (non-maintenance mode), after core routes are registered, `plugin_manager.load(...)`
   iterates `config["plugins"]` in order: import module → register its `DisplayableProblem`
   subclasses as problem types → `module.init(plugin_manager, client, entry)`.
2. Plugins call `add_page`, `add_hook`, `add_template_prefix`, `register_auth_method`,
   `register_task_dispenser`.
3. At runtime the core calls `call_hook(name, **kwargs)` / `call_hook_recursive` at fixed points;
   templates call hooks through the global `plugin_manager`.

## Alternative / error flows
- Legacy: import error or exception in `init` → the whole frontend fails to start. App:
  unknown modules are reported and ignored.
- Exception in a hook callback → logged ("An exception occurred while calling a hook!") and ignored.
- `add_page` / `register_auth_method` before load → `NotLoadedException("PluginManager not loaded")`.
- Duplicate template prefix → `Exception("Template prefix already registered")`.
- Maintenance mode: no plugin loaded (plugin pages 404 / maintenance page).

## UI elements
None directly (see hook rendering table in the reference).

## Data
`configuration.yaml` key `plugins: [ {plugin_module: <str>, ...plugin options} ]`. Bundled modules:
`inginious.frontend.plugins.{scoreboard, contests, upcoming_tasks, demo, task_editor_hook_example,
simple_grader, git_repo, ltibestsubmission, taskless-hello-world}` and
`inginious.frontend.plugins.auth.{google_auth, github_auth, facebook_auth, linkedin_auth, ldap_auth, saml2_auth}`.
Reference environment (`infra/legacy-configuration.yaml`) enables scoreboard, contests,
upcoming_tasks, demo, task_editor_hook_example.

## Permissions & security
Only the bundled plugin implementations can be enabled; they run in-process. Plugin pages
implement their own access control (documented in each SITE file).

## Acceptance tests
- Rewrite offers a configuration list of enabled plugins equivalent to `plugins:` with per-plugin options.
- Every hook in the reference document has an equivalent extension point (or a documented decision to drop it),
  with the same ordering semantics (priority desc, then registration order).
- A failing hook does not break the page; a failing plugin init prevents start-up (or is reported).
- Plugin-provided problem types appear in the task editor and render on the task page.
