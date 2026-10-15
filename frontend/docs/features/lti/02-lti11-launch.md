# LTI 1.1 basic launch

- **ID**: LTI-02
- **Actors**: LTI user (browser redirected by the LMS = Tool Consumer)
- **Routes**: POST /lti/<courseid>/<taskid> (GET → 405)
- **Depends on**: LTI-01 (consumer keys), LTI-03 (LTI session), LTI-04 (login/binding)
- **Legacy code**: `legacy/inginious/frontend/pages/lti/v1_1/__init__.py:25-207`
  (`LTIFlaskToolProvider`, `LTIValidator`, `LTI11LaunchPage`),
  `legacy/inginious/frontend/models/lti1_1.py:9-23` (`Nonce`),
  `legacy/inginious/frontend/models/session.py:12-35` (`LTIData`),
  `legacy/inginious/frontend/flask/mongo_sessions.py:39-46`,
  libraries `lti==0.9.5` (`ToolProvider`, `LaunchParams`), `oauthlib` (`SignatureOnlyEndpoint`)

## Use case
A student clicks an INGInious activity in their LMS. The LMS auto-submits an
OAuth1-signed form to INGInious. INGInious authenticates the *LMS* (shared secret),
records who the LMS user is and which task was requested, and redirects to the LTI login
step, which maps the LMS user to an INGInious account.

## Preconditions
- Course `<courseid>` exists, has `is_lti: true` and `lti_keys` contains the consumer key
  used by the LMS.
- If `lti_send_back_grade` is true, the LMS must send `lis_outcome_service_url` and
  `lis_result_sourcedid`.

## Main flow
Behaviour of the app (`app/src/lib/server/lti/lti11.ts`, `oauth1.ts`); legacy differences
are noted at the end of the section.
1. The current session of the request is replaced by a **brand-new** LTI session
   (`is_lti = true`); any cookie or `?session_id=` sent with the launch is not reused.
2. Course lookup; unknown course → 404.
3. Every received form field is kept, in order, as the list of signed parameters. Unknown
   parameters (including `custom_*` and `ext_*`) are accepted: they are covered by the
   signature.
4. OAuth 1.0a validation with `course.lti_keys()`: no duplicated `oauth_*` parameter,
   method HMAC-SHA1 or HMAC-SHA256, `oauth_version` absent or `1.0`, timestamp within
   ±600 s, nonce of 20–64 characters, known consumer key, and signature correct
   (constant-time comparison) over the parameters as received plus the query string, with
   the URL as seen by the LMS (reference §1.3). Then the `(nonce, timestamp)` pair is
   recorded in collection `nonce` under a unique index: a pair already used is refused.
5. On success read: `user_id` (required), `roles` (default "Student", split on `,`, each
   trimmed), realname (see below), `lis_person_contact_email_primary` (default ""),
   `lis_outcome_service_url`, `lis_result_sourcedid`, `oauth_consumer_key`,
   `tool_consumer_instance_name/description/url`, `context_title`, `context_label`
   (each default "N/A"). For a repeated field the first value wins.
6. If `course.lti_send_back_grade()`: both outcome params required, else 403 with
   "In order to send grade back to the TC, INGInious needs the parameters
   lis_outcome_service_url and lis_outcome_result_id in the LTI basic-launch-request.
   Please contact your administrator." Otherwise they are not stored.
7. `session.loggedin = false`; `session.lti = {version: "1.1", email, username: user_id,
   realname, roles, task: [courseid, taskid], outcome_service_url, outcome_result_id,
   consumer_key, context_title, context_label, tool_description, tool_name, tool_url,
   redir_url}` — `redir_url` is `/lti/task?session_id=<signed session token>` (LTI-03).
8. `302` to `/lti/login?session_id=<signed session token>` (no `Set-Cookie`).

Realname resolution: `lis_person_name_full`; else `lis_person_name_given + " " +
lis_person_name_family`; else `lis_person_contact_email_primary`; else family; else
given; else `user_id`.

The taskid in the URL is **not validated** at launch (an unknown task only fails later on
the task page with 404).

Legacy differences (functional): legacy rebuilt the request with the `lti` library, which
refused any non-LTI parameter name ("Error while parsing the LTI request"), injected
default values (e.g. `lti_version`) and re-serialised `roles` before checking the
signature, so some correctly signed launches were refused; it also limited consumer keys
to 1–30 characters and concatenated given and family names without a space.

## Alternative / error flows
- GET → 405 Method Not Allowed.
- Unknown course → 404 page.
- Wrong secret / unknown key / timestamp out of window / bad nonce length / signature
  method other than HMAC-SHA1 or HMAC-SHA256 (PLAINTEXT, RSA-SHA1) / reused nonce →
  **403 "Couldn't validate LTI request"**.
- Unknown parameters, `custom_*` and `ext_*` parameters are accepted (and ignored).
- Missing `user_id` → 400 "Missing parameter user_id.".
- Missing outcome params with grade passback on → 403 (message above).
- Replay of the exact same signed POST → 403 "Couldn't validate LTI request".

## UI elements
None (redirect only). Error pages are the generic `forbidden.html` / `notfound.html`
templates rendered in LTI layout (no navbar, "Powered by INGInious" footer).

## Data
- Writes `nonce` `{timestamp: Date(oauth_timestamp, server tz), nonce, expiration:
  timestamp + 10 min}` once the signature is verified; a unique index on
  `(nonce, timestamp)` makes each pair usable once, the TTL index on `expiration` purges
  old entries.
- Writes `sessions` document (see LTI-03) with `lti` sub-document, e.g. (live):
  ```js
  { _id: ObjectId("6acf1464cbe36596ebc49f34"), permanent: true, is_lti: true, loggedin: false,
    auth_storage: {}, expiration: ISODate(+24h), code_indentation: '4', language: 'en', timezone: 'Etc/UTC',
    lti: { version: '1.1', email: 'lmsuser1@lms.example', username: 'lms-user-1', realname: 'LMS User One',
      roles: ['Learner'], task: ['lti_test','mcq1'], redir_url: '/lti/task?session_id=6acf1464cbe36596ebc49f34',
      context_title: 'LMS course', context_label: 'C101', tool_description: 'Mock LMS 1.1', tool_name: 'MockLMS',
      tool_url: 'http://localhost:8094', consumer_key: 'ltikey',
      outcome_service_url: 'http://lti-mock:8000/outcome', outcome_result_id: 'sourcedid-1' } }
  ```
- Reads `course.yaml` (`is_lti`, `lti_keys`, `lti_send_back_grade`).

## Permissions & security
- Replays are refused: each `(nonce, timestamp)` pair is accepted once (unique index),
  the timestamp must be within ±600 s, and the nonce is only recorded after a valid
  signature.
- Only HMAC-SHA1 and HMAC-SHA256 signatures are accepted; the signature is compared in
  constant time.
- LMS-provided `roles` are stored but **never used**: an *Instructor* launch gets no
  privilege (no role→admin mapping). Course staff rights only come from the bound
  INGInious account.
- The signature base string uses the URL as seen by the LMS: `X-Forwarded-Proto` /
  `X-Forwarded-Host` are only honoured when `reverse-proxy-config.enable` is set
  (reference §1.2 point 3).
- The OAuth signature is the authenticator of the launch POST (the endpoint is exempt
  from the origin check of form POSTs).
- The launch redirects to a URL embedding the signed LTI session token (LTI-03).

## Acceptance tests
- Valid HMAC-SHA1 launch → 302 to `/lti/login?session_id=<signed session token>`, no Set-Cookie,
  session document as above.
- Same with HMAC-SHA256 → accepted. RSA-SHA1 → 403. PLAINTEXT → 403.
- Wrong secret, unknown key, stale timestamp (> 600 s), nonce of 10 chars
  → 403 "Couldn't validate LTI request".
- Replayed identical POST → 403.
- Unknown form field, `custom_x`/`ext_y` in a correctly signed request → accepted.
- `roles="Instructor, Learner"` signed by a standard OAuth library → accepted (signature
  verified over the raw received parameters).
- Missing `lti_version` / `lti_message_type` in a correctly signed request → accepted.
- Grade passback on and no `lis_outcome_service_url` → 403 with the exact message.
- Grade passback off → session `outcome_service_url`/`outcome_result_id` are absent even if
  sent.
- Realname fallbacks: full name; given + " " + family; email; family; given; user_id.
- GET → 405; unknown course → 404; missing `user_id` → 400.
