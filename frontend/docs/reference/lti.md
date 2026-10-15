# LTI protocol reference (legacy INGInious behaviour)

This document is the protocol-level reference for re-implementing the INGInious LTI
Tool (LTI 1.1 *Tool Provider* and LTI 1.3 *Tool*) in TypeScript. It describes **what the
legacy Python frontend actually does on the wire**, which is the behaviour that existing
LMS integrations (Moodle, edX, Canvas, ...) depend on. Everything below was checked
against the installed library sources (`lti==0.9.5`, `oauthlib==4.0.0`,
`PyLTI1p3==2.0.0`, `PyJWT 2.15`, `jwcrypto`) and against a live run (mock LMS in
`infra/agent-configs/lti-mock/mock_platform.py`, see "Test harness" at the end).

Feature files: `docs/features/lti/LTI-01 … LTI-14`.

---------------------------------------------------------------------------------------

## 1. LTI 1.1 — inbound basic launch (OAuth 1.0a, signature in body)

### 1.1 Endpoint

`POST /lti/<courseid>/<taskid>` (`application/x-www-form-urlencoded`).
`GET` → 405. The course must exist (404 otherwise) and `course.lti_keys()` must contain
`oauth_consumer_key` (only non-empty when the course has `is_lti: true`).

### 1.2 Parameter whitelist (lib `lti`, `LaunchParams`)

Every POST parameter must be a *known* LTI parameter, else the request is rejected
(HTTP 403 *"Error while parsing the LTI request"*). Accepted names:

* any name starting with `custom_` or `ext_`;
* required: `lti_message_type`, `lti_version`, `resource_link_id`;
* recommended: `resource_link_description`, `resource_link_title`, `user_id`, `user_image`,
  `roles`, `lis_person_name_given`, `lis_person_name_family`, `lis_person_name_full`,
  `lis_person_contact_email_primary`, `role_scope_mentor`, `context_id`, `context_label`,
  `context_title`, `context_type`, `launch_presentation_locale`,
  `launch_presentation_document_target`, `launch_presentation_css_url`,
  `launch_presentation_width`, `launch_presentation_height`,
  `launch_presentation_return_url`, `tool_consumer_info_product_family_code`,
  `tool_consumer_info_version`, `tool_consumer_instance_guid`,
  `tool_consumer_instance_name`, `tool_consumer_instance_description`,
  `tool_consumer_instance_url`, `tool_consumer_instance_contact_email`;
* LIS: `lis_course_section_sourcedid`, `lis_course_offering_sourcedid`,
  `lis_outcome_service_url`, `lis_person_sourcedid`, `lis_result_sourcedid`;
* return-url messages: `lti_errormsg`, `lti_errorlog`, `lti_msg`, `lti_log`;
* OAuth: `oauth_consumer_key`, `oauth_signature_method`, `oauth_timestamp`, `oauth_nonce`,
  `oauth_version`, `oauth_signature`, `oauth_callback`, `oauth_token`;
* Canvas: `selection_directive`, `text`;
* content-item: `accept_media_types`, `accept_presentation_document_targets`,
  `content_item_return_url`, `accept_unsigned`, `accept_multiple`, `accept_copy_advice`,
  `auto_create`, `title`, `data`, `can_confirm`, `content_items`;
* registration: `tc_profile_url`, `reg_password`, `reg_key`.

Only the **first value** of a repeated form field is kept (Werkzeug `MultiDict` → dict).

**Parameter mutation before signature check (parity-relevant quirks):**

1. If `lti_version` is absent, `lti_version=LTI-1.0` is injected; if `lti_message_type` is
   absent, `lti_message_type=basic-lti-launch-request` is injected. The injected values are
   **included in the signature base string**, so a launch that did not send them fails the
   signature check (verified: dropping `lti_version` → 403).
2. List parameters (`roles`, `role_scope_mentor`, `context_type`, `accept_media_types`,
   `accept_presentation_document_targets`) are re-serialised as
   `",".join(x.strip() for x in value.split(","))` before signing. A consumer that sends
   `roles="Instructor, Learner"` (with a space) therefore **fails** validation
   (verified: 403).
3. The URL used for the base string is `flask.request.url`, i.e. the URL *as seen by the
   Python process*, including its query string (whose parameters are added to the
   normalised parameter list). The gunicorn entry point applies no `ProxyFix`; the
   `run_simple` entry point applies `ProxyFix(x_for, x_host)` only when
   `reverse-proxy-config.enable` is set and never `x_proto`. Behind a TLS-terminating
   proxy the base string thus starts with `POST&http%3A%2F%2F…` while the LMS signed
   `https://…` → signature failure. The rewrite should use the externally visible URL
   (configurable), but this is an existing deployment gotcha.

### 1.3 Signature verification (oauthlib `SignatureOnlyEndpoint`)

Only the **body** carries OAuth parameters in practice: the request headers are passed to
oauthlib as WSGI environ keys (`HTTP_AUTHORIZATION`, `CONTENT_TYPE`, ...), so an
`Authorization: OAuth …` header is **not** recognised. Steps, in order:

1. Collect params from body (+ query string). If `oauth_*` params come from more than one
   source → invalid. Duplicate `oauth_*` params → invalid.
2. Transport: the launch URL scheme is whatever the deployment uses (see the base string
   URL above).
3. Mandatory: `oauth_signature`, `oauth_consumer_key`, `oauth_nonce`, `oauth_timestamp`,
   `oauth_signature_method` all present.
4. `oauth_signature_method`: LMSs use `HMAC-SHA1` (or `HMAC-SHA256`). The new app accepts
   only these two HMAC methods; any other method → 403.
5. If `oauth_version` present it must be `1.0`.
6. `oauth_timestamp` must be exactly 10 digits and within **±600 s** of server time.
7. Client key: characters ⊂ oauthlib "safe characters" (ASCII letters+digits), length
   **1–30** (`client_key_length = (1, 30)`). Nonce: safe characters, length **20–64**.
8. **Nonce store**: insert
   `{timestamp: <oauth_timestamp as local datetime>, nonce, expiration: timestamp+10min}`
   into collection `nonce`; a duplicate (unique index on `(timestamp, nonce)`) is a replay
   and is refused. The new app records the nonce once the signature is valid.
   A TTL index on `expiration` (expireAfterSeconds 0) purges entries.
9. `validate_client_key`: key ∈ `course.lti_keys()`. An unknown key is replaced by the
   dummy client `""` (constant-time path) and the request fails.
10. Signature: recompute per RFC 5849 §3.4 with `client_secret = lti_keys[key]`, no token
    secret, and compare. HMAC: key = `pct(client_secret) + "&"`.

Base string (RFC 5849 §3.4.1):

```
METHOD "&" pct(base_string_uri) "&" pct(normalized_params)

base_string_uri = lower(scheme) "://" lower(host) [":" port if not default] path   (no query, no fragment)
normalized_params = sort(by name then value, on the pct-encoded pairs) of every body and
                    query parameter except oauth_signature (and realm), each as
                    pct(name) "=" pct(value), joined with "&"
pct = RFC 3986 percent-encoding, unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
```

Example captured from the live run (abridged):
`POST&http%3A%2F%2Flocalhost%3A8093%2Flti%2Flti_test%2Fmcq1&context_id%3Dc1%26context_label%3DC101%26context_title%3DLMS%2520course%26lis_outcome_service_url%3Dhttp%253A%252F%252Flti-mock…`

Error mapping: any exception while parsing/validating → **403** "Error while parsing the
LTI request"; `valid == False` → **403** "Couldn't validate LTI request". A missing
`user_id` (after a valid signature) → **400** (Werkzeug `BadRequestKeyError`).

### 1.4 Launch data extracted

| Session field (`LTIData`) | Source |
|---|---|
| `username` | `user_id` (**required**) |
| `roles` | `roles` split on `,` (default `["Student"]`) — **stored, never used** |
| `realname` | `lis_person_name_full`, else `given+family` (no space!), else email, else family, else given, else `user_id` |
| `email` | `lis_person_contact_email_primary` or `""` |
| `outcome_service_url` / `outcome_result_id` | `lis_outcome_service_url` / `lis_result_sourcedid` when `course.lti_send_back_grade()`; both required then (403 otherwise); `None` otherwise |
| `consumer_key` | `oauth_consumer_key` |
| `tool_name`, `tool_description`, `tool_url` | `tool_consumer_instance_name/description/url` or `"N/A"` |
| `context_title`, `context_label` | idem or `"N/A"` |
| `task` | `[courseid, taskid]` from the URL |
| `redir_url` | `/lti/task?session_id=<sid>` |
| `version` | `"1.1"` |

Response: `302 Location: /lti/login?session_id=<sid>` (relative), **no cookie**.

---------------------------------------------------------------------------------------

## 2. LTI 1.1 — outbound grade passback (LIS Basic Outcomes, replaceResult)

Request (lib `lti.OutcomeRequest.post_replace_result`, sent with `requests`):

```
POST <lis_outcome_service_url>
Content-type: application/xml
Authorization: OAuth oauth_nonce="<29-30 digits>", oauth_timestamp="<unix>", oauth_version="1.0",
               oauth_signature_method="HMAC-SHA1", oauth_consumer_key="<key>",
               oauth_body_hash="<base64(SHA1(body))>", oauth_signature="<HMAC-SHA1>"
User-Agent: python-requests/2.31.0
```

The OAuth header is produced by `requests_oauthlib.OAuth1(key, secret,
signature_type=AUTH_HEADER, force_include_body=True)`: the signature base string contains
the outcome URL, the oauth params and `oauth_body_hash` (body params are *not* included
since the content type is XML). Body (exact bytes from the live run, `encoding='utf-8'`,
XML declaration with single quotes, no pretty printing):

```xml
<?xml version='1.0' encoding='utf-8'?>
<imsx_POXEnvelopeRequest xmlns="http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0"><imsx_POXHeader><imsx_POXRequestHeaderInfo><imsx_version>V1.0</imsx_version><imsx_messageIdentifier/></imsx_POXRequestHeaderInfo></imsx_POXHeader><imsx_POXBody><replaceResultRequest><resultRecord><sourcedGUID><sourcedId>sourcedid-1</sourcedId></sourcedGUID><result><resultScore><language>en</language><textString>0.0</textString></resultScore></result></resultRecord></replaceResultRequest></imsx_POXBody></imsx_POXEnvelopeRequest>
```

* `imsx_messageIdentifier` is **empty** (never set).
* `textString` = `str(float)` of `clip(user_task.grade / 100, 0.0, 1.0)` → e.g. `0.0`,
  `1.0`, `0.75`. The grade sent is the **cached per-user task grade** (`user_tasks.grade`,
  i.e. best or last submission depending on the task's evaluation mode), *not* the grade
  of the submission that triggered the send.
* Success iff the response XML parses and
  `imsx_POXHeader/imsx_POXResponseHeaderInfo/imsx_statusInfo/imsx_codeMajor == "success"`.
  The HTTP status code is ignored; unparsable XML = failure.

Queue / retry semantics: see LTI-07 (collection `lis_outcome_queue`, max 6 attempts
0.5 s apart, then dropped).

---------------------------------------------------------------------------------------

## 3. LTI 1.3 — configuration format

Course key `lti_config` (and global configuration key `lti_config`, merged; the global
entries are appended to the course list for the same issuer):

```json
{
  "<issuer (platform id), e.g. https://moodle.example>": [
    {
      "default": true,
      "client_id": "<client id given by the platform>",
      "auth_login_url": "<platform OIDC authorization endpoint>",
      "auth_token_url": "<platform OAuth2 token endpoint>",
      "auth_audience": null,
      "key_set_url": "<platform JWKS url>",
      "key_set": null,
      "deployment_ids": ["<deployment id>", "..."],
      "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
      "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    }
  ]
}
```

* Value per issuer must be a **list** (course settings validation). PyLTI1p3 would also
  accept a single dict ("one client per issuer" mode) and the global config is not
  validated by INGInious, so global configs may use either form.
* Keys required by the course settings form: `default`, `client_id`, `auth_login_url`,
  `auth_token_url`, `key_set_url`, `private_key`, `public_key`, `deployment_ids` (note:
  `key_set_url` is required even though `key_set` would suffice for PyLTI1p3).
  `private_key` and `public_key` must be loadable by `jwcrypto.JWK.from_pem`
  (PKCS#1 `RSA PRIVATE KEY` and PKCS#8 `PRIVATE KEY` both work).
* `default: true` selects the client when the OIDC login request carries no `client_id`
  (or when the issuer has a single client).
* Key generation (teacher doc): `openssl genrsa > private.pem; openssl rsa -in private.pem -pubout -out public.pem`.

Course key `lti_secrets`: `{ "<iss>/<client_id>/<deployment_id>": "<alphanumeric secret>" }`
(the *platform instance id*; see LTI-01/LTI-09).

Derived values:

* **platform_instance_id** = `iss + "/" + client_id + "/" + deployment_id`
  (`client_id` = JWT `aud`, first element if a list).
* **keyset hash** = `md5(iss + client_id)` hex (32 chars) — used in the JWKS URL
  `/lti1.3/jwks/[<courseid>/]<hash>`.
* **binding key** (field name in `users.ltibindings`) =
  `platform_instance_id` with every `.` and `$` removed, e.g.
  `https://platformexample/tool-client-1/dep-1`.

---------------------------------------------------------------------------------------

## 4. LTI 1.3 — OIDC third-party initiated login

`GET|POST /lti1.3/oidc_login[/<courseid>]` with `iss`, `login_hint`, `target_link_uri`
(**required**, else HTTP 500), optional `client_id`, `lti_message_hint`,
`lti_deployment_id`. Parameters are read from the query string on GET and from the form on
POST (never both).

Step 1 — "cookie check" page. Because `enable_check_cookies()` is used and the request
has no `lti1p3_new_window` parameter, the response is **200 text/html** (PyLTI1p3
`CookiesAllowedCheckPage`): a page whose JS sets a test cookie
(`lti1p3_test_cookie=1; path=/` plus `; SameSite=None; secure` on https). If the cookie
sticks, the page navigates (GET) to the same URL with the original query string plus every
missing param among `lti1p3_new_window=1, iss, login_hint, target_link_uri,
lti_message_hint, lti_deployment_id, client_id`; otherwise it shows "Your browser
prohibits to save cookies in the iframes. Click here to open content in the new tab."
(opens that URL in a new tab). Loading text "Loading...".

Step 2 — with `lti1p3_new_window=1`: validate (`iss` present → "Could not find issuer";
`login_hint` present; registration found for `iss` [+ `client_id`]) — failures raise →
**500**. Then:

* `state = "state-" + uuid4()`; cookie `lti1p3-<state>=<state>`, `Max-Age=300`,
  `Path=/`, `HttpOnly`, `Secure` + `SameSite=None` only if the request is https.
* `nonce = uuid4().hex + uuid1().hex`; stored as document
  `{key: "lti1p3-nonce-<nonce>", value: true}` in collection `lti_launch` (no expiry).
* `302 Location: <auth_login_url>?scope=openid&response_type=id_token&response_mode=form_post&prompt=none&client_id=<client_id>&redirect_uri=<target_link_uri>&state=<state>&nonce=<nonce>&login_hint=<login_hint>[&lti_message_hint=<hint>]`
  (`urlencode` order exactly as listed). `redirect_uri` is the `target_link_uri`, which
  the platform checks against the redirect URIs registered for the tool.
* The normal INGInious session cookie is also set (ordinary non-LTI session).

---------------------------------------------------------------------------------------

## 5. LTI 1.3 — message launch (id_token validation)

`GET|POST /lti1.3/launch`, `/lti1.3/launch/<courseid>`, `/lti1.3/launch/<courseid>/<taskid>`,
`/lti1.3/deeplaunch`, `/lti1.3/deeplaunch/<courseid>` (all the same handler). Params
`id_token`, `state` (form on POST, query on GET). Tool configuration = course `lti_config`
(if `<courseid>` given and the course is LTI) merged with the global `lti_config`.

PyLTI1p3 `MessageLaunch.validate()` order (any failure raises `LtiException` → **500**):

1. **state**: `state` param required. PyLTI1p3 checks it against the
   `lti1p3-<state>-id-token-hash` document (written at step 8) or the cookie `lti1p3-<state>`
   ("State not found"). The new app requires the cookie set on the browser that started the
   login and does not write the id-token-hash documents.
2. **JWT format**: 3 dot-separated parts, header and body base64url JSON.
3. **nonce**: body `nonce` must exist as `lti1p3-nonce-<nonce>` in `lti_launch`
   ("Invalid Nonce"). The new app binds the nonce to the `state` (stored as the value of the
   `lti1p3-nonce-<nonce>` document) and consumes it at its first use.
4. **registration**: found by `iss` (+ `aud` as client id when the issuer has several
   clients); `aud` must equal the registration client id.
5. **signature**: platform public key from `key_set` or fetched from `key_set_url`
   (HTTP GET each launch, User-Agent `PyLTI1p3-client`, no cache); key chosen by header
   `kid` **and** `alg` (key `alg` defaults to RS256); `jwt.decode(id_token, pem,
   algorithms=[alg], options={"verify_aud": False})` — so `exp`/`nbf`/`iat` are verified
   by PyJWT (with no leeway) but `aud` is not.
6. **deployment**: `https://purl.imsglobal.org/spec/lti/claim/deployment_id` ∈
   `deployment_ids` of the registration.
7. **message**: `…/claim/message_type` handled by exactly one validator; common checks:
   `sub` non-empty, `…/claim/version == "1.3.0"`, `…/claim/roles` present (may be empty).
   `LtiResourceLinkRequest` needs `…/claim/resource_link.id`; `LtiDeepLinkingRequest`
   needs `…/lti-dl/claim/deep_linking_settings` with `accept_types ∋ "ltiResourceLink"`
   and non-empty `accept_presentation_document_targets`. `DataPrivacyLaunchRequest` and
   `LtiSubmissionReviewRequest` validate but INGInious then crashes (500).
8. **save**: `lti_launch` ← `{key: "lti1p3-launch-<uuid4>", value: <full JWT body>}` and
   `{key: "lti1p3-<state>-id-token-hash", value: md5hex(id_token)}`.

INGInious then reads (see LTI-09 for the full mapping): `sub`, `…/claim/roles`, `name`,
`given`(sic) / `family_name`, `email`, `…/claim/tool_platform.{name,description,url}`,
`…/claim/context.{context_title,context_label}` (sic — wrong keys, always `N/A`),
`…/claim/custom.{courseid,taskid,secret}` (resource launch; claim **required** → 500 if
absent). Response: `302 Location: /lti1.3/login?session_id=<sid>`.

---------------------------------------------------------------------------------------

## 6. LTI 1.3 — Deep Linking response

`POST /lti1.3/deeplink` (form `courseid`, `taskid`) returns **200 text/html**:

```html
<form id="lti13_deep_link_auto_submit" action="<deep_link_return_url>" method="POST"><input type="hidden" name="JWT" value="<jwt>" /></form><script type="text/javascript">document.getElementById('lti13_deep_link_auto_submit').submit();</script>
```

JWT: RS256 with the tool private key, header `{"alg":"RS256","kid":<thumbprint>,"typ":"JWT"}`;
claims (live run):

```json
{
  "iss": "<client_id>",
  "aud": ["<platform issuer>"],
  "exp": <iat+600>, "iat": <now>,
  "nonce": "nonce-<uuid4hex><uuid1hex>",
  "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "<deployment id of the launch>",
  "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiDeepLinkingResponse",
  "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
  "https://purl.imsglobal.org/spec/lti-dl/claim/content_items": [{
     "type": "ltiResourceLink",
     "title": "<task name in session language>",
     "url": "<external URL of /lti1.3/launch, query string stripped>",
     "custom": {"courseid": "<courseid>", "taskid": "<taskid>", "secret": "<lti_secrets[platform_instance_id]>"}
  }],
  "https://purl.imsglobal.org/spec/lti-dl/claim/data": <deep_linking_settings.data or null>
}
```

No `lineItem`, `icon` or presentation target is emitted. `kid` is the RFC 7638 JWK
SHA-256 thumbprint of the tool public key (jwcrypto default), e.g.
`jK_d5dBcK5F6t6kPomoP_SOl9rRHoIdTNLx7nN2oKD0`.

---------------------------------------------------------------------------------------

## 7. LTI 1.3 — JWKS

`GET /lti1.3/jwks/<keyset_hash>` (global) or `/lti1.3/jwks/<courseid>/<keyset_hash>`.
Response `200 application/json`, Flask `jsonify` (keys sorted, compact):

```json
{"keys":[{"alg":"RS256","e":"AQAB","kid":"<RFC7638 thumbprint>","kty":"RSA","n":"<base64url>","use":"sig"}]}
```

One key: the `public_key` of the client whose `md5(iss+client_id)` equals the hash.
Unknown hash or course → 404 (HTML page). A non-LTI course id is accepted (its config is
`{}` so only global clients match).

---------------------------------------------------------------------------------------

## 8. LTI 1.3 — Assignment and Grade Services (score publish)

Triggered after grading (see LTI-12). Steps, all via `requests` with
`User-Agent: PyLTI1p3-client`:

1. Rebuild launch from `lti_launch[key = message_launch_id].value` (no re-validation).
2. Skip silently (counted as failure) unless the AGS claim
   `https://purl.imsglobal.org/spec/lti-ags/claim/endpoint.scope` contains
   `https://purl.imsglobal.org/spec/lti-ags/scope/score`; missing AGS claim → exception →
   failure.
3. **Access token** (no caching across sends):
   `POST <auth_token_url>`, form-encoded:
   `grant_type=client_credentials&client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer&client_assertion=<jwt>&scope=<all scopes of the AGS claim joined by a space>`
   where the client assertion is RS256-signed with the tool private key,
   header `{"alg":"RS256","kid":"<thumbprint>","typ":"JWT"}`, claims
   `{"iss": client_id, "sub": client_id, "aud": auth_audience or auth_token_url,
   "iat": now-5, "exp": now+60, "jti": "lti-service-token-<uuid4>"}`.
   Response must be 2xx JSON with `access_token`.
4. **Score**: `POST <lineitem>/scores` (path suffix appended before the query string) with
   `Authorization: Bearer <token>`, `Accept: application/json`,
   `Content-Type: application/vnd.ims.lis.v1.score+json`, body (exact, `json.dumps`
   default separators, `None` fields omitted):

```json
{"scoreGiven": 100.0, "scoreMaximum": 100.0, "activityProgress": "Completed", "gradingProgress": "FullyGraded", "timestamp": "2026-10-14T05:39:26.731975+00:00", "userId": "plat-user-1"}
```

* `scoreGiven` = `user_tasks.grade` (0–100, **not clipped**), `scoreMaximum` = 100.0,
  `timestamp` = server local time ISO-8601 with microseconds and offset, `userId` = launch
  `sub`. No `comment`.
* `lineitem` comes from the AGS claim; if absent → exception → failure (INGInious never
  creates line items).
* Non-2xx → `LtiServiceException` → failure (logged with HTTP reason).

---------------------------------------------------------------------------------------

## 9. Cookieless session (`?session_id=`)

* LTI launch endpoints (`ltilaunchpage`, `lti1.3launchpage`) always create a **fresh**
  session document `{is_lti: true, ...}` (ignoring any cookie / `session_id`) and never
  send a session cookie.
* Every later request carries `?session_id=<24-hex ObjectId>` (added by a Flask
  `url_defaults` hook to every `url_for` while `session.is_lti`; the bind page gets
  `lti_session_id` instead).
* In the new app, `?session_id=` carries a signed token, is only honoured on LTI paths and
  only loads LTI sessions — see LTI-03.

---------------------------------------------------------------------------------------

## 10. MongoDB documents

| Collection | Document | Notes |
|---|---|---|
| `nonce` | `{_id, timestamp: Date, nonce: str, expiration: Date}` | unique index on `(timestamp, nonce)` (see db-schema.md §9), TTL on `expiration` |
| `lis_outcome_queue` | `{_id, courseid, taskid, username, nb_attempt: int, outcome_consumer_key, outcome_result_id, outcome_service_url}` | deleted on success / after 6 attempts |
| `lti_grade_queue` | `{_id, courseid, taskid, username, nb_attempt: int, message_launch_id}` | idem |
| `lti_launch` | `{_id, key: str, value: any}` | keys `lti1p3-nonce-<nonce>` → `true`, `lti1p3-launch-<uuid>` → JWT body, `lti1p3-<state>-id-token-hash` → md5 hex; never purged; model declares a required `context` list that is never written |
| `sessions` | `{…, is_lti: bool, lti: LTIData|null}` | see LTI-03 |
| `users` | `ltibindings: {"<courseid>/<consumer_key>" or "<platform_instance_id sans . $>": "<lms user id>"}` | LTI-04 |
| `submissions` | `lti_version: "1.1"|"1.3"`, `outcome_service_url`, `outcome_result_id`, `outcome_consumer_key` (1.1), `message_launch_id` (1.3) | only when grade passback is enabled |

---------------------------------------------------------------------------------------

## 11. Test harness used for this documentation

* Private legacy frontend `lti-frontend` (port 8093, config `infra/agent-configs/lti.yaml`
  with a global LTI 1.3 config and the `ltibestsubmission` plugin), private backend
  `lti-backend` + `lti-agent-mcq` (the shared backend had crashed).
* Mock LMS `lti-mock` (port 8094, `infra/agent-configs/lti-mock/mock_platform.py`):
  `/lti11start?…` builds and auto-posts a signed LTI 1.1 launch (oauthlib client, any
  param overridable, `__drop__` removes one, `json=1` returns the signed fields);
  `/start?msg=resource|deeplink&user=…&custom_courseid=…` initiates an LTI 1.3 OIDC login;
  `/auth` issues RS256 id_tokens (kid `platform-kid-1`); `/jwks`, `/token`,
  `/lineitems/1/lineitem/scores`, `/outcome` (LIS, `/outcome_fail` → 500), `/dlreturn`
  (decodes the deep-link JWT); `/log` returns every request received.
* Test fixtures: course `infra/tasks/lti_test` (MCQ tasks `mcq1`, `mcq2`; LTI 1.1 key
  `ltikey:ltisecret`; secret `s3cr3t` for `https://platform.example/tool-client-1/dep-1`),
  users `lti_student`, `lti_student2` (password `superadmin`).

Restart the harness (from `infra/`; containers were removed after the exploration):

```sh
docker run -d --name lti-backend --network inginious_default -e AGENT=tcp://0.0.0.0:2001 -e CLIENT=tcp://0.0.0.0:2000 inginious-local/core-backend:latest
docker run -d --name lti-agent-mcq --network inginious_default -e BACKEND=tcp://lti-backend:2001 -v "$PWD/tasks":/inginious/tasks -v /tmp/agent_data:/tmp/agent_data inginious-local/core-agent_mcq:latest
docker run -d --name lti-mock --network inginious_default -p 127.0.0.1:8094:8000 -v "$PWD/agent-configs/lti-mock":/mock:ro --entrypoint python3.14 inginious-local/core-frontend:latest -u /mock/mock_platform.py
docker run -d --name lti-frontend --network inginious_default -p 127.0.0.1:8093:8000 -e INGINIOUS_WEBAPP_HOST=0.0.0.0 \
  -v "$PWD/agent-configs/lti.yaml":/inginious/configuration.yaml:ro -v "$PWD/tasks":/inginious/tasks -v "$PWD/backups":/inginious/backups inginious-local/core-frontend:latest
# LTI 1.1 browser flow: open http://localhost:8094/lti11start ; LTI 1.3: http://localhost:8094/start?msg=resource&user=plat-user-1&custom_courseid=lti_test&custom_taskid=mcq1&custom_secret=s3cr3t
```

The RSA keys in `infra/agent-configs/lti-mock/*.pem` are throw-away test keys.
