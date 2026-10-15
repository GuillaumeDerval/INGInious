# Plugin "simple_grader": external POST grader

- **ID**: SITE-18
- **Actors**: external system holding the configured shared key (any HTTP client, CORS-enabled)
- **Routes**: GET /external, POST /external, OPTIONS /external (app: `page_pattern` is ignored); legacy: GET|POST <page_pattern> (default /external)
- **Depends on**: SITE-12, backend client (`ClientSync`, `ClientBuffer`), TASK (`input_is_consistent`)
- **Legacy code**: `plugins/simple_grader/__init__.py:L1-128`, `client/client_sync.py:L16-34`,
  `client/client_buffer.py:L19-55`, `client/client.py:L272-335` (`Client.new_job`)

## Use case
Another application (e.g. a MOOC page) wants INGInious to grade an input against a task of a
dedicated course, without user accounts and without storing anything in the database.

## Preconditions
Configuration (all keys optional except module):
```yaml
plugins:
  - plugin_module: inginious.frontend.plugins.simple_grader
    courseid: external                         # default "external"; the course MUST exist at start-up
    page_pattern: /external                    # default "/external"
    return_fields: "^(result|text|problems)$"  # regex on job result keys returned to the caller
    api_key: <shared secret>                   # required by the app: the endpoint is disabled without it
```
Legacy: `Course.get(courseid)` was evaluated in `init` (the frontend failed to start when the
course folder did not exist) and the course object was captured once at start-up. App: the
course is read at each request (an unknown course gives "Cannot open task"); without
`api_key` a warning is logged and the endpoint answers 404.

## Main flow
Behaviour of the app (`routes/external/+server.ts`,
`lib/server/plugins/bundled/inginious.frontend.plugins.simple_grader.ts`):
1. `GET /external` → a bare HTML test form (no layout): title "External grade POST test", textarea
   `input` prefilled with `{"question1":"print 'Hello World!'"}`, text input `taskid` (value `helloworld`) "(taskid)",
   password input `api_key`, checkbox `async` "async?", submit button.
2. `POST /external` (form-encoded or JSON body), `Content-Type: application/json`, headers
   `Access-Control-Allow-Origin: *` (and `OPTIONS` answers the CORS preflight of JSON posts).
   Every request carries the shared key (field `api_key`, compared in constant time); a missing
   or wrong key, or a client throttled after too many wrong keys, gets **403**
   `{"status": "error", "status_message": "Invalid API key"}`. Otherwise HTTP 200 with:
   - **New synchronous job**: fields `taskid`, `input` (JSON object string `{pid: value}`), no `async`:
     1. `json.loads(input)` else `{"status": "error", "status_message": "Cannot decode input"}`;
     2. `course.get_task(taskid)` else `{"status": "error", "status_message": "Cannot open task"}` (also for
        ids failing the `[a-z0-9\-\._]+` check, e.g. `../x`);
     3. the input is checked like a task page submission, else
        `{"status": "error", "status_message": "Input is not consistent with the task"}`;
     4. runs the job (priority 0, launcher "Plugin - Simple Grader") and blocks until done;
        returns `{"status": "done", <filtered fields>}` where fields are from
        `{result, text, grade, problems, tests, custom, state, stdout, stderr}` (the job result is
        split into `result` and `text`; the archive is never returned) filtered by `return_fields`.
   - **New asynchronous job**: same + field `async` present → `{"status": "done", "jobid": "<uuid>"}`;
     results never polled are forgotten after one hour.
   - **Poll**: field `jobid` → `{"status": "waiting"}`, or `{"status": "done", <filtered fields>}`
     (result consumed: a second poll returns the "no job" error), or
     `{"status": "error", "status_message": "There is no job with jobid <jobid>"}`.
   - Anything else → `{"status": "error", "status_message": "Unknown request type"}`.

## Alternative / error flows — **the legacy plugin is broken** (not reproduced by the app)
Verified by running a dedicated frontend with the plugin and course `external`:
- Sync job: `client_sync.new_job(0, course, task, task_input, "Plugin - Simple Grader")` uses the old
  signature; `ClientSync.new_job` now expects `(priority, job_info, inputdata, launcher_name, debug)`
  → exception → every valid sync request answers `{"status": "error", "status_message": "An internal error occurred"}`.
- Async job: `ClientBuffer.new_job` calls `Client.new_job` with the wrong arguments → uncaught
  exception → **HTTP 500 HTML page**.
- Polling an unknown jobid and all validation errors work as described.
- `result` is a tuple `(result_str, feedback_text)` → would be serialized as a 2-element JSON array.
- `archive` is bytes → would make `json.dumps` fail if included by `return_fields`.

## Data
No DB writes (submissions are not stored). Reads task files of the configured course. Sends
`ClientNewJob` to the backend (course id, task id, problems, input, env type/id, env params).

## Permissions & security
- Grading requests require the shared `api_key` of the plugin configuration (constant-time
  comparison); the endpoint answers 404 when the plugin is disabled or no key is configured.
- Wrong keys are throttled per client address (shared credential limiter: 100 failures per
  15 minutes); a throttled client gets the same 403 answer, even with the right key.
- The endpoint accepts cross-site POSTs (it is authenticated by the key, not by cookies) and
  responses carry `Access-Control-Allow-Origin: *`.
- Synchronous requests wait for the whole grading time (legacy: the gunicorn default timeout of
  30 s killed longer jobs).
- No session is used.

## Acceptance tests
- No `api_key` configured → warning at start-up and 404.
- GET returns the test form.
- Request without the configured `api_key` (or with a wrong one) → 403 "Invalid API key"; no key configured → 404.
- Each documented error message for decode/task/consistency/unknown request/unknown jobid.
- Sync job on a valid input returns `{"status":"done", "result": ..., ...}` filtered by `return_fields`; async returns jobid then waiting/done.
- Response headers: `application/json`, `Access-Control-Allow-Origin: *`.
