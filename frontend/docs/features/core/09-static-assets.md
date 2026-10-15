# Static assets (CSS/JS/fonts/icons, minified bundle, plugin static files)

- **ID**: CORE-09
- **Actors**: every visitor (browser)
- **Routes**: GET `/static/<path>`; plugin routes such as `/plugins/coming_tasks/static/<path>`
- **Depends on**: CORE-01
- **Legacy code**: `legacy/inginious/scripts/webapp.py:44-48` (SharedDataMiddleware), `legacy/inginious/frontend/app.py:139` (Flask default static folder), `legacy/inginious/frontend/templates/layout.html:4,16-124,220`, `legacy/inginious/frontend/static/**`, `legacy/inginious/scripts/minify/{Gruntfile.js,package.json}`, `legacy/inginious/frontend/plugins/upcoming_tasks/__init__.py:25-32,124`, `legacy/inginious/frontend/plugins/contests/__init__.py:251-253`, `legacy/inginious/frontend/templates/course_admin/stats.html:10`

## Use case
Pages need the vendored front-end libraries (jQuery/Bootstrap/CodeMirror...), INGInious' own CSS/JS
and images. Operators can choose a single concatenated bundle for production (`use_minified_js`).

## Preconditions
- Package directory `inginious/frontend/static/` present.

## Main flow
1. Serving: the WSGI app is wrapped by `werkzeug.SharedDataMiddleware({'/static/': <root>/frontend/static})` (`scripts/webapp.py:46-48`), so `/static/...` never reaches Flask
   (no session, no cookie). Verified response for `/static/js/all-minified.js`: `200`, `Content-Type: text/javascript; charset=utf-8`, `Cache-Control: max-age=43200, public`,
   `Expires` = now + 12 h, `Etag: "wzsdm-<mtime>-<size>-<adler32>"`, `Last-Modified`. Flask's built-in `/static/<path:filename>` route (same folder, endpoint `static`) also exists and is what `url_for('static', filename=...)` builds.
   Static files are served in maintenance mode too. Unknown file -> falls through to Flask -> templated 404.
2. Cache busting: templates call `url_for('static', filename=X, version=V)` -> `/static/X?version=V`: library versions for vendored files, `static_ver = 3` (`layout.html:4`) for INGInious' own files. The query string is not used by the server.
3. Directory layout (`frontend/static/`):
   - `css/`: `bootstrap.min.css` (Bootswatch **Yeti** theme on Bootstrap v4.5.3; `@import`s Google Fonts "Open Sans"), `bootstrap-rtl.min.css` (RTL build, Bootstrap grid 4.4.1 based), `INGInious.css` / `INGInious-rtl.css` (compiled from `INGInious.less`, `INGInious-rtl.less`, `common.less`), `lti.css`/`lti.less`, `bootstrap-datetimepicker.min.css` (Tempus Dominus Bootstrap4 v5.0.1), `font-awesome.min.css` (4.7.0), `codemirror.css`, `selectize.css` (0.13.0).
   - `fonts/`: FontAwesome 4.7 (`otf, eot, svg, ttf, woff, woff2`), Glyphicons halflings.
   - `icons/`: favicons (`favicon.ico`, `favicon-{16,32,96,160,196}...png`), `apple-touch-icon-*.png`, `mstile-*.png`, `browserconfig.xml`, `wb.svg`/`wb.png` (mask icon, colour `#5E932E`), `google-icon.svg`.
   - `images/`: `header.png` (top-left logo), `logo.png`, `logo_maintenance.png` (error/maintenance pages), `inginious_full.svg`, `inginious_full_logo_only.svg`, `inginious_horiz.svg`, `inginious_vert.svg`.
   - `js/`: own scripts `common.js`, `task.js`, `webapp.js`, `studio.js` (task editor), `audiences.js`, `groups.js`, `task_dispensers.js`, `admin.js`, `mycourses.js`, `checked-list-group.js`; bundles `all-minified.js` (~1.64 MB), `all-minified-rtl.js` (~1.66 MB);
     `codemirror/codemirror.min.js` (CodeMirror **5.65.21**) + `codemirror/mode/` (122 language modes + `meta.js`, loaded on demand via `CodeMirror.modeURL = /static/js/codemirror/mode/%N/%N.js`);
     `libs/`: see table.
   - `plugins/contests/`: `contests.js`, `jquery.countdown.min.js` (The Final Countdown v2.0.4), `scoreboard.css` (added by the contests plugin through the `css`/`javascript_header` hooks).
4. Vendored library versions (from file headers; `?version=` used in `layout.html` in parentheses when different):

   | File | Library / version |
   |---|---|
   | `js/libs/jquery.min.js` | jQuery 3.3.1 |
   | `js/libs/jquery.form.min.js` | jQuery Form Plugin 3.51.0 |
   | `js/libs/popper.min.js` | Popper.js 1.14.4 (per `?version`) |
   | `js/libs/bootstrap.min.js`, `bootstrap-rtl.min.js` | Bootstrap 4.5.3 |
   | `js/libs/moment.min.js` | Moment 2.30.1 |
   | `js/libs/moment-timezone-with-data.min.js` | moment-timezone 0.5.48 (`?version=0.6.0`) |
   | `js/libs/bootstrap-datetimepicker.min.js` | Tempus Dominus Bootstrap4 5.0.1 |
   | `js/libs/Sortable.min.js` | SortableJS 1.10.2 |
   | `js/libs/jquery.twbsPagination.min.js` | twbs-pagination 1.4.2 |
   | `js/libs/selectize.min.js` | selectize.js 0.13.0 |
   | `js/libs/chart.min.js` | Chart.js 2.7.3 (only on `course_admin/stats.html`) |
   | `js/libs/sentry-io-bundle.min.js` | @sentry/browser 5.4.3 (CORE-06) |
   | `js/codemirror/codemirror.min.js` | CodeMirror 5.65.21 |
   | external | MathJax 2.7.1 from `//cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.1/MathJax.js?config=TeX-AMS-MML_HTMLorMML` (every page, end of body) |
   | `css/font-awesome.min.css` | Font Awesome 4.7.0 |

5. `use_minified_js: true` (reference infra): `<head>` loads only `js/all-minified.js?version=3` (or `all-minified-rtl.js` for RTL). `false` (default): loads, in order, jquery, jquery.form, codemirror, codemirror/mode/meta, popper, moment, moment-timezone, bootstrap(-rtl), datetimepicker, Sortable, twbsPagination, selectize, checked-list-group, common, task, webapp, studio, audiences, groups, task_dispensers, admin, mycourses (`layout.html:83-110`).
   The bundles are produced by Grunt (`scripts/minify/Gruntfile.js`: `concat` with separator `\n /* --- */ \n` of jquery, jquery.form, popper, bootstrap(-rtl), moment, moment-timezone, datetimepicker, Sortable, twbsPagination, selectize, codemirror, mode/meta, then the INGInious scripts), then minified; they are committed artefacts.
6. Plugin static files: either placed under `frontend/static/plugins/<plugin>/` (contests) and referenced via hooks, or served by a plugin page using `flask.send_from_directory(<plugin>/static, path)` (upcoming_tasks registers `/plugins/coming_tasks/static/<path>`, though the plugin ships no `static/` folder). Plugin templates are mounted with `add_template_prefix`.
7. Task/course files (images in task context, downloadable files) are *not* static assets: they are served by `/course/<courseid>/<taskid>/<path>` (`TaskPageStaticDownload`) and documented with the task features.

## Alternative / error flows
- Missing bundle file with `use_minified_js: true` -> every page lacks JS (no error page).
- MathJax comes from cdnjs; Bootstrap CSS pulls Google Fonts.

## UI elements
- Favicons and logos as listed; `logo_maintenance.png` on all error pages.

## Data
- Config: `use_minified_js` (bool). No DB access for static files.

## Permissions & security
- Public, unauthenticated. In the new app, built assets (`/_app/immutable/...`) and the files of `app/static/` are served by the adapter-node static file server, confined to the build output directory.
- Static responses are served before the request pipeline: no session, no `Set-Cookie`.

## Acceptance tests
- `GET /static/images/logo_maintenance.png`, `/static/css/INGInious.css`, `/static/js/codemirror/mode/python/python.js` -> 200 with correct content types, without `Set-Cookie`, with long-lived caching headers.
- `GET /static/doesnotexist.js` -> 404.
- `GET /static/../app.py` style traversal -> 404/400, never file content.
- With `use_minified_js: true` the HTML contains exactly one app script `all-minified.js` (RTL: `all-minified-rtl.js`); with `false` it contains the individual scripts.
- Every page includes jQuery 3.x, Bootstrap 4.5.3 JS/CSS, Font Awesome 4.7 CSS, CodeMirror 5.65 (or functionally equivalent replacements in the new UI — document the choice), and MathJax rendering of `\( ... \)` / `$$...$$` in task statements.
- CodeMirror language modes load on demand for a code problem with `language: python` (request to `.../mode/python/python.js`).
- Contests plugin enabled -> `/static/plugins/contests/scoreboard.css`, `jquery.countdown.min.js` and `contests.js` are referenced in `<head>` and return 200.
