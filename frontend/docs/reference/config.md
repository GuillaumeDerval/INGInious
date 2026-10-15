# Legacy frontend configuration reference (`configuration.yaml`)

Every configuration key read by the legacy webapp (`inginious-webapp`), the WebDAV server
(`inginious-webdav`) and the bundled plugins. Paths are relative to `legacy/inginious/`.
The SvelteKit rewrite must accept the same file (same keys, same defaults, same semantics),
so an existing `configuration.yaml` keeps working unchanged.

Sources inspected: `frontend/app.py` (`_put_configuration_defaults`, `get_app`),
`frontend/arch_helper.py`, `scripts/webapp.py`, `scripts/webdav.py`, `frontend/webdav.py`,
every `current_app.config[...]`/`config.X` use in `frontend/**/*.py` and `frontend/templates/**`,
every plugin `init()`, `frontend/installer.py` (what `inginious-install` writes),
`../configuration.example.yaml`, `../configuration.deploy.yaml`, `../../infra/legacy-configuration.yaml`,
`../doc/admin_doc/install_doc/config_reference.rst`.

## 1. How the file is loaded and how the app is launched

| Entry point | What it does |
|---|---|
| `inginious-webapp` (console script, `pyproject.toml:93` -> `scripts/webapp.py:main`) | argparse: `--config` (default env `INGINIOUS_WEBAPP_CONFIG`, else `./configuration.yaml`, else `./configuration.json`), `--host` (default env `INGINIOUS_WEBAPP_HOST`, else `localhost`), `--port` (default env `INGINIOUS_WEBAPP_PORT`, else `8080`) (`scripts/webapp.py:60-86`). Loads the YAML/JSON (`load_json_or_yaml`), calls `init_logging(log_level)`, builds the app, wraps it in `SharedDataMiddleware('/static/' -> frontend/static)`, optionally `ProxyFix`, then serves with werkzeug `run_simple(host, port, app, use_debugger=web_debug, threaded=True)`. |
| WSGI import (`scripts/webapp.py:91-92`) | When the module is *imported* (not `__main__`), it builds `application` immediately from `os.environ.get("INGINIOUS_WEBAPP_CONFIG")` (falls back to `./configuration.yaml|json` in CWD, else `Exception("No configuration file found")`). **`reverse-proxy-config` and `web_debug`'s `use_debugger` are only applied in `main()`, i.e. ignored under gunicorn/mod_wsgi.** The `/static/` SharedDataMiddleware *is* applied in both modes (inside `get_app`). SIGINT/SIGTERM handlers close the backend client (`scripts/webapp.py:51-56`). |
| Container (`legacy/deploy/Containerfile:37-50`, used by `infra/compose.yml` service `frontend`) | `pip install gunicorn==26.0.0`; `CMD python3.14 -m gunicorn.app.wsgiapp 'inginious.scripts.webapp:application' --bind 0.0.0.0` -> gunicorn defaults: port **8000**, **1 sync worker**, 30 s worker timeout. Working dir `/inginious`, config mounted at `/inginious/configuration.yaml`. Env `INGINIOUS_WEBAPP_HOST=0.0.0.0` is set by compose but unused by gunicorn. Verified: responses carry `Server: gunicorn`. |
| `inginious-webdav` (`scripts/webdav.py`) | Same config file (env `INGINIOUS_WEBAPP_CONFIG`!), `--host` env `INGINIOUS_WEBDAV_HOST` (default `localhost`), `--port` env `INGINIOUS_WEBDAV_PORT` (default `8080`). Container: gunicorn `inginious.scripts.webdav:application --workers 1` (`Containerfile:92-105`). |
| `deploy/Caddyfile` | Production compose: Caddy reverse proxy `frontend:8000`, `/dav/*` -> `webdav:8000`, strips `Server` header. |

Environment variables read by the frontend code:

| Variable | Read in | Meaning |
|---|---|---|
| `INGINIOUS_WEBAPP_CONFIG` | `scripts/webapp.py:64,92`, `scripts/webdav.py:57,76` | Path of the configuration file (webapp **and** webdav). |
| `INGINIOUS_WEBAPP_HOST` / `INGINIOUS_WEBAPP_PORT` | `scripts/webapp.py:65-66` | Bind address for `inginious-webapp` (werkzeug server only). |
| `INGINIOUS_WEBDAV_HOST` / `INGINIOUS_WEBDAV_PORT` | `scripts/webdav.py:58-59` | Bind address for `inginious-webdav`. |
| `OAUTHLIB_INSECURE_TRANSPORT` | *written* (`=1`) by OAuth auth plugins when their `debug: true` (`plugins/auth/*_auth.py`) | Allows OAuth over plain HTTP. |
| `REGISTRY`, `VERSION` | `scripts/container_update.py:42-43` | Not frontend (container image pulls). |

Process-level side effects of loading: `connect()` to MongoDB with `tz_aware=True` (`app.py:132`);
DB version check: `db_version` collection must contain `{db_version: 20}` (`DB_VERSION`, `inginious/__init__.py:19`),
otherwise the app refuses to start with `Exception("Please update the database before running INGInious")`
(`app.py:135-137`; a missing doc is created with the current version).

The raw YAML dict is converted into an **upper-cased Flask config** (`app.py:57-117`); templates read
it as `config.KEY` and code as `current_app.config["KEY"]`. Only the keys listed below are copied:
any other top-level key is ignored by the webapp (but may be read by plugins through their own entry,
or by `inginious-webdav`).

YAML pitfall (verified on a scratch container): an unquoted all-digit `secret_key` (e.g. `000...0`)
is parsed as the integer `0`, which is falsy -> `MongoDBSessionInterface._get_signer` returns `None`
and every request crashes with `AttributeError: 'NoneType' object has no attribute 'sign'` (500 with
no cookie). Quote secrets.

## 2. Top-level keys

Legend: **Flask key** = name in `flask_app.config`. "Default" is the value used when the key is absent.

| Key | Type | Default | Flask key | Meaning | Used at |
|---|---|---|---|---|---|
| `allow_deletion` | bool | `true` | `ALLOW_DELETION` | Users may delete their own account (`/preferences/delete`); hides the menu entry and returns 403 when false. | `app.py:61`; `pages/preferences/delete.py:32,39`; `templates/preferences/menu.html:11` |
| `allow_registration` | bool | `true` | `ALLOW_REGISTRATION` | Enables local (password) accounts: `/register` page (403 "You're not allow to register." when false), "Register" sidebar link, "Lost password?"/register links on the sign-in form, password fields in the profile page. | `app.py:62`; `pages/register.py:31,189`; `pages/preferences/profile.py:49,53,57`; `templates/layout.html:183`; `templates/auth.html:18,38`; `templates/preferences/profile.html:89` |
| `backend` | string | `"local"` | `BACKEND` | `"local"`: start an in-process backend + docker agent + MCQ agent (see `local-config`). Otherwise a ZeroMQ address of a remote backend's *client* socket: `tcp://host:port`, `udp://...`, `ipc:///path`. Infra uses `tcp://backend:2000`. | `app.py:63`; `arch_helper.py:66-104` |
| `local-config` | dict | `{}` | `LOCAL-CONFIG` | Only used when `backend: local` (see §3). | `app.py:66`; `arch_helper.py:70-75` |
| `web_debug` | bool | `false` | `DEBUG` | Flask debug mode (`flask_app.debug`), `oauthlib.set_debug`, and werkzeug interactive debugger in `inginious-webapp` main only. The example file's claim that an e-mail address can be given is **not implemented** (any truthy value = debug). Also used by webdav `run_simple`. | `app.py:64,206-207`; `scripts/webapp.py:86`; `scripts/webdav.py:70` |
| `debug_asyncio` | bool | `false` | `DEBUG_ASYNCIO` | `loop.set_debug(True)` on the ZMQ asyncio loop. | `app.py:65,146`; `arch_helper.py:21-22`; `scripts/autotest.py:49` |
| `lti_config` | dict issuer -> list of client configs | `{}` | `LTI_CONFIG` | Global LTI 1.3 platform registrations, merged with each course's `lti_config` (pylti1p3 `ToolConfDict` format; each client needs `default, client_id, auth_login_url, auth_token_url, key_set_url\|key_set, private_key, public_key, deployment_ids`, validated at `pages/course_admin/settings.py:100-125`). Shown read-only in course settings. | `app.py:67,170`; `lti/v1_3/__init__.py:24-38`; `pages/lti/v1_3/__init__.py:62-73,94,114,255`; `templates/course_admin/settings.html:397` |
| `maintenance` | bool | `false` | `MAINTENANCE` | Replace every route by the maintenance page (see CORE-03). | `app.py:68,219-221` |
| `max_file_size` | int (bytes) | `1048576` (1 MiB) | `MAX_FILE_SIZE` | Max size of each uploaded file in a submission (file problems); checked server side in `input_is_consistent` and client side in `tasks/file.html`. A per-problem `max_size` overrides it in the template. | `app.py:69`; `pages/tasks.py:200-201`; `pages/api/submissions.py:205-206`; `plugins/simple_grader/__init__.py:89-90`; `templates/tasks/file.html:10` |
| `allowed_file_extensions` | list[str] | `[".c", ".cpp", ".java", ".oz", ".zip", ".tar.gz", ".tar.bz2", ".txt"]` | `ALLOWED_FILE_EXTENSIONS` | Default allowed extensions for file problems (per-problem `allowed_exts` overrides). | `app.py:59-60`; `pages/tasks.py:200`; `pages/api/submissions.py:205`; `plugins/simple_grader/__init__.py:89`; `templates/tasks/file.html:9` |
| `mongo_opt` | dict | `{}` | `MONGO_OPT` | `host` (default `"localhost"`, may be a full `mongodb://user:pw@host/db` URI) and `database` (default `"INGInious"`). | `app.py:70,132`; `scripts/database_update.py:43-44` |
| `plugins` | list of dicts | `[]` | `PLUGINS` | Each entry needs `plugin_module` (Python module path); the whole dict is passed to the module's `init(plugin_manager, client, entry)` (see §5). Loaded in order after routes are registered; not loaded in maintenance mode. Webdav only uses it to register plugin problem types. | `app.py:71,226`; `plugins/plugin_manager.py:64-79`; `webdav.py:210-215` |
| `static_directory` | path | `"./static"` (relative to CWD, **not** the frontend `static/` assets folder) | `STATIC_DIRECTORY` | Folder of YAML "static pages" served at `/pages/<pageid>` (`<id>.yaml` or `<id>.<lang>.yaml`, keys `title`, `content` (RST)). | `app.py:72`; `pages/utils.py:215-242` |
| `superadmins` | list[str] | `[]` | `SUPERADMINS` | Usernames with admin rights on every course + `/administrator/*` + marketplace. | `app.py:73,165`; `webdav.py:222` |
| `tasks_directory` | path | `"./tasks"` | `TASKS_DIRECTORY` | Root of `<courseid>/course.yaml` and `<courseid>/<taskid>/task.yaml`. Used only if `fs` is absent. **Required** by webdav (`RuntimeError` otherwise). | `app.py:74,155-156`; `webdav.py:218-221` |
| `fs` | dict | absent | `FS` | Alternative filesystem provider: `{module: "local", location: "/path"}` (only `local` ships; args from `get_needed_args`). Overrides `tasks_directory` in the webapp, ignored by webdav. | `app.py:103-105,152-153`; `common/entrypoints.py:23-48`; `common/filesystems/local.py:17-29` |
| `use_minified_js` | bool | `false` | `USE_MINIFIED_JS` | Load the single concatenated `js/all-minified.js` (or `all-minified-rtl.js`) instead of ~25 separate scripts (CORE-09). | `app.py:75`; `templates/layout.html:77-110` |
| `session_parameters` | dict | **required** (needs `secret_key`) | see §4 | Session cookie settings. Missing dict or missing `secret_key` -> prints a sample block with a random key on stderr and `exit(1)`. | `app.py:44-55,78-86` |
| `smtp` | dict | absent | `MAIL_*` | Outgoing mail (see §4). When absent, Flask-Mail defaults apply (`localhost:25`, no sender): sending fails with `[Errno 111] Connection refused` (observed live). | `app.py:89-100`; `flask/mail.py`; `pages/register.py:109,152` |
| `privacy_page` | string (static page id) | absent | `PRIVACY_PAGE` | Footer link "Privacy Policy" -> `/pages/<id>`; with `terms_page`, enables ToS acceptance (`IS_TOS_DEFINED`). | `app.py:103-105,115`; `templates/layout.html:212-213`; `templates/register.html:46-48`; `templates/preferences/profile.html:103-106` |
| `terms_page` | string | absent | `TERMS_PAGE` | ToS page id. `IS_TOS_DEFINED = PRIVACY_PAGE and TERMS_PAGE both present` (`app.py:115`): registration requires checkbox `term_policy_check` ("Please accept the Terms of Service and Data Privacy"), and any logged-in user whose `users.tos_accepted` is not true is redirected to `/preferences/profile` on every authenticated GET (`pages/utils.py:97-99`; verified: superadmin gets 302 -> `/preferences/profile`). | same as above; `pages/register.py:81`; `pages/preferences/profile.py:122` |
| `welcome_page` | string | absent | `WELCOME_PAGE` | `/` and `/index` render this static page instead of redirecting to `/courselist` (`pages/index.py:16-18`). If the YAML file is missing, `/` returns **404** "File doesn't exist." (verified). | `app.py:103-105`; `pages/index.py:16-17` |
| `sentry_io_url` | string (DSN) | absent | `SENTRY_IO_URL` | Loads the Sentry browser SDK in every page (CORE-06). | `app.py:103-105`; `templates/layout.html:62-75` |
| `webterm` | string (URL) | absent | `WEBTERM` | URL of an INGInious-xterm app; adds an iframe to the SSH-debug box (CORE-07). | `app.py:103-105`; `templates/task.html:309-311`; `static/js/task.js:483-494` |
| `webdav_host` | string (URL) | absent (webapp) / `"localhost/"` (webdav) | `WEBDAV_HOST` | Webapp: shows a "WebDAV access" box with URL `<webdav_host>/<courseid>` on the course task-list admin page. Webdav server: the URL path part becomes the DAV root (`https://x/dav` -> mounted at `/dav`). | `app.py:103-105`; `templates/course_admin/task_list.html:64-77`; `webdav.py:225-232` |
| `log_level` | string (`DEBUG`/`INFO`/`WARN`/...) or int | `"INFO"` | — | `init_logging` level for the `inginious` and `oauthlib` loggers (stderr, format `%(asctime)s - %(name)s - %(levelname)s - %(message)s`). | `scripts/webapp.py:40`; `scripts/webdav.py:46`; `common/log.py:9-29` |
| `reverse-proxy-config` | dict | `{}` | — | `enable` (bool, default false), `x-for` (int, default 1), `x-host` (int, default 1) -> `werkzeug ProxyFix(x_for, x_host)`. **Only in `inginious-webapp` main()** (not under gunicorn). Note the key spelling mismatch: the example file and docs use `x_for`/`x_host` but the code reads `x-for`/`x-host`, so the documented keys are silently ignored (defaults 1 apply). | `scripts/webapp.py:77-83`; `configuration.example.yaml:63-66` |
| `database` | string | `"INGInious"` | — | **Webdav only, and a bug**: webdav connects to `config['database']` (top-level), not `mongo_opt.database` (`webdav.py:205`). Host is taken from `mongo_opt.host`. | `webdav.py:205` |
| `backup_directory` | path | — | — | Present in `configuration.deploy.yaml` and `infra/legacy-configuration.yaml` but **not read anywhere** in the current code (legacy of old course backup feature). | — |
| `agents`, `containers`, `machines`, `docker_daemons` | — | — | — | Obsolete; only a warning "Option %s in configuration.yaml is not used anymore" is logged. | `arch_helper.py:106-111` |

Keys that do **not** exist despite being sometimes assumed: `session_parameters.ignore_change_ip`,
`allowed_hosts`, `cdn`, `mathjax` (MathJax URL is hard-coded, CORE-09).

Derived Flask keys (not configurable): `INDENTATION_TYPES` (`"2"`, `"3"`, `"4"`, `"tabs"` ->
`{text, indent, indentWithTabs}`, `app.py:108-113`), `LANGUAGES` (`i18n/__init__.py:17-30`: en, de, el, es,
fr, he, nl, nb_NO, pt, vi), `IS_TOS_DEFINED` (`app.py:115`), `SESSION_USE_SIGNER = True` (`app.py:80`).

## 3. `local-config` (only with `backend: local`)

| Key | Type | Default | Meaning | Used at |
|---|---|---|---|---|
| `concurrency` | int | `multiprocessing.cpu_count()` | Parallel grading containers of the local docker agent. | `arch_helper.py:71,96` |
| `debug_host` | string | `None` (agent guesses) | Host shown to users for SSH debug. | `arch_helper.py:72` |
| `debug_ports` | string `"begin-end"` | `range(64100, 64111)` (i.e. 64100-64110; docs claim 64100-64200) | Port range for SSH debug containers; malformed -> log error + `exit(1)`. Note `range(begin, end)` excludes `end`. | `arch_helper.py:73,77-85` |
| `debugger` | bool | `false` | PyCharm remote debugging inside grading containers (port 5678; also forces network and 30-min limits). | `arch_helper.py:74`; `agent/docker_agent/__init__.py:97-98,356-358` |
| `tmp_dir` | path | `"./agent_tmp"` | Agent working dir, must be visible to the docker daemon at the same absolute path. | `arch_helper.py:75` |

`inginious-install` writes `backend`, `local-config.{concurrency,debug_host,debug_ports}`,
`mongo_opt.{host,database}`, `tasks_directory`, `webterm`, `use_minified_js`, `superadmins`, `plugins`
(optionally an LDAP entry with `prefix` and `require_cert`, two keys the LDAP plugin never reads),
`session_parameters.{timeout,secure,secret_key}` (`frontend/installer.py:134-265,363,384,509-590`).

## 4. `session_parameters` and `smtp`

`session_parameters` (`app.py:78-86`, consumed by `flask/mongo_sessions.py`, see CORE-04):

| Key | Type | Default | Flask key | Effective? |
|---|---|---|---|---|
| `secret_key` | string | **required** | `SECRET_KEY` | Yes: HMAC key of the cookie signature. |
| `timeout` | int seconds | `86400` | `PERMANENT_SESSION_LIFETIME` | Yes: sliding expiry (cookie `Expires` and `sessions.expiration` = now + timeout on every request). |
| `cookie_name` | string | `"inginious_session_id"` | `SESSION_COOKIE_NAME` | Yes (verified with `core_test_cookie`). |
| `cookie_domain` | string | `None` | `SESSION_COOKIE_DOMAIN` | Yes. |
| `cookie_path` | string | `None` (-> `/`) | `SESSION_COOKIE_PATH` | Yes. |
| `httponly` | bool | `true` | `SESSION_COOKIE_HTTPONLY` | Yes (verified: `httponly: false` removes the flag). |
| `secure` | bool | `false` | `SESSION_COOKIE_SECURE` | Yes (verified `Secure` flag). The rewrite defaults to `true` on https deployments (§8). |
| `samesite` | string | `"Lax"` | `SESSION_COOKIE_SAMESITE` | Yes in the new app: the configured value (`Lax`, `Strict` or `None`) is emitted on the session cookie, `SameSite=Lax` by default. |

`smtp` (`app.py:89-100`, Flask-Mail, see CORE-05):

| Key | Type | Default | Flask key |
|---|---|---|---|
| `host` | string | **required if `smtp` present** (KeyError otherwise) | `MAIL_SERVER` |
| `port` | int/str | **required** (cast with `int()`) | `MAIL_PORT` |
| `starttls` | bool | `false` | `MAIL_USE_TLS` |
| `usessl` | bool | `false` | `MAIL_USE_SSL` |
| `username` | string | `None` | `MAIL_USERNAME` |
| `password` | string | `None` | `MAIL_PASSWORD` |
| `sendername` | string (`"Name <addr>"`) | `"no-reply@ingnious.org"` (sic, typo "ingnious") | `MAIL_DEFAULT_SENDER` |

## 5. Plugin entries (`plugins: - plugin_module: ...`)

The full entry dict is passed to `init(plugin_manager, client, conf)`. Keys besides `plugin_module`:

| Plugin module | Keys (type, default) | Routes / hooks added | Code |
|---|---|---|---|
| `inginious.frontend.plugins.auth.ldap_auth` | `id` (str, **required**, no default), `name` (`"LDAP"`), `imlink` (img URL, `""` -> FontAwesome address-book icon), `host` (required), `port` (int, `0`/absent -> `None` = default port), `encryption` (`"none"`\|`"ssl"`\|`"tls"`, default `"none"`; other -> exception at start; only `ssl` is actually used, `tls` is accepted but ignored), `base_dn` (required), `request` (required, `{}` replaced by escaped login), `bind_dn` (format string, optional), `auto_bind` (default `True`), `cn` (attr, `"cn"`), `mail` (attr, `"mail"`). Installer-written `prefix`, `require_cert` are unused. | `GET/POST /auth/page/<id>` (template `ldap_auth/custom_auth_form.html`) | `plugins/auth/ldap_auth.py:59-170` |
| `...auth.saml2_auth` | `id` (required), `name` (`"SAML"`), `imlink` (`""` -> id-card icon), plus python3-saml settings: `strict`, `debug`, `sp{entityId,x509cert,privateKey,...}`, `idp{entityId,singleSignOnService{url,binding},x509cert,additionalX509certs[]}`, `security{...}`, `attributes{uid,cn,email}` (attribute names; required for login), `additional{field: urn}` (extra attributes stored in binding). ACS URL forced to `<url_root>auth/callback/<id>`. | `GET /auth/<id>/metadata` (SP metadata XML) | `plugins/auth/saml2_auth.py:30-170` |
| `...auth.google_auth` | `id`, `name` (`"Google"`), `client_id` (`""`), `client_secret` (`""`), `domain` (`""`, hosted-domain restriction), `debug` (false; true sets `OAUTHLIB_INSECURE_TRANSPORT=1`) | via `/auth/signin/<id>`, `/auth/callback/<id>` | `plugins/auth/google_auth.py:70-79` |
| `...auth.github_auth` | `id`, `name` (`"Github"`), `client_id`, `client_secret`, `debug` | same | `plugins/auth/github_auth.py:61-69` |
| `...auth.facebook_auth` | `id`, `name` (`"Facebook"`), `client_id`, `client_secret`, `debug` | same | `plugins/auth/facebook_auth.py:62-70` |
| `...auth.linkedin_auth` | `id`, `name` (`"LinkedIn"`), `client_id`, `client_secret`, `debug` | same | `plugins/auth/linkedin_auth.py:65-73` |
| `...plugins.contests` | none | `/contest/<courseid>`; hooks `css`, `javascript_header` (static `/static/plugins/contests/*`), `course_menu`; task dispenser `contest`; contest settings stored in course.yaml | `plugins/contests/__init__.py:240-257` |
| `...plugins.scoreboard` | none in configuration.yaml; course.yaml key `scoreboard: [{content: str\|list\|{taskid: weight}, name, reverse}]` | `/scoreboard/<courseid>`, `/scoreboard/<courseid>/<scoreboardid>`; hooks `course_menu`, `task_menu` | `plugins/scoreboard/__init__.py:205-226` |
| `...plugins.upcoming_tasks` | none | `/coming_tasks`, `/plugins/coming_tasks/static/<path>`; hook `main_menu` | `plugins/upcoming_tasks/__init__.py:122-127` |
| `...plugins.git_repo` | `repo_directory` (path, `"./repo_submissions"`, must be an initialised git repo) | hook `submission_done` (background thread commits each submission) | `plugins/git_repo/__init__.py:31-110` |
| `...plugins.simple_grader` | `courseid` (`"external"`, must exist at startup), `page_pattern` (`"/external"`), `return_fields` (regex, `"^(result\|text\|problems)$"`) | GET/POST `<page_pattern>` (anonymous grading, no DB storage) | `plugins/simple_grader/__init__.py:18-130` |
| `...plugins.ltibestsubmission` | none | `/lti/bestsubmission`, `/lti1.3/bestsubmission` | `plugins/ltibestsubmission/__init__.py:82-85` |
| `...plugins.demo` | none | `/plugindemo` ("This is a simple demo plugin") | `plugins/demo/__init__.py:18-20` |
| `...plugins.task_editor_hook_example` | none | task-editor tab example | `plugins/task_editor_hook_example/__init__.py:34` |
| `plugins/taskless-hello-world` | not importable as a module path (dash in name); example only | — | — |

Note: `configuration.example.yaml:41` refers to `inginious.frontend.plugins.auth.demo_auth`, which no longer
exists in the tree (importing it would crash startup).

## 6. Example files (as shipped)

* `legacy/configuration.example.yaml`: `backend: local`, `log_level: INFO`, `web_debug: false`, `local-config{debug_ports: 64000-64100, debugger: true}`, `mongo_opt{host: localhost, database: INGInious}`, `tasks_directory: ./inginious/tasks`, `use_minified_js: true`, `webterm: "https://my-host.be:8080"`, `plugins: [demo_auth (missing)]`, `superadmins: [test]`, `maintenance: false`, `smtp{...gmail, starttls: True}`, `reverse-proxy-config{enable: false, x_for: 1, x_host: 1}`. **No `session_parameters` -> the example as-is refuses to start.**
* `legacy/configuration.deploy.yaml`: `backend: tcp://backend:2000`, `backup_directory`, `mongo_opt{database: INGInious, host: db}`, `plugins: []`, `session_parameters{secret_key, secure: false, timeout: 86400}`, `superadmins: [superadmin]`, `tasks_directory: /inginious/tasks`, `use_minified_js: true`, `webdav_host: https://localhost/dav`.
* `infra/legacy-configuration.yaml` (reference environment): as deploy + `log_level: INFO`, `allow_registration: true`, `allow_deletion: true`, `maintenance: false`, `webdav_host: http://localhost:8081`, `smtp{sendername: 'INGInious <no-reply@inginious.local>', host: mailpit, port: 1025, starttls: false}`, plugins `scoreboard`, `contests`, `upcoming_tasks`, `demo`, `task_editor_hook_example`.
  Caveat observed on 2026-10-14: the running `frontend` container was started (05:22 UTC) *before* the `smtp` block was added to this file (05:25 UTC); since the config is read once at startup, mail sending from the shared legacy instance currently fails with `Connection refused` (Flask-Mail default `localhost:25`). A scratch container started with the same `smtp` block delivered mail to Mailpit correctly.

## 7. Requirements for the rewrite

* Read the same YAML (and JSON) file; honour `INGINIOUS_WEBAPP_CONFIG`; same defaults as above.
* Refuse to start without `session_parameters.secret_key` (same stderr hint) and when `db_version != 20`.
* Decide (and document) whether to fix the known quirks: `x-for` vs `x_for`, webdav `database`, `reverse-proxy-config` ignored under WSGI servers. Fixing must not break existing files: accept both spellings.
* Unknown keys must be ignored (not an error).

## 8. Keys added or changed by the rewrite

| Key | Type | Default | Meaning |
|---|---|---|---|
| `base_url` | string | — | Public URL of the application (e.g. `https://inginious.example.org`), used to build the links sent by e-mail (activation, password reset) and the OAuth/SAML callback URLs. When absent, the deployment origin is used (`APP_ORIGIN` environment variable — also baked as SvelteKit `paths.origin` when the app is built with it — or `ORIGIN`; adapter-node 6 itself no longer reads `ORIGIN`: behind a proxy the request origin comes from `PROTOCOL_HEADER`/`HOST_HEADER`); the request origin is only used for `localhost`/`127.0.0.1`/`[::1]` development hosts. Otherwise the action is refused with a generic message and the error `Cannot build links for e-mails: set base_url ...` is logged: the `Host` header is never trusted. |
| `reverse-proxy-config` | dict | `{}` | Now applied by the rewrite (all deployment modes). `enable: true` makes the app trust `X-Forwarded-Proto`/`X-Forwarded-Host` (LTI signature URLs) and `X-Forwarded-For` for the client IP used by the rate limits: the address `x-for` hops from the right (default 1 = the address added by the proxy). Both spellings `x-for` and `x_for` are accepted. Leave it disabled when the app is reachable without the proxy, otherwise clients can choose their IP. |
| `password_min_length` | int | `10` | Minimum length of every new password: registration, password reset, profile password change and accounts created by a superadmin (legacy: 6). Existing passwords keep working. Every password (also at sign-in) is limited to 1024 characters, refused before hashing. |
| `session_parameters.max_lifetime` | int (seconds) | `604800` (7 days) | Absolute lifetime of a session, counted from the sign-in (the session id is renewed at sign-in and on password change), whatever the activity; the sliding `timeout` still applies within it. `0` disables the limit. Stored sessions are not changed: the creation time is the timestamp of the session ObjectId. |
| `session_parameters.secure` | bool | `true` when the public URL (`base_url`, else `ORIGIN`/`APP_ORIGIN`) is https, else decided per request | Changed default (legacy: always `false`): without an explicit value the session cookie gets the `Secure` flag on https deployments, and otherwise on every request that came over https (behind a proxy: `PROTOCOL_HEADER`). An explicit `secure: false` (or `true`) is kept as is. |
| `webdav_allow_http` | bool | `false` | WebDAV sends the API key in clear text (Basic auth): requests over plain http are refused with 403 ("WebDAV requires HTTPS...") unless they target `localhost`/`127.0.0.1`/`[::1]` (development) or this key is `true`. The scheme seen by the client counts (`X-Forwarded-Proto` when `reverse-proxy-config.enable`). |
| `lti_allow_private_urls` | bool | `false` | Requests made to LTI platforms (LTI 1.1 outcome service, LTI 1.3 key set, access token and score URLs) must use https and resolve to public addresses, with a 10 s timeout and no redirects. `true` also allows http and loopback/private addresses (development and tests with local platforms). |
| `lti_frame_ancestors` | list of origins | `[]` | Extra origins allowed to frame the LTI pages (`frame-ancestors` of the CSP), on top of the configured LTI 1.3 platforms and the LTI 1.1 consumer of the session. Needed when an LMS serves its pages from other hosts than its configured URLs, e.g. `https://*.instructure.com` for Canvas. |

Rate limits (in memory, per process, 15-minute windows): 20 failed authentications per account and 100 per
client IP, for local sign-in, the REST API login, form-based (LDAP) sign-in, WebDAV Basic auth and the old
password of the profile page; 100 failed `/external` API keys per client IP; 10 registration/reset mails per
client IP and 3 per recipient address.

Other rewrite behaviours of the accounts (no configuration key):
* usernames and e-mail addresses are unique: indexes `username_unique` and `email_unique` (unique, partial:
  non-empty strings only, next to the legacy non-unique ones) are created at start-up; when the database already
  holds duplicates, the index is not created, a warning is logged and the application starts anyway;
* SAML responses must answer the AuthnRequest of the same browser session (`InResponseTo`, unsolicited
  IdP-initiated responses are refused) and each assertion is accepted once: its id is kept 24 hours in the
  `saml_assertions` collection (TTL index on `expires`);
* Facebook does not report whether the e-mail address is verified and LinkedIn only through `email_verified`:
  an unverified address never creates an account (an existing bound account can still sign in, and the identity
  can be bound from the profile).
