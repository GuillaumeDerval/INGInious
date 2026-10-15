# LTI asset proxy and task-context URL rewriting

- **ID**: LTI-06
- **Actors**: LTI user
- **Routes**: GET /lti/asset/<path:asset_url>?session_id=… (legacy also: GET /course/<courseid>/<taskid>/<path:path>, task public files)
- **Depends on**: LTI-03, LTI-05, task static files (TASK area), RST rendering (ParsableText)
- **Legacy code**: `legacy/inginious/frontend/pages/lti/__init__.py:14-23` (`LTIAssetPage`),
  `legacy/inginious/frontend/parsable_text.py:139-155` (`starttag`, `rewrite_lti_url`),
  `legacy/inginious/frontend/pages/tasks.py:393-430` (`TaskPageStaticDownload`),
  `legacy/inginious/frontend/flask/mapping.py:92-93`

## Use case
Task statements (reStructuredText) often reference images or files with relative URLs,
which on the normal task page resolve against `/course/<courseid>/…`. In LTI mode the page
lives at `/lti/task` and no cookie is available, so relative URLs must be rewritten to an
LTI-aware proxy that keeps the `session_id`.

## Preconditions
- The task statement is rendered by the LTI task page (LTI-05).

## Main flow
Behaviour of the app (`app/src/lib/server/text/sanitize.ts`, `lti/pages.ts`):
1. When the statement (task context) is rendered for the LTI task page:
   - every `<a href>` not starting with `#` gets `target="_blank"` and
     `rel="noopener noreferrer"` (always, LTI or not);
   - `<a href>` and `<img src>` with a *relative* URL (no scheme, no `//`, no `#`, not
     starting with `/`) are resolved against `/lti/asset/` and get
     `?session_id=<token>` (an existing query string and fragment are kept), e.g.
     `public/pixel.png` → `/lti/asset/public/pixel.png?session_id=<token>`;
   - absolute URLs (`https://…`, `/x`) are untouched.
   The same absolute `/lti/asset/…` URL is used by LTI 1.1 and 1.3 sessions.
2. `GET /lti/asset/<asset_url>?session_id=…`: same guard as the LTI task page (LTI-05:
   LTI data, 1.3 deployment secret, logged in, LTI course), then the file
   `<asset_url>` (a leading `public/` is optional) of the `public/` folder of the task
   stored in the session is served, with the access checks of the normal task file route
   (course access, task visible). Missing file → 404 "File not found.".

Legacy reference (functional): legacy rewrote relative URLs to the page-relative
`asset/<URL>?session_id=…` by string concatenation for every RST rendered in a request
having `session_id`, and `/lti/asset/<URL>` answered with a 302 to
`/course/<courseid>/<taskid>/<URL>?session_id=…`, relative to the task's `public/` folder
(so `asset/public/x` did not work). On `/lti1.3/task` the relative `asset/x` resolved to
the missing `/lti1.3/asset/x` route, so LTI 1.3 statements had broken images.

## Alternative / error flows
- Relative URL semantics differ between normal mode (relative to `/course/<courseid>/`,
  sibling of the task) and LTI mode (relative to the task's `public/` folder via the
  proxy, with `public/` optional).
- Without LTI data → 403 "No LTI data available."; not logged in → LTI login step.

## UI elements
None (transparent rewriting).

## Data
Reads task files under `<tasks_directory>/<courseid>/<taskid>/public/`.

## Permissions & security
- The proxy only serves files of the session's own task, with the guard of the LTI task
  page (including the LTI 1.3 deployment secret) and the access checks of the normal task
  file route (course access + task visible).
- The `session_id` appended to rewritten links is the signed LTI session token (LTI-03),
  only accepted for that LTI session.
- Paths are confined to the task's `public/` folder: `..` segments and symbolic links
  cannot leave it.

## Acceptance tests
- In the LTI task page, RST `image:: foo.png` → `src="/lti/asset/foo.png?session_id=<token>"`;
  `https://ex.org/a.png` unchanged; anchor `#x` unchanged; all non-anchor `<a>` get
  `target=_blank`.
- `/lti/asset/foo.png?session_id=<token>` and `/lti/asset/public/foo.png?session_id=<token>`
  → 200 file content.
- Without LTI data → 403; not logged in → LTI login step.
- An LTI 1.3 task page's relative assets load.
- `/lti/asset/../../x` does not escape the task `public` folder.
