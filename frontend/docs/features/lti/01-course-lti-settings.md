# Course LTI configuration (settings tabs, keys, LTI 1.3 clients and secrets)

- **ID**: LTI-01
- **Actors**: course admin, superadmin (global config via YAML)
- **Routes**: GET/POST /admin/<courseid>/settings (LTI part only; the rest of the page is documented in the course-admin area)
- **Depends on**: course settings page (COURSE-ADMIN area), LTI-11 (JWKS URL shown), LTI-09 (secrets checked at launch)
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/settings.py:92-141,155-158`,
  `legacy/inginious/frontend/courses.py:74-104,208-230`,
  `legacy/inginious/frontend/app.py:67` (global `lti_config`),
  `templates/course_admin/settings.html:45-50,88-117,366-421,498-515`,
  `templates/course_admin/lti_config_card.html`, `static/js/admin.js:86-136` (`lti_secret_add/remove`),
  `legacy/doc/teacher_doc/lti.rst`

## Use case
A teacher wants to expose the tasks of a course inside an LMS (Moodle, edX, Canvas...).
They switch the course to *LTI mode*, optionally make INGInious push grades back to the
LMS gradebook, and configure the credentials of each LMS: an LTI 1.1 consumer
key/secret pair, and/or LTI 1.3 platform registrations (issuer, client id, keys,
deployments) plus one *deployment secret* per deployment. The settings page also displays
the URLs that must be copied into the LMS.

## Preconditions
- Logged in as course admin (or superadmin) of `<courseid>`.
- For LTI 1.3: an RSA key pair (teacher doc: `openssl genrsa > private.pem; openssl rsa -in private.pem -pubout -out public.pem`).

## Main flow
1. Admin opens the settings page. Tab "Basic" contains the checkbox **Enable LTI**
   (`name="lti" value="true"`). When checked (client side `updateLTI()`), every element
   with class `no-lti` is hidden (registration, password, access control, groups-choice,
   allow-unregister, accessibility ...) and every `.lti` element is shown: the two extra
   tabs **LTI 1.1** and **LTI 1.3**, the field **External platform URL** (`lti_url`) and
   the checkbox **Send back grades** (`lti_send_back_grade`, help text: "INGInious will
   deactivate students' access to the course and tasks from the web application when
   enabled. Tasks will be only available from the LTI interface.").
2. Tab **LTI 1.1**: warning "LTI 1.1 is deprecated and support will be removed in a
   future release."; the *Launch URL* `https://<host>/lti/<courseid>/<taskid>` (literal
   `<taskid>` placeholder); textarea **Consumer keys and secrets** (`lti_keys`), one
   `key:secret` per line.
3. Tab **LTI 1.3**: warning "This is a feature preview. Implementation may change in a
   future release."; section **Configured clients** showing one card per client of the
   *global* config (`config.LTI_CONFIG`, type "global") then of the course config (type
   "course"). Each card (`lti_config_card.html`) shows:
   - Issuer and Client ID;
   - **Deployment secrets**: a select listing deployment ids of the client that do not yet
     have a secret, a **Generate secret** button, and the list of
     `deployment_id : secret` rows with a trash icon;
   - collapsible **Configuration details**: Launch URL and Deep Link URL (both
     `url_for('lti1.3launchpage', courseid=<courseid>)` for course cards, without courseid
     for global cards — i.e. `/lti1.3/launch[/<courseid>]`, *not* `/deeplaunch`), OIDC
     Login URL (`/lti1.3/oidc_login[/<courseid>]`), Redirect URLs (`["<launch url>"]`),
     JWKS keyset (`/lti1.3/jwks/[<courseid>/]<md5(iss+client_id)>`), the public key, and
     *Required custom parameters* (badges `courseid` for global cards only, `taskid`,
     `secret`).
   - textarea **Additional raw configuration** (`lti_config`) prefilled with
     `course.lti_config() | tojson(2)`.
4. Generate secret (JS `lti_secret_add`): secret = `crypto.randomUUID()` without dashes
   (32 hex chars); the option is removed from the select, a row is appended, and
   `"<iss>/<client_id>/<deployment_id>/<secret>\n"` is appended to the hidden input
   `lti_secrets`. Trash (`lti_secret_remove`) removes the row, re-adds the option and drops
   every line of `lti_secrets` starting with `<iss>/<client_id>/<deployment_id>`.
   Nothing is persisted until the form is saved.
5. Admin clicks Save → POST. Server side (`settings.py`):
   - `is_lti = ('lti' in data and data['lti'] == "true")`;
   - `lti_url = data.get("lti_url", "")`;
   - `lti_keys = dict(x.split(":") for x in data['lti_keys'].splitlines() if x)`; each key
     must match `^[a-zA-Z0-9]*$` else error "LTI keys must be alphanumerical.";
   - `lti_config = json.loads(data['lti_config'])`, must be a dict of issuer → **list** of
     client dicts each containing `default, client_id, auth_login_url, auth_token_url,
     key_set_url, private_key, public_key, deployment_ids`; then a PyLTI1p3
     `ToolConfDict` is built and each private/public key must parse with
     `jwcrypto.JWK.from_pem`. Errors: "LTI config couldn't parse as JSON - <msg>",
     "LTI config is incorrect - <msg>" (e.g. `Missing key_set_url in client config 0 of
     issuer X`, `Issuer X must have a list of client_id configuration`,
     `Error in private key of client config i of issuer X`).
   - `lti_secrets = dict(x.rsplit("/", 1) for x in data['lti_secrets'].splitlines() if x)`;
     each secret must match `^[a-zA-Z0-9]*$` else "LTI deployment secrets must be
     alphanumerical.";
   - `lti_send_back_grade = ('lti_send_back_grade' in data and data[...] == "true")`.
   - If no error, the whole course descriptor is rewritten to `course.yaml`.
6. The page is re-rendered with "saved" or the error list.

## Alternative / error flows
- Any validation error: nothing saved, errors listed (other fields keep the submitted
  values only where the template uses them; LTI fields are re-rendered from the stored
  course).
- A line of `lti_keys` without `:` or with several `:` (e.g. a secret containing `:`)
  → error "Each LTI key line must have the form key:secret." (legacy: HTTP 500).
- A `(issuer, client_id)` already declared with other platform keys in the global
  configuration or in another LTI course → error "LTI config is incorrect - Client <id> of
  issuer <iss> is already registered in <source>"; nothing saved.
- `lti_config` textarea left as `{}` → valid (no course-level clients).
- When the course is **not** LTI, `Course` forces `lti_keys = lti_secrets = lti_config = {}`,
  `lti_url = ''`, `lti_send_back_grade = False` on load (the YAML values are kept on disk
  but ignored). When it **is** LTI, the course object forces `accessible = True`,
  `registration = False`, `registration_password = None`, `registration_ac = None`,
  `registration_ac_list = []`, `groups_student_choice = False`, `allow_unregister = False`
  (whatever the YAML says).

## UI elements
- Checkbox *Enable LTI*, text input *External platform URL*, checkbox *Send back grades*.
- Tab *LTI 1.1*: deprecated alert, launch URL `<code>`, textarea `lti_keys` (10 rows,
  placeholder "LTI consumer keys and secrets in the form key:secret, separated by
  newlines. Please ensure keys are long enough and random.").
- Tab *LTI 1.3*: preview alert, hidden input `lti_secrets` (value = `a/b\n` lines),
  client cards (accordion), textarea `lti_config` (6 rows, placeholder "LTI 1.3 Tool
  configuration in JSON form, refer to INGInious teachers documentation.").
- Other pages affected by `is_lti`: student list hides the *Groups* tab
  (`student_list.html:45,209`, `student_list.py:273` ignores group posts).

## Data
- `course.yaml` keys: `is_lti: bool`, `lti_url: str`, `lti_keys: {key: secret}`,
  `lti_send_back_grade: bool`, `lti_config: {iss: [client...]}`,
  `lti_secrets: {"<iss>/<client_id>/<deployment_id>": secret}`.
  Example (test fixture `infra/tasks/lti_test/course.yaml`):
  ```yaml
  is_lti: true
  lti_keys: {ltikey: ltisecret}
  lti_send_back_grade: true
  lti_url: 'http://lms.example/course/42'
  lti_secrets: {https://platform.example/tool-client-1/dep-1: s3cr3t}
  ```
- Global configuration key `lti_config` (same JSON shape, YAML) → Flask config
  `LTI_CONFIG`; not validated at startup.
- Course accessors: `is_lti()`, `lti_keys()`, `lti_config()`, `lti_secrets()` (return `{}`
  when not LTI), `lti_url()`, `lti_send_back_grade()` (= `is_lti and lti_send_back_grade`).

## Permissions & security
- Only course admins (not tutors: `allow_all_staff=False`) can view/edit.
- Course private keys, deployment secrets and consumer secrets are stored in `course.yaml`
  and shown on this page to the course admins only.
- Consumer keys and deployment secrets must match `[a-zA-Z0-9]*`.
- A course cannot register an `(issuer, client_id)` that is declared elsewhere (global
  configuration or another LTI course) with other platform keys; such a registration is
  refused on save and ignored at launch (LTI-09).
- The global configuration and the course configuration are merged into new objects
  (JWKS page LTI-11, tool configuration): the settings page only edits and saves the
  course clients; global client cards show issuer, client id, deployments and public key
  only.
- The form POST is protected by an origin check.

## Acceptance tests
- Enabling LTI and saving writes `is_lti: true` and the four `lti_*` keys; reloading shows
  the LTI tabs and hides `no-lti` fields.
- `lti_keys` "a:b\nc:d" → `{a: b, c: d}`; key "a-b" → error "LTI keys must be
  alphanumerical." and nothing saved.
- `lti_config` invalid JSON → "LTI config couldn't parse as JSON - …"; missing
  `key_set_url` → "LTI config is incorrect - Missing key_set_url in client config 0 of
  issuer X"; bad PEM → "Error in private key of client config 0 of issuer X".
- `lti_secrets` hidden field "i/c/d/abc" → `{"i/c/d": "abc"}`; secret "ab-c" → error.
- Generate-secret JS produces a 32-hex secret, removes the option, updates the hidden
  input; delete restores the option.
- Cards show the exact URLs (launch, OIDC, JWKS with md5 hash) for course and global
  clients; `courseid` badge only on global cards.
- A non-LTI course with LTI keys in YAML returns `{}` for `lti_keys()` etc.
- An LTI course always reports `allow_unregister == False`, registration closed,
  accessible.
- Regression: requesting the JWKS endpoint must not change what the settings page shows.
