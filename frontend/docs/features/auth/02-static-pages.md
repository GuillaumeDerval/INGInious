# Static pages (/pages/<pageid>), terms of service and privacy pages

- **ID**: AUTH-02
- **Actors**: anonymous, any logged-in user
- **Routes**: GET/POST `/pages/<pageid>`
- **Depends on**: AUTH-10 (language), AUTH-04 (session)
- **Legacy code**: `legacy/inginious/frontend/pages/utils.py:L206-L242` (`INGIniousStaticPage`), `legacy/inginious/frontend/flask/mapping.py:L79`, `legacy/inginious/frontend/app.py:L72,L103-L105,L115`, templates `templates/static.html`, `templates/layout.html:L212-L214` (footer privacy link), `templates/register.html:L46-L50`, `templates/preferences/profile.html:L103-L108`

## Use case
The operator publishes informational pages (terms of service, privacy policy, about, help...)
as YAML files containing reStructuredText, optionally translated, served at `/pages/<pageid>`.
Two of them can be designated as the Terms of Service (`terms_page`) and the Privacy policy
(`privacy_page`) — when **both** are configured, ToS acceptance is enforced (AUTH-09).

## Preconditions
- Files in `static_directory` (config key, default `./static` relative to the process CWD).

## Main flow
1. `GET /pages/<pageid>` (POST identical).
2. Candidate files, in order: `<static_directory>/<pageid>.yaml`, then `<static_directory>/<pageid>.<session.language>.yaml`. Every existing candidate overrides the previous one, so **the language-specific file wins** when present.
3. A process-wide cache keyed by file path stores `(mtime, parsed_yaml)`; the file is re-read only if its mtime is newer than the cached one.
4. Render `static.html`: `{% block title %} {{pagetitle}} {% endblock %}` (→ `<title> Terms  | INGInious</title>`), content = `ParsableText.rst(content, initial_header_level=2)` output with `| safe`.

## Alternative / error flows
- No candidate file → 404, `notfound.html`, message "File doesn't exist." (translated).
- `pageid` comes from a Flask default converter, so it cannot contain `/`; `..%2F...` → 404 (tested).
- Missing `title`/`content` keys or invalid YAML → 500.

## UI elements
- Page = layout + RST HTML. No page-specific controls.
- Footer of every page (`layout.html:L212-L214`): when `IS_TOS_DEFINED`, appends ` - <a href="/pages/{privacy_page}">Privacy Policy</a>`.
- Registration form and profile form show the checkbox `term_policy_check` with label
  "I have read the {a1start}Terms of service{a1end} and the {a2start}Privacy policy{a2end}." where links are `/pages/<terms_page>` and `/pages/<privacy_page>` (no `target`).

## Data
- Config keys: `static_directory`, `terms_page` (str pageid), `privacy_page` (str pageid). Derived flag `IS_TOS_DEFINED = ("PRIVACY_PAGE" in config and "TERMS_PAGE" in config)`.
- YAML file format: `{title: str, content: str (RST)}`; file name `<pageid>.yaml` or `<pageid>.<lang>.yaml` with `<lang>` one of the available language codes (AUTH-10, e.g. `fr`, `nb_NO`).
- No DB access besides the session.

## Permissions & security
- Public pages, no authentication.
- Content is operator content (RST, raw HTML blocks allowed); the rendered HTML is sanitized before display.
- `pageid` is validated (`^[A-Za-z0-9_.-]+$`, `.`/`..` refused, no `/`) and joined with `static_directory` by a confined path join; only files inside `static_directory` are ever read.
- The terms/privacy links are built from operator-controlled config values (`terms_page`, `privacy_page`).

## Acceptance tests
- `GET /pages/auth_terms` with `auth_terms.yaml` (`title: Terms`, `content: These are the terms.`) → 200, title "Terms", body `<p>These are the terms.</p>`.
- Translated file: with `auth_welcome.yaml` and `auth_welcome.fr.yaml`, `GET /pages/auth_welcome?lang=fr` → French content; English session → default content.
- Only `<page>.fr.yaml` exists: French session → 200; English session → 404.
- `GET /pages/missing` → 404 "File doesn't exist.".
- `GET /pages/..%2Fconfiguration` → 404, no file outside the static directory is ever read.
- Edit the YAML file on disk (newer mtime) → next request shows new content without restart.
- With both `terms_page` and `privacy_page` set: footer of any page contains a link to `/pages/<privacy_page>` labelled "Privacy Policy"; with only one of them set: no footer link and no ToS checkbox anywhere.
