# MongoDB schema used by the legacy frontend

The new frontend must read and write **exactly** these documents. The data is shared with the legacy frontend, the WebDAV
server and the scripts (`inginious-database-update`). The backend and agents never touch MongoDB.

Sources: `legacy/inginious/frontend/models/*.py` (mongoengine 0.29.1 `Document`s), `legacy/inginious/scripts/database_update.py`,
`legacy/deploy/init-mongo.js`. The example documents below were dumped from the running reference stack
(`docker compose -f infra/compose.yml exec -T db mongosh INGInious`) after real actions in the UI.
pymongo 4.11 and MongoDB 6.0.2 were used.

## 0. General rules (mongoengine behaviour the rewrite must replicate)

| Topic | Behaviour |
|---|---|
| Connection | `connect(mongo_opt.database or "INGInious", host=mongo_opt.host or "localhost", tz_aware=True)` (`app.py:132`). The default DB name is `INGInious`. |
| No `_cls` | No model uses inheritance, so documents never contain `_cls`. |
| `_id` | `ObjectId` for every collection except `courses` (`_id` = course id string). |
| Defaults are persisted | When a document is **created** with `.save()`, mongoengine writes every field whose value is not `None`, **defaults included**, even `{}`, `[]`, `""`, `0`. A newly inserted `submissions` doc therefore already contains `response_type:"rst"`, `grade:0.0`, `custom:{}`, `problems:{}`, `result:"crash"`, `tests:{}`, `text:""`. Fields whose default is `None` are **omitted**. |
| Updates bypass validation | `QuerySet.update/modify/update_one(upsert)` write raw values without validation. Example: `submissions.problems` is declared `MapField(StringField())` but actually stores **arrays** `[result, feedback]`. `LaunchData.context` is "required" but never written. |
| Field order | mongoengine writes fields in model declaration order (see the examples). Order has no semantic meaning, but keep it for byte-level parity when convenient. |
| Dates (`DateTimeField`) | BSON `date` (UTC milliseconds). Python code always writes **timezone-aware** datetimes (`datetime.now(tz=timezone.utc)` or `datetime.now().astimezone()`), and pymongo converts them to UTC. With `tz_aware=True`, reads return aware UTC datetimes. Precision is truncated to milliseconds (the `@time` input string keeps microseconds, see §3.3). Before DB v18, `submitted_on` was stored as naive *local* time; migration 18 converted it. |
| Ints/floats | `IntField` → BSON int32 (`tried`, `tokens.amount`, `size`, `nb_attempt`, `ssh_port`). `FloatField` → BSON double (`grade`, `random[]`), **even for whole numbers** (`grade: 100` in mongosh is a double). The rewrite must write doubles (e.g. `new Double(100)` in the Node driver), otherwise `$type` checks or Python `float` comparisons may diverge. |
| ObjectId references | `submissions.input`, `submissions.archive` (GridFS file ids), `user_tasks.submissionid` (or `null`), `groups.audiences[]`. |
| Index creation | mongoengine creates the `meta.indexes` lazily the first time a collection is used by the app (`background: false`). The new server should create the same indexes at startup (idempotent `createIndex`). |
| QuerySet delete vs document delete | `Document.delete()` also deletes the GridFS files of `FileField`s. `QuerySet.delete()` (used almost everywhere: `_delete_exceeding_submissions`, `delete_user`, task wipe, `Submission.objects(...).delete()`) **does not**, so it leaves orphan `fs.files`/`fs.chunks`. Only `danger_zone.wipe_course` and the task-list wipe (`task_list.py:107`) delete input/archive explicitly. The rewrite should delete GridFS files with their submission (the cleanup is backwards compatible). |

### Collections overview

| Collection | Model | Purpose |
|---|---|---|
| `users` | `User` (`models/user.py`) | accounts |
| `sessions` | `Session` (`models/session.py`) | server-side HTTP sessions (also LTI sessions) |
| `submissions` | `Submission` (`models/submission.py`) | one doc per submission |
| `fs.files`, `fs.chunks` | GridFS (bucket `fs`) | submission `input` (BSON) and `archive` (tgz) |
| `user_tasks` | `UserTask` (`models/user_task.py`) | per user/task cache: tries, best/last grade, state, random inputs, tokens |
| `courses` | `CourseClass` (`models/course_class.py`) | list of registered students per course (course configuration itself is `course.yaml` on disk) |
| `audiences` | `Audience` | course audiences (formerly "classrooms"/"aggregations") |
| `groups` | `Group` | submission groups (teams) |
| `db_version` | `DBVersion` (`models/__init__.py`) | schema version, currently **20** |
| `nonce` | `Nonce` (`models/lti1_1.py`) | LTI 1.1 OAuth nonces (TTL) |
| `lis_outcome_queue` | `LISOutcome` | LTI 1.1 grade pass-back retry queue |
| `lti_grade_queue` | `LTIGrade` (`models/lti1_3.py`) | LTI 1.3 grade pass-back retry queue |
| `lti_launch` | `LaunchData` | pylti1p3 launch data cache (LTI 1.3) |

**Plugins have no collections of their own.** `contests`, `scoreboard`, `upcoming_tasks`, `ltibestsubmission` and the
auth plugins only read `submissions`, `user_tasks` and `users`. Contest/scoreboard configuration is stored in
`course.yaml`. The old `aggregations` collection exists only as the input of migration 15.

---

## 1. `users`

```python
class User(Document):
    username = StringField(required=True)
    realname = StringField(required=True)
    email = StringField(required=True)
    password = StringField()
    language = StringField(required=True, default="en")
    code_indentation = StringField(choices=["2", "3", "4", "tabs"], default="4")
    bindings = MapField(ListField())
    ltibindings = MapField(StringField())
    tos_accepted = BooleanField(default=False)
    apikey = StringField(default=None)
    timezone = StringField(default=lambda: tzlocal.get_localzone_name())
    pinned_courses = ListField(StringField(), default=list)
    activate = StringField()
    reset = StringField()
    meta = {"collection": "users", "indexes": ["username", "email"]}
```

| Field | BSON type | Default / presence | Meaning |
|---|---|---|---|
| `_id` | objectId | | |
| `username` | string | required. Can be `""` for users created by an auth plugin binding before they choose a username (`user_manager.py:319`). | login. Profile regex when set by the user: `^[-_\|~0-9A-Z]{4,}$` (case-insensitive, `preferences/profile.py`). Registration uses its own check (see AUTH feature docs). **Not unique-indexed.** Uniqueness is enforced in code only. |
| `realname` | string | required (may be `""`) | display name |
| `email` | string | required | lower-cased/sanitized by `UserManager.sanitize_email`. **Not unique-indexed.** Uniqueness is checked in code. Used as the key for several updates (`connect_user`, bindings). |
| `password` | string | absent for users that only have bindings | `"<method>-<hash>"`. `argon2id-$argon2id$v=19$m=65536,t=3,p=4$<salt b64>$<hash b64>` (argon2-cffi 23.1 defaults: m=64 MiB, t=3, p=4, 16-byte salt, 32-byte hash). Legacy forms: `sha512-<hex>` and **bare 128-hex sha512 without prefix** (`user_manager.py:137`: no `-` means sha512). Any other method raises `AuthInvalidMethodException`. Note that the bootstrap superadmin hash from `init-mongo.js` uses `p=1` with a fixed salt. |
| `language` | string | `"en"` | UI language code (one of `available_languages`) |
| `code_indentation` | string | `"4"` | `"2" \| "3" \| "4" \| "tabs"`. Absent on users created by `init-mongo.js` before v17 or by `create_user` in some paths. Treat as `"4"`. |
| `bindings` | object `{auth_id: [external_username, additional_dict]}` | `{}` | external auth bindings, e.g. `{github: ["12345", {}]}`. The value is a **2-element array**. |
| `ltibindings` | object `{"<courseid>/<consumer_key without . and $>": lti_user_id}` | absent or `{}` | LTI bindings. The key format has been `courseid/consumer` since migration 19. Queried with `ltibindings.<courseid>/<key>` (mongoengine `ltibindings__a/b`). |
| `tos_accepted` | bool | `false` (written on save) | terms of service accepted |
| `apikey` | string | absent until generated | 80 hex chars, `hexlify(os.urandom(40))`. Generated on demand by `get_user_api_key` (`user_manager.py:252`). |
| `timezone` | string | tz of the **server** at creation (`tzlocal`), e.g. `Etc/UTC` | IANA name |
| `pinned_courses` | array<string> | `[]` | course ids pinned in "My courses" (`$addToSet` / `$pull`) |
| `activate` | string | absent once activated | activation token (legacy: 128 hex chars). The new app writes `<64 hex chars from a CSPRNG>.<expiry in ms>` (valid 7 days) and only accepts tokens of that format that have not expired. Users with `activate` cannot log in (`auth_user` filters `activate__exists=False`). Removed by `$unset`. |
| `reset` | string | absent | password reset token (legacy: 128 hex chars; new app: same format as `activate`, valid one hour). `$unset` on use. |

Indexes: `{username:1}` (`username_1`), `{email:1}` (`email_1`). Both are non-unique, and both are also created by `init-mongo.js`.

Writers: `pages/register.py` (create with `activate`, `reset`), `user_manager.py` (`connect_user` updates `realname`,
`username`, `language` **matched by email**, bindings, `delete_user`, `create_user`, pin/unpin, `get_user_api_key`),
`pages/preferences/profile.py` (username, password, language, code_indentation, realname, timezone, tos_accepted),
`pages/preferences/bindings.py`, `pages/lti/*` (ltibindings), `pages/admin/admin.py` (superadmin user management),
`installer.py:564` (first superadmin).
Readers: virtually everything (`get_user_info`, `get_users_info`, search_user `$regex`, ...).

Example (registered user, after activation and profile edit):
```js
{
  _id: ObjectId("6acf1325204821330f4887d6"),
  username: 'auth_alice', realname: 'Alice', email: 'auth_alice@x.org',
  password: 'argon2id-$argon2id$v=19$m=65536,t=3,p=4$sQF20ebYMYcgsJoULynQuQ$m6lm9fmIxsKNlG/Gi2I0DIkxW6nAaIs9PFSHNDyMrzQ',
  bindings: {}, language: 'fr', code_indentation: 'tabs', tos_accepted: true, timezone: 'Europe/Brussels'
}
// freshly registered + activated user (mongoengine writes all defaults):
{ _id: ObjectId("6acf136db7639559a1fdd99c"), username: 'auth_r', realname: '', email: 'Auth_R@x.org',
  password: 'argon2id-$argon2id$v=19$m=65536,t=3,p=4$...', language: 'en', code_indentation: '4',
  bindings: {}, ltibindings: {}, tos_accepted: true, timezone: 'Etc/UTC', pinned_courses: [] }
// bound via an OAuth plugin
{ _id: ObjectId("6acf139578d0c64e80900893"), username: 'nav_dave', ..., bindings: { github: [ '12345', {} ] } }
// superadmin created by init-mongo.js, apikey generated later
{ _id: ObjectId("6acf10c1e66c45e19d6de4d6"), username: 'superadmin', realname: 'INGInious superadmin',
  email: 'superadmin@inginious.org', password: 'argon2id-$argon2id$v=19$m=65536,t=3,p=1$QVNVUEVSU0VDVVJFU0FMVA$NpeS...',
  bindings: {}, language: 'en', code_indentation: '4',
  apikey: '377f8cfdcc8f42bdbb7a934c83928421a56a9218653dda1a81e3d2b2fbbd136cb90754078a694238' }
// legacy hashes still accepted:
{ username: 'auth_sha',  password: '348735696e74c45e...71e' }          // bare sha512 hex
{ username: 'auth_sha2', password: 'sha512-348735696e74c45e...71e' }   // prefixed sha512
```

Superadmins are **not** stored in the DB. They come from the `superadmins` list in `configuration.yaml`.

---

## 2. `sessions` and the session cookie

```python
class LTIData(EmbeddedDocument):
    version = StringField(required=True, default="")        # "1.1" | "1.3"
    email = StringField(required=True, default="")
    username = StringField(required=True, default="")       # LTI user_id
    realname = StringField(required=True, default="")
    roles = ListField(StringField())
    task = ListField(StringField(), required=True, default=lambda: ['', ''])   # [courseid, taskid]
    redir_url = StringField(required=True, default="")
    context_title, context_label, tool_description, tool_name, tool_url = StringField()
    consumer_key, outcome_service_url, outcome_result_id = StringField()        # LTI 1.1
    message_launch_id, platform_instance_id, course_secret = StringField()     # LTI 1.3

class Session(Document):
    id = ObjectIdField(primary_key=True, default=lambda: ObjectId())
    permanent = BooleanField(required=True)
    is_lti = BooleanField(required=True, default=False)
    loggedin = BooleanField(required=True, default=False)
    auth_storage = MapField(DynamicField(), default=dict)
    expiration = DateTimeField()
    lti = EmbeddedDocumentField(LTIData, default=None)
    code_indentation = StringField(choices=["2", "3", "4", "tabs"], default="4")
    email = StringField()
    language = StringField(default="")
    realname = StringField()
    token = StringField(default=None)
    tos_signed = BooleanField()
    username = StringField(default=None)
    timezone = StringField(default=lambda: tzlocal.get_localzone_name())
    meta = {"collection": "sessions", "indexes": [{'fields': ['expiration'], 'expireAfterSeconds': 0}]}
```

| Field | Type | Notes |
|---|---|---|
| `_id` | objectId | the session id (it appears in the cookie and in `?session_id=` for LTI) |
| `permanent` | bool | always `true` |
| `is_lti` | bool | `true` for sessions created by the LTI launch endpoints (`LTI11LaunchPage`, `LTI13LaunchPage`) |
| `loggedin` | bool | |
| `auth_storage` | object `{auth_id: {...}}` | per auth plugin scratch space: `{"<auth_id>": {"redir_url": "<referrer>", "oauth_state": "..."}}` (`pages/social.py`, OAuth plugins, SAML `RelayState`, LDAP) |
| `expiration` | date | now + `session_parameters.timeout` (default 86400 s). **Refreshed on every request** (sliding). TTL index `expireAfterSeconds: 0`. |
| `lti` | embedded `LTIData` or absent | set by the LTI launch (`pages/lti/v1_1/__init__.py:165`, `v1_3/__init__.py:152`) |
| `code_indentation` | string | copied from the user at login |
| `email`, `realname`, `username` | string | copied at login (`user_manager.connect_user`). `username` may be `""` for binding-only users |
| `language` | string | `""` until detected/selected, then e.g. `"en"`. Logged-in users get `user.language`. |
| `token` | string/null | set to `None` at login, so the field is omitted |
| `tos_signed` | bool | from `user.tos_accepted` |
| `timezone` | string | server tz by default, user tz after login |

Index: `{expiration:1}` TTL (`expireAfterSeconds: 0`). Migration 20 drops all session indexes (the old Flask-Session index),
and mongoengine recreates this one.

**Lifecycle** (`flask/mongo_sessions.py`):
* `open_session`: if the URL endpoint is an LTI launch, a **new** LTI session is created (`is_lti=True`). Otherwise the
  sid is taken from `?session_id=` (LTI sessions, which travel in the URL) or from the signed cookie. A missing or invalid
  signature gives a new empty `Session`. An expired document (`expiration <= now`) is deleted and replaced by a new one.
* `save_session` is called on **every response, including anonymous ones and static files**: it sets
  `expiration = now + PERMANENT_SESSION_LIFETIME` and calls `session.save()`, which inserts a new document for each
  cookie-less request.
  It then sets the cookie, except for LTI sessions, which travel in the URL (`?session_id=<sid>`, added to every
  `url_for` by `app.py:189`; `lti_session_id` for the bind pages).
* Logout sets `loggedin=False`. The new app rotates the session id at login (see §11).

**Cookie format** (verified with curl):
```
Set-Cookie: inginious_session_id=6acf1358d379057911ec072b.mxF-y1aYONkhwCOKetR3dcmk01Y; Expires=Thu, 15 Oct 2026 05:30:00 GMT; HttpOnly; Path=/
```
* name: `session_parameters.cookie_name` (default `inginious_session_id`)
* value: `<24-hex ObjectId>.<signature>`, i.e. itsdangerous `Signer(secret_key, salt='flask-session', key_derivation='hmac')`
  with the default digest SHA-1:
  `key = HMAC_SHA1(secret_key, "flask-session")`, `sig = base64url_nopad(HMAC_SHA1(key, sid))`
  (verified against itsdangerous 2.2.0 with a dummy key). The new app uses its own signature,
  `<24-hex ObjectId>.<base64url_nopad(HMAC_SHA256(secret_key, sid))>`, checked in constant time, so a cookie issued by
  one frontend is not reused by the other.
* attributes: `Expires` = session expiration, `HttpOnly` (`session_parameters.httponly`, default true), `Secure` if
  `session_parameters.secure`, `Domain`/`Path` from `cookie_domain`/`cookie_path` (default `/`). The new app also sets
  `SameSite` from `session_parameters.samesite` (default `Lax`).

Examples:
```js
// anonymous
{ _id: ObjectId("6acf10c3f60e824c915c816b"), permanent: true, is_lti: false, loggedin: false, auth_storage: {},
  expiration: ISODate("2026-10-15T05:18:59.958Z"), code_indentation: '4', language: 'en', timezone: 'Etc/UTC' }
// logged in
{ _id: ObjectId("6acf137fd379057911ec0737"), permanent: true, is_lti: false, loggedin: true, auth_storage: {},
  expiration: ISODate("2026-10-15T05:31:10.162Z"), code_indentation: '4', email: 'superadmin@inginious.org',
  language: 'en', realname: 'INGInious superadmin', tos_signed: false, username: 'superadmin', timezone: 'Etc/UTC' }
// LTI (shape from the code)
{ _id: ObjectId(...), permanent: true, is_lti: true, loggedin: true, auth_storage: {}, expiration: ISODate(...),
  lti: { version: '1.1', email: '...', username: '<lti user_id>', realname: '...', roles: ['Learner'],
         task: ['courseid', 'taskid'], redir_url: '/lti/task', context_title: '...', context_label: '...',
         tool_description: '...', tool_name: '...', tool_url: '...', consumer_key: '...',
         outcome_service_url: '...', outcome_result_id: '...' }, username: 'jdoe', ... }
```
Sharing sessions between the legacy and the new frontend is possible only if both use the same secret key and cookie name.
This is not required, but the rewrite must keep the collection valid (or use its own collection).

---

## 3. `submissions` (+ GridFS)

```python
class Submission(Document):
    courseid = StringField(required=True)
    taskid = StringField(required=True)
    username = ListField(StringField(), required=True)
    input = FileField(required=True)          # GridFS id
    archive = FileField()                     # GridFS id
    status = StringField(choices=["done", "error", "waiting"], required=True)
    submitted_on = DateTimeField(required=True)
    response_type = StringField(default='rst') # Deprecated
    grade = FloatField(default=0.0)
    custom = DictField()
    problems = MapField(StringField())        # really {pid: [result, feedback]}
    result = StringField(default="crash")
    stderr = StringField(); stdout = StringField()
    tests = MapField(StringField())           # really {tag: any}
    text = StringField(default="")
    user_ip = StringField()
    state = StringField()
    jobid = StringField()
    ssh_host = StringField(); ssh_port = IntField(); ssh_user = StringField(); ssh_password = StringField()
    last_replay = DateTimeField()
    lti_version = StringField()
    message_launch_id = StringField()                                  # LTI 1.3
    outcome_service_url = StringField(); outcome_result_id = StringField(); outcome_consumer_key = StringField()  # LTI 1.1
    meta = {"collection": "submissions",
            "indexes": ["username", "courseid", ("courseid", "taskid"), "-submitted_on", "status"]}
```

| Field | Type | Written by | Notes |
|---|---|---|---|
| `_id` | objectId | insert | the submission id shown in the UI |
| `courseid`, `taskid` | string | insert | `courseid` is rewritten to `<courseid>_archive_<YYYY_MM_DD_HH_MM_SS>` by the danger zone "archive course" |
| `username` | array<string> | insert | one user, or **all group members** for group tasks submitted by a non-staff user (`_before_submission_insertion`) |
| `input` | objectId → GridFS | insert | see §3.1 |
| `status` | string | `"waiting"` → `"done"` (result success/failed) or `"error"` (any other result) | |
| `submitted_on` | date | `datetime.now(tz=utc)` | replay-with-copy uses `datetime.now().astimezone()` |
| `response_type` | string | default `"rst"` | deprecated, always `rst` |
| `grade` | double | default `0.0`, then the job grade | 0..100 (may exceed 100 if the grader says so) |
| `custom` | object | default `{}`, then the job `custom` | free-form from the grader |
| `problems` | object `{pid: [result, feedback_rst]}` | default `{}`, then the job `problems` | **array of 2 strings** (msgpack tuple). Old-style: `{pid: "feedback"}` string, handled by `get_feedback_from_submission` |
| `result` | string | default `"crash"` (present **while waiting**!), then `success\|failed\|timeout\|overflow\|crash\|killed\|error` | |
| `tests` | object | default `{}`, then the job `tests` | tag id → value (usually bool) |
| `text` | string | default `""`, then the main feedback (raw RST) | rendered with RST at display time |
| `user_ip` | string | insert, `request.remote_addr` | IP of the proxy if behind a reverse proxy (no ProxyFix) |
| `state` | string | job done | the new task state (also copied to `user_tasks.state`) |
| `stdout`, `stderr` | string **or null** | job done | `null` for mcq jobs, `""` for docker |
| `archive` | objectId → GridFS | job done, when the grader returned an archive | tgz (§3.2) |
| `jobid` | string (uuid4) | set right after `new_job`, `$unset` on job done | **May end up `null`**: if the client calls the callback synchronously (environment not available), the `$unset` happens before `update(jobid=None)`, which leaves `jobid: null` (observed). The kill action tests `"jobid" in submission`. |
| `ssh_host`, `ssh_port`(int), `ssh_user`, `ssh_password` | | `_handle_ssh_callback` when `BackendJobSSHDebug` arrives | `$unset` on job done |
| `last_replay` | date | `replay_job` | |
| `lti_version` | string | insert, when the session is LTI and the course has `lti_send_back_grade` | `"1.1"` / `"1.3"` |
| `outcome_service_url`, `outcome_result_id`, `outcome_consumer_key` | string | insert (LTI 1.1 tag) | from `session.lti` (`consumer_key` → `outcome_consumer_key`) |
| `message_launch_id` | string | insert (LTI 1.3 tag) | |

Indexes: `username_1`, `courseid_1`, `courseid_1_taskid_1`, `submitted_on_-1`, `status_1`.

Plugins can add arbitrary top-level fields through the `new_submission` hook (`plugin_manager.call_hook("new_submission", submission=obj, inputdata=inputdata)`,
`submission_manager.py:465`), as well as input fields.

**Lifecycle**:
1. `add_job` (`submission_manager.py:423`). It refuses if a `waiting` submission exists for (course, task, username) and inserts:
   `{courseid, taskid, username:[u], input:<gridfs id>, status:"waiting", submitted_on, response_type:"rst", grade:0.0,
   custom:{}, problems:{}, result:"crash", tests:{}, text:"", user_ip [, lti fields]}`.
   Then `_delete_exceeding_submissions` (when the task dispenser's `no_stored_submissions` > 0) keeps the evaluation
   submission, the waiting ones and the N most recent ones, and deletes the others with `QuerySet.delete()` (orphan GridFS).
   Then `ClientNewJob` and `update(jobid=…)`.
2. Job done (`_job_done_callback`). It puts the archive in GridFS, then
   `modify(status, result, grade, text, tests, problems, custom, state, stdout, stderr, $unset jobid/ssh_*)`.
   On `DocumentTooLarge` (16 MB): `status:"error"`, `text:"Maximum submission size exceeded. Check feedback, stdout, stderr and state."`, `grade:0.0`.
   It then updates `user_tasks` for every username (§4), calls the `submission_done` hook and the LTI publisher (§9).
3. At **startup** every `waiting` submission becomes
   `{status:"error", grade:0.0, text:"Internal error. Server restarted", $unset jobid}` (`submission_manager.py:51`).
   **Warning for side-by-side runs:** if two frontends share a DB, starting one of them marks the other's running jobs as errored.
4. Replay (`replay_job`): in place (deletes the archive file, `$unset` result/grade/text/tests/problems/archive/state/custom,
   `status:"waiting"`, new `jobid`, `last_replay`), or as a copy for the current admin (new submission, with `@attempts`, `@username`,
   `@email`, `@lang` refreshed, priority 1).

Example: MCQ submission (task `tutorial/02_courses`), as stored:
```js
{
  _id: ObjectId("6acf1374d379057911ec0736"), courseid: 'tutorial', taskid: '02_courses', username: [ 'superadmin' ],
  input: ObjectId("6acf1374d379057911ec0734"), status: 'done', submitted_on: ISODate("2026-10-14T05:30:28.426Z"),
  response_type: 'rst', grade: 50.0, custom: {},
  problems: {
    q2: [ 'failed', 'Wrong answer\n\nStudents can not create groups. You have to create groups to allow students to populate them. ...' ],
    q4: [ 'failed', 'The statistics pages offer more possibilities.' ]
  },
  result: 'failed', tests: {},
  text: 'You have 2 wrong answer(s).\n\n\nAmong them, you have 3 invalid answers in the multiple choice questions',
  user_ip: '172.19.0.1', state: '{"q1": "", "q2": "", "q3": "", "q4": ""}', stderr: null, stdout: null
}
```
Docker submission with a file upload (task `tutorial/05_fetching_input`):
```js
{
  _id: ObjectId("6acf1381d379057911ec073a"), courseid: 'tutorial', taskid: '05_fetching_input', username: ['superadmin'],
  input: ObjectId("6acf1381d379057911ec0738"), status: 'done', submitted_on: ISODate("2026-10-14T05:30:41.617Z"),
  response_type: 'rst', grade: 100.0, custom: {}, problems: {}, result: 'success', tests: {},
  text: 'Your code ran correctly. Here is the output :\n\n\n\n.. code-block:: \n\n\thi\n\n\n',
  user_ip: '172.19.0.1', archive: ObjectId("6acf1382d379057911ec073b"), state: '', stderr: '', stdout: ''
}
```
Submission made while the backend was down ("Environment not available", note `jobid: null`):
```js
{ _id: ObjectId("6acf1484d379057911ec0818"), courseid: 'tutorial', taskid: '02_courses', username: ['superadmin'],
  input: ObjectId("6acf1484d379057911ec0816"), status: 'error', submitted_on: ISODate("2026-10-14T05:35:00.157Z"),
  response_type: 'rst', grade: 0, custom: {}, problems: {}, result: 'crash', tests: {},
  text: 'Environment not available.', user_ip: '172.19.0.1', state: '', stderr: '', stdout: '', jobid: null }
```

### 3.1 `input`: GridFS file containing a BSON document

* Written with `submission.input.put(bson.BSON.encode(inputdata))` (`models/submission.py:46`) and read with
  `bson.BSON.decode(submission.input.read())`. The GridFS file content is **one raw BSON document** (not JSON, not
  compressed). It was JSON before migration 14, and older DBs could hold the dict inline.
* The `fs.files` doc is minimal: `{_id, chunkSize: 261120, length: <int64>, uploadDate: <date>}`. There is **no
  filename, contentType, md5 or metadata**. `fs.chunks`: `{_id, files_id, n, data: BinData(0)}`. A 255 KiB chunk size is
  the pymongo default. The Node driver's `GridFSBucket` (bucket name `fs`, default chunkSizeBytes 255*1024) is compatible:
  it adds `filename`, which is harmless.
* GridFS indexes (created by pymongo on first write): `fs.files {filename:1, uploadDate:1}`, `fs.chunks {files_id:1, n:1} unique`.

Content of the input dict (`pages/tasks.py:152-227` + `submission_manager.add_job`), in this key order:
1. **All posted form fields** (`request.form.to_dict()`, first value of each key) **except** `@action` and `@debug-mode`,
   which are deleted. Unknown extra fields are kept: posting `extra_field=hello` stored `"extra_field": "hello"`. That includes
   `@random_<i>` fields when the task uses random inputs (string values).
2. Each problem id, replaced by its typed value:
   * `input_type() == str` (code, code_single_line, single-choice multiple_choice, match, ...): `request.form.get(pid)`
     → **string** (or `null` if absent, and then `input_is_consistent` rejects it unless the problem is optional).
   * `input_type() == list` (multiple_choice with `multiple: true`): `form.getlist(pid)` → **array of strings** (choice
     indexes as strings, e.g. `["0","2"]`).
   * `input_type() == dict` (file): `{"filename": <original filename string>, "value": <BinData subtype 0 with the raw
     bytes>}`. A missing file gives `{}`. Validation: the extension must end with one of `allowed_exts` (problem) or
     `allowed_file_extensions` (config), and `sys.getsizeof(bytes)` (= len + 33) must be ≤ `max_size` or `max_file_size`.
3. Keys added by the frontend: `@username` (string; for group submissions **comma-joined usernames**), `@email` (string;
   comma-joined for groups), `@lang` (`user.language`), `@time` (`str(datetime.now(tz=utc))`, e.g.
   `"2026-10-14 05:30:28.426736+00:00"`, microseconds), `@attempts` (`str(user_task.tried + 1)`), `@random` (array of
   doubles = `user_tasks.random`), `@state` (`user_tasks.state`). Plugins (`new_submission` hook) may add more. If a problem
   is called `group`, the group `@username`/`@email` override is skipped.

Real decoded examples (`bson.decode` of the GridFS content):
```python
# 02_courses (mcq), raw bytes start: fa000000 02 7131 00 02000000 3100 ...
{'q1': '1', 'q2': '2', 'q3': '1', 'q4': ['0', '2'], 'extra_field': 'hello',
 '@username': 'superadmin', '@email': 'superadmin@inginious.org', '@lang': 'en',
 '@time': '2026-10-14 05:30:28.426736+00:00', '@attempts': '1', '@random': [], '@state': ''}
# 05_fetching_input (file + code), 302 bytes
{'studentcode': 'print("hi")', 'thecode': '#!/bin/bash\necho hi',
 'studentupload': {'filename': 'myfile.txt', 'value': b'hello\x00\xffworld\n'},   # BinData(0)
 '@username': 'superadmin', '@email': 'superadmin@inginious.org', '@lang': 'en',
 '@time': '2026-10-14 05:30:41.617417+00:00', '@attempts': '1', '@random': [], '@state': ''}
```
The **same dict** (with `bytes` → msgpack `bin`) is sent as `inputdata` in `ClientNewJob` (see backend-protocol.md).
With the Node `bson` package, `BSON.serialize(obj)` / `BSON.deserialize(buf, {promoteBuffers: true})` round-trips this
format. Use `Binary` (subtype 0) for file values and `Double` for `@random` entries.

Readers of the input: task page "load previous submission" (`@action=load_submission_input`; file values are blanked to `""`
in the JSON), file download of a submitted file (`GET /course/<c>/<t>?submissionid=..&questionid=..`, `pages/tasks.py:84-111`),
admin submission view, the submission archive download (`get_submission_archive`: files go to `uploaded_files/<pid><ext>`),
replay, and the API (`pages/api/submissions.py`).

### 3.2 `archive`: GridFS file containing a gzip'ed tar

* Written with `submission.archive.put(archive_bytes)` when `BackendJobDone.archive` is not null (`submission_manager.py:61`).
  It holds the raw bytes received from the backend: a **tar.gz** produced by the agent (`archive.tgz`, gzip magic `1f8b0808`,
  and an empty job gives a 189-190 byte archive containing a single directory member `''`). Grader files written to `/archive` in
  the container end up there.
* `fs.files` has the same minimal shape as for input. It is deleted on in-place replay and on course wipe, and is orphaned otherwise.
* It is embedded in the admin "download submissions" tgz under `<path>/archive/<member>`, together with
  `<path>/submission.test` (YAML dump of `submission.to_mongo()` with the input as ObjectId) and `<path>/uploaded_files/<pid><ext>`.

---

## 4. `user_tasks`

```python
class Tokens(EmbeddedDocument):
    amount = IntField(required=True, default=0)
    date = DateTimeField(default=datetime.fromtimestamp(0).astimezone())
class UserTask(Document):
    courseid, taskid, username = StringField(required=True)
    grade = FloatField(required=True, default=0)
    submissionid = ObjectIdField(null=True, default=None)
    succeeded = BooleanField(required=True, default=False)
    tried = IntField(required=True, default=0)
    random = ListField(FloatField(), default=[])
    tokens = EmbeddedDocumentField(Tokens, default=lambda : Tokens())
    state = StringField(required=True, default="")
```
| Field | Type | Notes |
|---|---|---|
| `courseid`, `taskid`, `username` | string | unique triple (`username_1_courseid_1_taskid_1`, unique) |
| `grade` | double | grade of the evaluation submission |
| `submissionid` | objectId or **null** | the evaluation submission ("best" or "last" depending on the task's `evaluate`) |
| `succeeded` | bool | evaluation submission result == `success` |
| `tried` | int32 | number of completed **new** submissions (incremented at job done, not at submit) |
| `random` | array<double> | random inputs generated at each task page view: `random.seed(username+taskid+courseid[+time()])`, `[random.random() for i in range(input_random)]` (`pages/tasks.py:112-119`). The rewrite cannot reproduce Python's Mersenne Twister seeding byte for byte; parity of the exact values is not needed, only the semantics (stable per user unless `regenerate_input_random`). |
| `tokens` | `{amount: int32, date?: date}` | submission-limit tokens. Usually **only `amount`** is present: the upsert never writes `tokens`, and `$inc tokens.amount` creates `{amount: N}`. `date` appears after `reset_tokens()` (`datetime.now().astimezone()`). A missing `date` means epoch. Docs that were never submitted have **no `tokens` field**. |
| `state` | string | task state returned by the grader (copied from the evaluation submission). The admin can reset it to `""`. |

Indexes: `{username,courseid,taskid}` unique, `{username,courseid}`, `{courseid,taskid}`, `{courseid}`, `{username}`.

Writes:
* `user_saw_task` (each task page view and each submit POST): `update_one(upsert, $setOnInsert {username, courseid, taskid, tried:0,
  succeeded:false, grade:0.0, submissionid:null, state:""})`. Field order in the inserted doc: query fields first
  (`courseid, taskid, username`) then the `$setOnInsert` fields. `random:[]` comes from the immediately following
  `modify(set__random=...)` on the GET.
* `update_user_stats` at job done for a new submission: `modify($inc {tried:1, "tokens.amount":1})`, then, if
  `evaluate == "last"` or (`best` and `old.grade <= grade`), it sets `succeeded`, `grade`, `state`, `submissionid` with `save()`
  (full document save). For a replay (`newsub=False`) it recomputes from the best/last submission.
* Admin reset of the state (`student_info.py:26`), and deletes (course wipe, task wipe, user delete). Archive renames `courseid`.

Examples:
```js
{ _id: ObjectId("6acf136f9613ae6adab59674"), courseid: 'tutorial', taskid: '02_courses', username: 'superadmin',
  grade: 50.0, state: '{"q1": "", "q2": "", "q3": "", "q4": ""}', submissionid: ObjectId("6acf1374d379057911ec0736"),
  succeeded: false, tried: 1, random: [], tokens: { amount: 1 } }
// seen but never submitted
{ _id: ObjectId("6acf13a59613ae6adab59b40"), courseid: 'cstu_course', taskid: '03_tasks', username: 'cstu_bob',
  grade: 0.0, state: '', submissionid: null, succeeded: false, tried: 0, random: [] }
```
(The key order shown by mongosh, `grade, state, submissionid, succeeded, tried, random, tokens`, comes from the
`save()`/`$set` sequence.)

---

## 5. `courses` (registrations only)

```python
class CourseClass(Document):
    id = StringField(primary_key=True)     # _id = course id
    students = ListField(StringField())
    meta = {"collection": "courses"}
```
* `_id`: course id (string). `students`: array of usernames registered as students. Staff (admins/tutors from
  `course.yaml`) and superadmins are **never** stored here. They count as registered implicitly.
* Created lazily: `update(push__students=u, upsert=True)` on registration (`user_manager.py:668`), so no doc exists for
  courses nobody registered to. `$pull` on unregister. The admin "student list" page replaces the whole array. Wipe sets `[]`.
  Archive moves the doc to the new `_id`. **`$push` is not `$addToSet`**: duplicates are prevented by a prior check only.
* No secondary index. Queried by `{_id, students: username}`.

```js
{ _id: 'tutorial', students: [ 'core_dbuser' ] }
{ _id: 'cstu_course', students: [ 'cstu_eve', 'cstu_bob', 'cstu_carl', 'cstu_dan' ] }
```

## 6. `audiences`

```python
class Audience(Document):
    description = StringField(required=True)
    courseid = StringField(required=True)
    students = ListField(StringField())
    tutors = ListField(StringField())
    meta = {"collection": "audiences", "indexes": ["courseid"]}
```
```js
{ _id: ObjectId("6acf13acd379057911ec0778"), description: 'Group A', courseid: 'cstu_course',
  students: [ 'cstu_eve', 'cstu_bob' ], tutors: [ 'cstu_tutor' ] }
```
Writers: `course_admin/student_list.py` (create with `students:[], tutors:[]`, YAML/CSV upload, delete),
`course_admin/audience_edit.py` (update description/students/tutors), unregister (`$pull students`), wipe/archive.
Index `courseid_1`.

## 7. `groups`

```python
class Group(Document):
    description = StringField(required=True)
    courseid = StringField(required=True)
    size = IntField(required=True)
    students = ListField(StringField())
    audiences = ListField(ObjectIdField())   # restrict membership to these audiences ([] = anyone)
    meta = {"collection": "groups", "indexes": ["courseid"]}
```
```js
{ _id: ObjectId("6acf139578d0c64e80900898"), description: 'Group B (TP1 only)', courseid: 'navopen', size: 1,
  students: [], audiences: [ ObjectId("6acf139578d0c64e80900896") ] }
```
Writers: `course_admin/student_list.py` (create/edit/delete, group upload), `pages/group.py` (student self-registration:
atomic `modify` with a condition on the size, see GROUP feature docs), unregister (`$pull`). A student must be in at most one group
per course (enforced in code).

## 8. `db_version`

```js
{ _id: ObjectId("6acf10c3f60e824c915c816a"), db_version: 20 }
```
At startup (`app.py:135`): `DBVersion.objects(db_version__exists=True).first() or DBVersion().save()`. So **an empty DB is
initialised at the current version (20)**. If the version is ≠ `DB_VERSION` (20, `inginious/__init__.py`), the frontend refuses to
start ("Please update the database before running INGInious"). The rewrite must do the same check (and also insert `{db_version: 20}` on an empty DB).

Migrations (`inginious/scripts/database_update.py`, run with `inginious-database-update`):

| To | Change |
|---|---|
| <12 | unsupported (pre v0.4) |
| 13 | `nonce` unique index `{timestamp, nonce}` + TTL index on `expiration` |
| 14 | submission input moved to GridFS as **BSON** (was JSON in GridFS or inline). File values base64-decoded into binary |
| 15 | `aggregations` → `audiences` + `groups` (+ `courses.students`) |
| 16 | index `submissions.status` |
| 17 | `users.code_indentation = "4"` for all |
| 18 | `submitted_on` converted from "naive local time stored as UTC" to real UTC (`$dateToParts` UTC → `$dateFromParts` with the server tz) |
| 19 | `ltibindings` flattened from `{course: {consumer: user}}` to `{"course/consumer": user}` |
| 20 | `sessions.drop_indexes()` (old Flask-Session indexes) |

## 9. LTI collections

### `nonce` (LTI 1.1, `models/lti1_1.py`)
`{_id, timestamp: date, nonce: string, expiration: date}`. One doc is inserted per validated LTI 1.1 launch
(`pages/lti/v1_1/__init__.py:38-43`, `Nonce(timestamp=fromtimestamp(ts).astimezone(), nonce, expiration=timestamp+10 min).save()`).
Replay protection relies on a **unique index** on `(timestamp, nonce)` (migration 13 creates `{timestamp:1, nonce:1}`
unique; the mongoengine model declares a `(timestamp, nonce)` index plus TTL `expiration`). The rewrite creates a unique
`{nonce:1, timestamp:1}` index, so a (nonce, timestamp) pair is accepted only once; launches whose timestamp is outside
the accepted window are refused, and nonces must be 20-64 chars long.
The collection does not exist until the first LTI 1.1 launch.

### `lis_outcome_queue` (LTI 1.1) / `lti_grade_queue` (LTI 1.3)
```js
// lis_outcome_queue
{ _id, courseid, taskid, username, nb_attempt: int32, outcome_consumer_key, outcome_result_id, outcome_service_url }
// lti_grade_queue
{ _id, courseid, taskid, username, nb_attempt: int32, message_launch_id }
```
`LTIScorePublisher.add` (`lti/__init__.py:69`) runs at job done for submissions carrying `lti_version`: for each username,
`modify(upsert, nb_attempt=0)` keyed by `{username, courseid, taskid, <tag fields>}`, and the entry goes into an in-memory queue.
A background thread (`LTIScorePublisher._loop`) sends the user's **current `user_tasks.grade`** (not the submission's)
and deletes the doc on success. On failure it retries up to 5 times (`nb_attempt` += 1), then deletes it. At startup every queued doc is
reloaded.

### `lti_launch` (LTI 1.3, pylti1p3 cache, `lti/v1_3/__init__.py:44-59`)
`{_id, key: string, value: any}`. Upsert by `key` (`LaunchData.objects(key=key).update(key, value, upsert=True)`). The `context` field
declared in the model is never written. It stores the pylti1p3 launch data (`MongoLaunchDataCache`) so that grades can be sent later (`MongoLTILaunchDataStorage`, `can_set_keys_expiration()` returns False).
There is no TTL.

---

## 10. Who reads/writes what (cross reference)

| Code | users | sessions | submissions/GridFS | user_tasks | courses | audiences | groups |
|---|---|---|---|---|---|---|---|
| `flask/mongo_sessions.py` | | R/W every request | | | | | |
| `user_manager.py` | R/W | via `flask.session` | delete (user) | R/W | R/W | `$pull` | R, `$pull` |
| `submission_manager.py` | R | R (lti) | R/W, GridFS put | R | | R | R |
| `pages/tasks.py` | | | R (+GridFS read) | R/W (random, saw) | | | R |
| `pages/course.py`, `mycourses.py`, `courselist.py` | R (pinned) | | R (last submissions aggregate) | R | R | | |
| `pages/group.py` | | | | | | R | R/W |
| `pages/register.py`, `preferences/*` | R/W | W | delete (account deletion) | delete | `$pull` | `$pull` | `$pull` |
| `pages/course_admin/*` | R | | R/W/delete, replay | R/W/delete | R/W | R/W | R/W |
| `pages/admin/admin.py` | R/W | | | | | | |
| `pages/api/*` (session-cookie auth, `POST /api/v0/authentication` with login/password) | R | R/W | R/W (submit via API) | R | R | | |
| `pages/lti/*`, `lti/*` | R/W (ltibindings) | W (`lti`) | W (tags) | R (grade) | | | |
| plugins `scoreboard`, `contests` | | | R (aggregate) | | | | |
| plugin `upcoming_tasks` | | | | R | | | |
| plugin `ltibestsubmission` | R | R | R | R | | | |
| `webdav.py` (HTTP basic/digest auth: username + **API key** as password, `get_user_api_key(create=True)` generates it) | R/W (apikey) | | | | | | |

## 11. Requirements for the rewrite

1. Write a `{db_version: 20}` document if it is missing, and refuse to run if it is ≠ 20.
2. Create the same indexes at startup (including the **unique** `nonce` and `user_tasks` ones and the TTLs).
3. Store submission input as a GridFS (`fs` bucket) file containing **one BSON document**, with file values as BinData(0)
   and `@random` as doubles. Store archives as raw tgz bytes in GridFS. Delete both when a submission is deleted.
4. Write `grade`/`random` as doubles, `tried`/`tokens.amount`/`size`/`nb_attempt`/`ssh_port` as int32, and dates as BSON dates in UTC.
5. When inserting, write the same default fields as mongoengine (§3 lifecycle, §4 upsert), because legacy readers do
   `submission["result"]`-style accesses. Accept `tokens` missing, `tokens.date` missing, `stdout: null`, old-style
   `problems` string values, and `jobid: null`.
6. Match users by `username` (not unique-indexed) and treat a missing `password`, `code_indentation`, `timezone` or `pinned_courses` with
   legacy defaults. Support the `argon2id-`, `sha512-` and bare-sha512 password formats, and write `argon2id-$argon2id$...`.
7. On startup the legacy frontend errors out all `waiting` submissions. Do not reproduce this blindly while both frontends run on the same DB:
   only error out jobs that *this* server launched (e.g. keep a per-instance marker), or document the incompatibility.
8. Sessions: use a server-side session collection with a TTL, rotate the id at login, avoid creating a document for every anonymous
   request, and set `SameSite`.
