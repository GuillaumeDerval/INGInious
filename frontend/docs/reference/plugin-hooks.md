# Legacy plugin system and hook reference

Source: `legacy/inginious/frontend/plugins/plugin_manager.py` (115 lines), call sites listed below.
Written for the SvelteKit rewrite: the new app must offer an equivalent extension mechanism (at
least for the bundled plugins, see `docs/features/site/12-plugin-system.md` and SITE-13..21).

## 1. How plugins are loaded

* Configuration (`configuration.yaml`):

  ```yaml
  plugins:
    - plugin_module: inginious.frontend.plugins.scoreboard      # python module path (required)
    - plugin_module: inginious.frontend.plugins.simple_grader
      courseid: external                                         # any other key = plugin-specific config
      page_pattern: /external
  ```
* `app.py:_put_configuration_defaults` copies `config["plugins"]` (default `[]`) into
  `flask_app.config["PLUGINS"]`.
* `app.py:get_app` (L225-226) calls `plugin_manager.load(client, flask_app, user_manager, submission_manager, config["PLUGINS"])`
  **after** all core routes are registered (`init_flask_mapping`) and **before** `client.start()`.
  In maintenance mode (`maintenance: true`) plugins are **not loaded at all**.
* `PluginManager.load` (L64-79), for each entry, in list order:
  1. `importlib.import_module(entry["plugin_module"])` — an import error aborts application start-up.
  2. `inspect_displayable_problem_types(module_name)` + `register_problem_types(...)`: every
     `DisplayableProblem` subclass defined in the plugin module is registered as a new problem type
     (so plugins can add task problem types).
  3. `module.init(plugin_manager, client, entry)` — `entry` is the full YAML dict of that plugin
     (so `entry["plugin_module"]` and every extra key are available). An exception aborts start-up
     (e.g. `simple_grader` raises if course `external` does not exist).
* The WebDAV server (`webdav.py:get_app` L210-215) also iterates `plugins:` but **only** registers the
  problem types of each module (it never calls `init`).
* `plugin_manager` is a process-wide singleton (`inginious.frontend.plugins.plugin_manager`), also
  exposed to every Jinja template as the global `plugin_manager` (templates call hooks directly).

## 2. PluginManager API offered to plugins

| Method | Behaviour |
|---|---|
| `add_hook(name, callback, prio=0)` | Registers `callback` under `name`. Higher `prio` runs first; same prio = insertion order (`bisect_right`). Every callback is wrapped so that **any exception is logged** (`"An exception occurred while calling a hook! "`, logger `inginious.frontend.plugin_manager`) and the callback returns `None`. |
| `call_hook(name, **kwargs)` | Calls every callback with keyword args only; returns the **list of non-`None` return values** in priority order. Unknown hook name → `[]`. |
| `call_hook_recursive(name, **kwargs)` | Chain: each callback receives the kwargs and must return a dict of (possibly modified) kwargs, which becomes the input of the next; `None` return (or exception) keeps the previous kwargs. Returns the final kwargs dict. |
| `add_page(pattern, view)` | `flask_app.add_url_rule("/" + pattern[1:], view_func=view)` — i.e. the first character of `pattern` is replaced by `/`. Raises `NotLoadedException` before `load()`. Endpoint name = the `as_view(name)` given by the plugin (used by `url_for`). |
| `register_auth_method(auth_method)` | Forwards to `UserManager.register_auth_method` (used by `plugins/auth/*`: google, github, facebook, linkedin, ldap, saml2 — documented in the AUTH area). |
| `add_template_prefix(prefix, folder)` | Adds a `FileSystemLoader(folder)` to the Jinja `PrefixLoader` (2nd loader of the `ChoiceLoader`, the first being the core templates). Templates are then rendered as `render_template("<prefix>/<file>")`. Raises `Exception("Template prefix already registered")` on duplicates. |
| `get_submission_manager()` / `get_user_manager()` | Accessors to the singletons. |

Other extension points used by bundled plugins (not methods of the manager):
* `inginious.frontend.task_dispensers.register_task_dispenser(cls)` — adds a task dispenser (used by `contests`).
* `DisplayableProblem` subclasses in the plugin module (auto-registered, see above).
* `inginious.frontend.environment_types.register_env_type(obj)` — module-level, could be called from `init`.
* Static files: plugins cannot register static folders; `contests` ships its files in the core
  `static/plugins/contests/` folder, `upcoming_tasks` registers a page that serves its `static/` folder.

## 3. Hook catalogue (every `call_hook` / `call_hook_recursive` call site)

Notation: kwargs passed → expected return of each callback → how results are used.

### 3.1 Python call sites

| Hook | Called in | kwargs | Expected return | Use of the result |
|---|---|---|---|---|
| `task_context` | `tasks.py:175` `Task.get_context(language)` | `task`, `default` (translated RST context string) | str (RST) or `None` | **First** non-None value replaces the task context (`ParsableText(vals[0], "rst")`). Affects task page, API `/tasks`, LTI, ltibestsubmission. |
| `course_accessibility` | `courses.py:166` `Course.get_accessibility(plugin_override=True)` | `course`, `default` (`AccessibleTime`) | `AccessibleTime` or `None` | First non-None value overrides course accessibility (ignored when `plugin_override=False`; archived courses always closed). |
| `course_allow_unregister` | `courses.py:256` `Course.allow_unregister(plugin_override=True)` | `course`, `default` (bool) | bool or `None` | First non-None overrides "students may unregister". |
| `new_submission` | `submission_manager.py:465` `add_job`, after building the submission dict and the `@username/@email/@lang/@time/@attempts/@random/@state` input entries, before DB insertion | `submission` (dict about to be inserted: `courseid, taskid, status, submitted_on, username[], user_ip`), `inputdata` (dict sent to the grader) | ignored | Callbacks may **mutate** `submission` / `inputdata` in place (e.g. add `@xxx` inputs). |
| `submission_done` | `submission_manager.py:97` `_job_done_callback`, after the submission document is updated (and user stats updated), before the LTI grade is published | `submission` (the updated mongoengine `Submission`), `archive` (bytes of the tgz returned by the grader, or None), `newsub` (bool: False when it is a replay) | ignored | Notification (used by `git_repo`, which is broken — its callback signature is `add(self, submission, archive, _)` and the hook passes `newsub=` → `TypeError` swallowed). |
| `template_helper` | `app.py:187` Flask `context_processor` (every `render_template`) | none | `(name, value)` tuple | `dict(results)` is merged into every template context. |
| `feedback_title` | `pages/tasks.py:344` (JSON returned when polling/loading a submission on the task page) | `task`, `submission` (Submission), `title` (HTML string, already contains `[Submission #id - <time>]`) | dict with the same keys (`{"task":..,"submission":..,"title":..}`) | **Recursive**: final `["title"]` is sent to the browser (inserted as HTML). |
| `feedback_text` | `pages/tasks.py:347` | `task`, `submission`, `text` (raw feedback text) | dict with same keys | **Recursive**: final `["text"]` used as feedback text. |
| `feedback_script` | `pages/tasks.py:370` | `task`, `submission` | str (JavaScript source) | `"".join(results)` returned as `feedback_script` in the JSON and executed by `task.js` in the browser after the feedback is displayed. |
| `task_editor_tab` | `pages/course_admin/task_edit.py:46` (GET task editor) | `course`, `taskid`, `task_data` (raw dict of task.yaml) | tuple `(tab_id, link_html, content_html)` | Each tuple adds a tab: `<a href="#tab_id">{{link|safe}}</a>` and `<div id="tab_id" class="tab-pane">{{content|safe}}</div>` inside the editor `<form>` (so its inputs are posted with the task). |
| `task_editor_submit` | `pages/course_admin/task_edit.py:117` (POST task editor, after parsing, before `Task(...)` validation/save) | `course`, `taskid`, `task_data` (dict about to be saved; mutable) | `None` = OK, or a **JSON string** `{"status":"error","message":...}` | The first non-None value is returned **as is** as the HTTP response (save aborted). Mutations of `task_data` are persisted in task.yaml. |

### 3.2 Template call sites (return values are inserted in HTML)

| Hook | Template:line | kwargs | Expected return | Rendering |
|---|---|---|---|---|
| `css` | `layout.html:116` | – | URL string | `<link href="{{entry}}" rel='stylesheet'>` in `<head>` of every page. |
| `javascript_header` | `layout.html:119` | – | URL string | `<script src="{{entry}}">` in `<head>`. |
| `header_html` | `layout.html:122` | – | HTML string | `{{ entry \| safe }}` in `<head>`. |
| `javascript_footer` | `layout.html:221` | – | URL string | `<script src>` at the end of `<body>`. |
| `main_menu` | `courselist.html:20`, `mycourses.html:48`, `admin/admin_users.html:7`, `plugins/upcoming_tasks/templates/coming_tasks.html:54` | – | HTML string | `{{ entry }}` **without `|safe`** → since `render_template` returns a plain `str`, the HTML is **escaped and shown as text** (visible bug: the upcoming_tasks link appears as raw `<div class=...>` text in the left column, see `docs/features/site/img/admin-users.png`). |
| `course_menu` | `course.html:12`, `group.html:10` | `course` | HTML string | `{{ entry \| safe }}` in the left column of the course page and group page (scoreboard + contests use it). |
| `task_menu` | `task.html:174` | `course`, `task` | HTML string | `{{ entry \| safe }}` in the task page left column (scoreboard). |
| `task_list_item` | `task_dispensers/task_list.html:47` | `course`, `task`, `tasks_data` | HTML string | `{{ entry \| safe }}` under each task of the course task list (only shown for tasks the user can see, inside the "registered" branch). |
| `course_admin_menu` | `course_admin/menu.html:30` | `course` | tuple `(endpoint, label_html)` | `<a href="{{ url_for(endpoint, courseid=course.get_id()) }}">{{label\|safe}}</a>`; marked `active` when `current == endpoint`. |
| `submission_admin_menu` | `course_admin/submission.html:79` | `course`, `task`, `submission` | HTML string | `{{ entry \| safe }}` in the submission inspection page. |
| `prefs_menu` | `preferences/menu.html:16` | – | tuple `(endpoint, label_html)` | `<a href="{{ url_for(endpoint) }}">{{label\|safe}}</a>` in the preferences menu. |

### 3.3 Hooks used by bundled plugins

| Plugin | Hooks registered |
|---|---|
| scoreboard | `course_menu`, `task_menu` |
| contests | `css`, `javascript_header` ×2, `course_menu` (+ task dispenser `contest`) |
| upcoming_tasks | `main_menu` |
| task_editor_hook_example | `task_editor_tab` ×2, `task_editor_submit` |
| git_repo | `submission_done` (broken signature) |
| demo, simple_grader, ltibestsubmission, taskless-hello-world | none (pages only) |
| auth/* | none (auth methods + pages) |

Hooks never registered by any bundled plugin (still part of the contract): `task_context`,
`course_accessibility`, `course_allow_unregister`, `new_submission`, `template_helper`,
`feedback_title`, `feedback_text`, `feedback_script`, `header_html`, `javascript_footer`,
`task_list_item`, `course_admin_menu`, `submission_admin_menu`, `prefs_menu`.

## 4. Notes for the rewrite

* Plugin code runs in-process with full privileges (DB, filesystem, backend client); hook output
  is injected unescaped (`|safe`) in most places → a plugin is fully trusted code.
* Exceptions inside hooks are swallowed and logged; the page still renders. Keep this
  fault-isolation behaviour.
* Exceptions inside `init` abort start-up.
* Hook order: priority descending, then registration order (= order of `plugins:` entries, then
  order of `add_hook` calls inside `init`).
* `main_menu` escaping is a legacy bug: the rewrite should render the menu entries (but keep in mind
  parity tests will see the escaped text in legacy).
