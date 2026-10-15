# Course settings: LTI 1.1 / LTI 1.3 configuration

- **ID**: CADM-04
- **Actors**: course admin, superadmin
- **Routes**: same form as CADM-03 (`POST /admin/<courseid>/settings`); displays URLs of the LTI routes (`/lti/<courseid>/<taskid>`, `/lti1.3/launch/<courseid>`, `/lti1.3/oidc_login/<courseid>`, `/lti1.3/jwks/<courseid>/<keyset_hash>`)
- **Depends on**: CADM-03 (form, save semantics and partial-save bug), LTI area features (launch/grade passback, which consume this config)
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/settings.py:L92-L141`; `templates/course_admin/settings.html:L89-L118,L366-L422`; `templates/course_admin/lti_config_card.html:L1-L90`; `static/js/admin.js:L86-L136` (`lti_secret_add`, `lti_secret_remove`); `courses.py:L74-L103,L208-L230`; `lti/v1_3/__init__.py:L21-L22` (`lti_keyset_hash`)

## Use case
An admin connects the course to an external LMS (Moodle, edX…): either LTI 1.1 (consumer key/secret pairs) or
LTI 1.3 (platform/issuer configuration with RSA key pair and per-deployment secrets), optionally sending grades back.

## Preconditions
- Admin rights. For LTI 1.3 global clients: config key `lti_config` in the frontend configuration (`config.LTI_CONFIG`).

## Main flow
1. Base tab: checkbox `lti` (`value="true"`, label "Enable LTI", help "Enable this option to allow your INGInious course to be used in external Learning Management Systems (LMS) such as Moodle or edX. Note that this will deactivate the group system.").
   When checked the JS shows the `.lti` elements: tabs "LTI 1.1"/"LTI 1.3", text `lti_url` ("External platform URL"),
   checkbox `lti_send_back_grade` (`value="true"`, "Send back grades": "Enable this to send back grades to the calling Tool Consumer (which is, most of the time, your LMS). INGInious will deactivate students' access to the course and tasks from the web application when enabled. Tasks will be only available from the LTI interface.").
2. **LTI 1.1 tab**: warning "LTI 1.1 is deprecated and support will be removed in a future release."; "Launch URL" `<code>http://<host>/lti/<courseid>/<taskid></code>`; textarea `lti_keys` ("Consumer keys and secrets", placeholder "LTI consumer keys and secrets in the form key:secret, separated by newlines. Please ensure keys are long enough and random."), prefilled `key:secret\n` per entry.
3. **LTI 1.3 tab**: warning "This is a feature preview. Implementation may change in a future release."; hidden input `lti_secrets` (value = `"<iss>/<client_id>/<deployment_id>/<secret>\n"` per configured secret);
   "Configured clients": one `lti_config_card.html` per client of the **global** config (`type="global"`) then per client of the course `lti_config` (`type="course"`); textarea `lti_config` "Additional raw configuration" (placeholder "LTI 1.3 Tool configuration in JSON form, refer to INGInious teachers documentation."), prefilled `course.lti_config() | tojson(2)`.
4. Card content (per issuer `iss` and client): header "Issuer : `<iss>`", "Client ID : `<client_id>`"; row "Deployment secrets" with a `<select id="<iss>/<client_id>">` ("Select a deployment id ..." placeholder) listing deployment ids that have no secret yet, and a button "Generate secret" calling `lti_secret_add(select.val())`; a list of existing secrets "`<deployment_id>` : `<secret>`" each with a trash link `lti_secret_remove('<iss>/<client>/<dep>')`; collapsible "Configuration details": Launch URL / Deep Link URL (both `/lti1.3/launch[/<courseid>]`), OIDC Login URL (`/lti1.3/oidc_login[/<courseid>]`), Redirect URLs (`["…/lti1.3/launch/<courseid>"]`), JWKS keyset (`/lti1.3/jwks[/<courseid>]/<md5(iss+client_id) hex>`), Public key (`<pre>`), "Required custom parameters": badges `courseid` (global clients only), `taskid`, `secret`. For course clients the URLs include `<courseid>`; for global clients they don't.
5. `lti_secret_add(dep_str)`: secret = `crypto.randomUUID()` without dashes (32 hex chars); removes the option, appends a list item, appends `dep_str + "/" + secret + "\n"` to the hidden `lti_secrets`. `lti_secret_remove` removes the `<li>`, re-adds the option, filters out lines starting with `dep_str` from `lti_secrets`.
6. On POST (verified):
   - `is_lti` = `'lti' in form and form['lti'] == "true"`; `lti_url` = form value or `""`; `lti_send_back_grade` likewise boolean.
   - `lti_keys` = `dict(line.split(":") for non-empty lines)`; each key must match `^[a-zA-Z0-9]*$` → else "LTI keys must be alphanumerical." (secrets are not checked).
   - `lti_config` = `json.loads(form['lti_config'])`, checks in order: JSON parse error → "LTI config couldn't parse as JSON - <python error>"; not an object → "LTI config is incorrect - Not a JSON object"; issuer value not a list → "LTI config is incorrect - Issuer <iss> must have a list of client_id configuration"; each client must have all of `default, client_id, auth_login_url, auth_token_url, key_set_url, private_key, public_key, deployment_ids` → "LTI config is incorrect - Missing <key> in client config <i> of issuer <iss>" (key reported in random set order); `pylti1p3.ToolConfDict` must accept it; private/public keys must be valid PEM (`jwcrypto.JWK.from_pem`) → "LTI config is incorrect - Error in private key of client config <i> of issuer <iss>" / "…public key…".
   - `lti_secrets` = `dict(line.rsplit("/", 1) for non-empty lines)` → key `"<iss>/<client_id>/<deployment_id>"`, value secret; each secret must match `^[a-zA-Z0-9]*$` → "LTI deployment secrets must be alphanumerical.".
7. Written YAML (verified):
   ```yaml
   is_lti: true
   lti_url: https://moodle.example
   lti_keys:
       key1: secret1
       key2: secret2
   lti_config:
       https://lms.example:
       -   auth_login_url: https://lms.example/auth
           auth_token_url: https://lms.example/token
           client_id: cid1
           default: true
           deployment_ids:
           - dep1
           - dep2
           key_set_url: https://lms.example/jwks
           private_key: |
               -----BEGIN PRIVATE KEY-----
               ...
           public_key: |
               ...
   lti_secrets:
       https://lms.example/cid1/dep2: 4eacc0860787413faab4bdbc606cd441
   lti_send_back_grade: true
   ```
   (`lti_config` inner keys are sorted alphabetically because `json.loads` returns plain dicts.)

## Alternative / error flows (verified)
- `lti_keys` line without `:` or with two `:` (e.g. `k:s:x`) → `ValueError` → **HTTP 500**. Same for an `lti_secrets` line without `/`.
- Key `key-1` → "LTI keys must be alphanumerical."; secret `bad-secret` → "LTI deployment secrets must be alphanumerical.".
- Because of the partial-save bug (CADM-03), these errors do **not** prevent the rest of the form (and even the invalid
  values computed before the error) from being written when the tags are valid. LTI config error: `lti_config` key keeps the previous value.
- **Disabling LTI wipes the configuration on the next save** (verified): `Course` empties `lti_keys/lti_config/lti_secrets/lti_url/lti_send_back_grade` in memory when `is_lti` is false, so after unchecking "Enable LTI" and saving, the page re-renders with empty LTI fields and the following save writes `lti_keys: {}`, `lti_config: {}`, `lti_secrets: {}`, `lti_url: ''`. The rewrite should preserve them (or warn).
- When LTI is on, the non-LTI settings are forced (see CADM-03).

## Data
- `course.yaml` keys `is_lti` (bool), `lti_url` (str), `lti_keys` (map str→str), `lti_config` (map issuer → list of client dicts), `lti_secrets` (map "iss/client/deployment" → secret), `lti_send_back_grade` (bool).
- Global config `lti_config` (read only).

## Permissions & security
- Admin only. LTI 1.1 secrets, LTI 1.3 private keys and deployment secrets live in `course.yaml` (data-format parity) and are only shown to course admins.
- The POST is protected against cross-site request forgery. Malformed lines produce validation errors.

## Acceptance tests
- Enabling LTI with keys `a:b` → `is_lti: true`, `lti_keys: {a: b}`; Launch URL shown `http://host/lti/<c>/<taskid>`.
- Invalid key `a-b:x` → "LTI keys must be alphanumerical." (and nothing saved in rewrite).
- Malformed key line `nocolon` → validation error (rewrite) instead of 500.
- Each LTI config validation message above reproduced exactly.
- Valid LTI 1.3 config: card rendered with issuer, client id, deployment select; "Generate secret" adds 32-hex secret into hidden `lti_secrets`; after save `lti_secrets` contains `"<iss>/<client>/<dep>": <secret>`; removing it deletes it.
- JWKS URL = `/lti1.3/jwks/<courseid>/<md5(iss+client_id)>` for course clients.
- Unchecking LTI then saving twice: legacy wipes; rewrite decision documented.
