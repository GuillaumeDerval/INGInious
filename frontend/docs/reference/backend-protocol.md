# Client ↔ backend protocol (ZeroMQ + msgpack)

This is the protocol the frontend ("client") uses to talk to the **unchanged** INGInious backend
(`inginious-backend`, `legacy/inginious/backend/backend.py`). The new TypeScript server must implement it exactly.
Sources: `legacy/inginious/common/messages.py`, `legacy/inginious/client/_zeromq_client.py`, `legacy/inginious/client/client.py`,
`legacy/inginious/frontend/arch_helper.py`, `legacy/inginious/frontend/submission_manager.py`.
Every example below is **real traffic** captured against the reference stack (`tcp://backend:2000`) with the legacy
`messages.dump/load` code from inside the frontend container on 2026-10-14.

## 1. Transport

| Item | Value |
|---|---|
| Backend socket | `zmq.ROUTER`, **bound** on the client address (`CLIENT` env, `tcp://0.0.0.0:2000` in `infra/compose.yml`, published as `127.0.0.1:2000`). A second ROUTER socket on 2001 serves the agents. |
| Frontend socket | `zmq.DEALER`, `ipv6 = True`, **connects** to `configuration.yaml: backend` (e.g. `tcp://backend:2000`). No explicit `ZMQ_IDENTITY`: the ROUTER assigns a random 5-byte identity (logged as `b'\x00\xe4<\x98p'`). |
| Framing (client → backend) | **one frame**: `[payload]`. The ROUTER prepends the identity, and the backend reads `[addr, payload]` (`ZMQUtils.recv_with_addr`). **No empty delimiter frame.** |
| Framing (backend → client) | the backend sends `[addr, payload]`, and the DEALER receives **one frame** `[payload]` (`ZMQUtils.recv`, `message[0]`). |
| Authentication / encryption | Not part of the protocol (no CURVE, no shared secret). Port 2000 belongs on a private network, reachable only by the frontend. |
| Library for the rewrite | `zeromq` npm package (v6): `new zmq.Dealer({ ipv6: true })`, `dealer.connect(addr)`, `await dealer.send(buf)`, `for await (const [msg] of dealer)`. |

## 2. Encoding

`messages.dump(msg)` (`messages.py:295`):
```python
d = dataclasses.asdict(msg)          # fields in declaration order (recursively converts nested dataclasses)
d["@type"] = msg.__class__.__name__  # appended LAST
return msgpack.dumps(d, use_bin_type=True)
```
`messages.load(b)` (`messages.py:276`):
```python
d = msgpack.loads(b, use_list=False, strict_map_key=False)   # raw=False: str → UTF-8 str; bin → bytes; arrays → tuples
cls = _registered_messages[d.pop("@type")]                   # unknown type → TypeError("Unknown message type")
return cls(**d)                                              # missing/extra field → TypeError("Invalid message content")
```
Consequences for the TS implementation (e.g. `@msgpack/msgpack` `encode`/`decode`):
* A message is a msgpack **map** whose keys are the dataclass field names, plus `"@type"` = class name. Key order does not matter
  to the decoder, but the legacy encoder puts `@type` last (`82 a4 6e616d65 a2 6d65 a5 4074797065 ab 436c69656e7448656c6c6f` =
  `{"name":"me","@type":"ClientHello"}`).
* **Exactly** the declared fields must be present: no more, no fewer. An extra or missing field makes `load` raise.
  The backend must only ever receive well-formed messages (see §7), so the TS encoder is strict and type-checked, with one
  encoder function per message type.
* Strings are msgpack `str` (UTF-8). Binary data (`bytes`: file uploads in `inputdata`, `archive`) is msgpack **`bin`**
  (`use_bin_type=True`). `@msgpack/msgpack` encodes `Uint8Array`/`Buffer` as `bin` and decodes `bin` as `Uint8Array`.
* Tuples are encoded as arrays (`("failed","…")` → `92 a6 6661696c6564 …`). They are decoded as tuples on the Python side, which is irrelevant for TS.
* Floats: Python `float` → msgpack float64 (`cb …`), e.g. `grade: 100.0`. Python `int` → msgpack int. **The type matters**:
  `priority` must be an int, and `grade` from the backend is always a float64. In JS, `0.0` encodes as an int by default,
  so `inputdata["@random"]` (Python floats) must be forced to float64 (`@msgpack/msgpack` `forceFloat32: false` and a custom
  extension, or wrap: `new Encoder({ forceIntegerToFloat: true })` only for those values). The agents do not care about the
  int/float distinction in inputdata, so this is a nice-to-have.
* `None` → msgpack `nil`. `True/False` → `true/false`.
* Map keys must be strings (`strict_map_key=False` only relaxes decoding).

## 3. Messages exchanged by the frontend

### Client → backend

| Message | Fields (in order) | When the legacy frontend sends it |
|---|---|---|
| `ClientHello` | `name: str` | right after `connect` (`client.py:253`, `_on_connect`). The legacy frontend sends `"me"`. The backend registers the identity and immediately answers with `BackendUpdateEnvironments`. |
| `Ping` | (none) | every **1 s** (`_zeromq_client.py:122`, `_do_ping`) |
| `ClientGetQueue` | (none) | every **10 s** (`queue_update=10`, `client.py:154`), skipped while the previous answer is missing (up to 3 skips) |
| `ClientNewJob` | `job_id: str, priority: int, course_id: str\|None, task_id: str\|None, task_problems: dict, inputdata: dict, environment_type: str, environment: str, environment_parameters: dict, debug: bool\|"ssh", launcher: str` | on each submission (`Client.new_job`, `client.py:272`) |
| `ClientKillJob` | `job_id: str` | kill button on the task page (`@action=kill`, owner only, `submission_manager.kill_running_submission`), and the superadmin queue page (`pages/queue.py:27`) |

### Backend → client

| Message | Fields (in order) | Meaning |
|---|---|---|
| `Pong` | (none) | answer to `Ping` |
| `Unknown` | (none) | answer to anything other than `ClientHello` coming from a non-registered identity (e.g. after a backend restart). The legacy client then **reconnects** (`_handle_unknown` → `_reconnect`). |
| `BackendUpdateEnvironments` | `available_environments: {env_type: [env_name, …]}` | after `ClientHello`, and to **all** registered clients whenever an agent says hello. Only `advertised` environments are listed. |
| `BackendJobStarted` | `job_id` | the job was sent to an agent |
| `BackendJobSSHDebug` | `job_id, host: str, port: int, user: str, password: str` | ssh debug job ready (`debug == "ssh"`) |
| `BackendJobDone` | `job_id, result: [str, str], grade: float, problems: {pid: [str, str]}, tests: dict, custom: dict, state: str, archive: bytes\|None, stdout: str\|None, stderr: str\|None` | job finished (or killed, crashed, duplicate, agent lost) |
| `BackendGetQueue` | `jobs_running: [[job_id, is_current_client: bool, agent_name, info, launcher, started_at: int, max_time: int], …], jobs_waiting: [[job_id, is_current_client, info, launcher, max_time], …]` | answer to `ClientGetQueue`. `info` is `"courseid/taskid"`, or the environment name if course/task are null. `max_time` = `int(environment_parameters.limits.time)`, or `-1` if unknown. `started_at` is in epoch seconds (int). |

The docstring in messages.py describes 6 elements for `jobs_running`, but the code sends **7** (with `agent_name` at index 2);
`queue.html` unpacks 7.

Agent-side messages (`BackendNewJob`, `AgentHello`, …) are never seen by the frontend.

### `result[0]` values
`success`, `failed` → submission `status: "done"`; `timeout`, `overflow`, `crash`, `killed`, `error` → `status: "error"`
(`submission_manager.py:66`). `result[1]` is the main feedback (RST).

## 4. ClientNewJob: what the frontend puts in it

Built in `Client.new_job` (`client.py:303-334`) from `submission_manager.add_job`/`replay_job`:

| Field | Value |
|---|---|
| `job_id` | `str(uuid.uuid4())`, generated **client-side** (e.g. `"ff450aae-ac1e-45a7-9182-13ee71fa1d68"`). It is stored in `submissions.jobid` and is also the transaction key. A duplicate id is answered with `BackendJobDone(result=("crash","Duplicate job id"))`. |
| `priority` | `0` for new submissions, `1` for replays (`replay_job`). **Lower is served first?** The backend `TopicPriorityQueue` orders by `(priority, insert_time)`, so 0 is served before 1 (replays have lower priority). |
| `course_id`, `task_id` | course and task ids. Both are `None` only for course-less jobs (unused by the frontend; plugins `taskless-hello-world`). |
| `task_problems` | `task.get_problems_dict()` = the **raw `problems` dict of task.yaml** as parsed by YAML (not translated, not normalised). The MCQ agent uses it to grade (`choices`, `valid`, `feedback`, `success_message`, `error_message`, `limit`, `multiple`, …). |
| `inputdata` | the submission input dict, identical to what is stored in GridFS (see db-schema.md §3.1): form fields, problem values (`str`, list of `str`, or `{"filename": str, "value": bytes}`), and `@username`, `@email`, `@lang`, `@time`, `@attempts`, `@random` (list of floats), `@state`. |
| `environment_type` | `task.yaml: environment_type` (`docker`, `docker-ssh`, `nvidia`, `nvidia-ssh`, `mcq`). Legacy v0.6 tasks with `environment: X` are migrated to `docker` (or `mcq` if X == `mcq`). If the task has `environment_parameters.ssh_allowed`, `-ssh` is appended. |
| `environment` | `task.yaml: environment_id` (default `"default"`) |
| `environment_parameters` | normalised by the frontend env type (`environment_types/generic_docker_oci_runtime.py:18`). For `docker`/`nvidia`: `{"run_cmd": <str or None if empty>, "network_grading": <bool as in yaml>, "limits": {"time": int (default 20), "memory": int (1024), "disk": int (1024), "hard_time": int (default 3*time)}}`. **`hard_time` is only present when `limits` exists in the yaml.** Without limits you get `{"time":20,"memory":1024,"disk":1024}`. The key order is `run_cmd, network_grading, limits`. For `mcq`: `{}`. Invalid (≤0 or non-int) limits make the task fail to load. |
| `debug` | `False` for students. For course **admins** (`has_admin_rights_on_course`), `True` (the agent returns extra debug info), or `"ssh"` when the form has `@debug-mode=ssh` (`pages/tasks.py:211-216`). |
| `launcher` | `"Frontend - <username>"` for new submissions, `"Frontend - ['user1', 'user2']"` (Python list repr of `submission["username"]`) for replays. Displayed in the queue page. |

Before sending, the client checks `environment_type`/`environment` against the last `BackendUpdateEnvironments`. If the
environment is not available (including right after a reconnect, when the cache is emptied), it **does not send anything** and
calls the callback synchronously with `("crash", "Environment not available.")`. That is why such submissions end with `jobid: null`.
The backend would otherwise keep an unknown-environment job **in the waiting queue forever** (verified: no answer, then visible in
`jobs_waiting` until killed).

Captured `ClientNewJob` for `tutorial/02_courses` (3644 bytes, `task_problems` truncated to `q4`):
```python
{'job_id': 'ff450aae-ac1e-45a7-9182-13ee71fa1d68', 'priority': 0, 'course_id': 'tutorial', 'task_id': '02_courses',
 'task_problems': {'q4': {'limit': 0, 'choices': [{'valid': True, 'text': 'All the submissions of a given student'}, ...],
                          'success_message': '...', 'error_message': 'The statistics pages offer more possibilities.',
                          'type': 'multiple_choice', 'multiple': True, 'header': '...', 'name': 'Statistics view'}, 'q1': {...}, ...},
 'inputdata': {'q1': '1', 'q2': '2', 'q3': '1', 'q4': ['0', '2'], '@username': 'core_probe', '@email': 'core_probe@x.org',
               '@lang': 'en', '@time': '2026-10-14 05:30:28.426736+00:00', '@attempts': '1', '@random': [], '@state': ''},
 'environment_type': 'mcq', 'environment': 'mcq', 'environment_parameters': {}, 'debug': False,
 'launcher': 'Frontend - core_probe', '@type': 'ClientNewJob'}
# hex head: 8c a6 6a6f625f6964 d9 24 66663435... a8 7072696f72697479 00 a9 636f757273655f6964 a8 7475746f7269616c ...
```
For `tutorial/05_fetching_input` (docker): `environment_type: 'docker'`, `environment: 'default'`,
`environment_parameters: {'run_cmd': None, 'network_grading': False, 'limits': {'time': 3, 'memory': 100, 'disk': 1024, 'hard_time': 9}}`.
The file value is encoded as bin: `a5 76616c7565 c4 07 68656c6c6f00ff` (`"value": b"hello\x00\xff"`).

## 5. Captured responses

```python
# before ClientHello (fresh DEALER sends ClientGetQueue)
<< {'@type': 'Unknown'}                                   # 81 a5 4074797065 a7 556e6b6e6f776e
# ClientHello("core_probe")
<< {'available_environments': {'mcq': ('mcq',), 'docker': ('python3', 'default')}, '@type': 'BackendUpdateEnvironments'}
# Ping
<< {'@type': 'Pong'}                                      # 81 a5 4074797065 a4 506f6e67
# ClientGetQueue (idle)
<< {'jobs_running': (), 'jobs_waiting': (), '@type': 'BackendGetQueue'}
# ClientGetQueue while a docker job runs
<< {'jobs_running': (('129f58d1-8643-4ab4-ade5-0b375ae30a25', True, '', 'tutorial/05_fetching_input', 'Frontend - core_probe', 1791956024, 3),),
    'jobs_waiting': (), '@type': 'BackendGetQueue'}
# ClientGetQueue with a job for a nonexistent environment
<< {'jobs_running': (), 'jobs_waiting': (('f0ceb8d1-…', True, 'nonexistent_env', 'core', -1),), '@type': 'BackendGetQueue'}

# MCQ job
<< {'job_id': 'ff450aae-…', '@type': 'BackendJobStarted'}
<< {'job_id': 'ff450aae-…', 'result': ('failed', 'You have 2 wrong answer(s).\n\n\nAmong them, you have 3 invalid answers in the multiple choice questions'),
    'grade': 50.0,
    'problems': {'q2': ('failed', 'Wrong answer\n\nStudents can not create groups. …'), 'q4': ('failed', 'The statistics pages offer more possibilities.')},
    'tests': {}, 'custom': {}, 'state': '{"q1": "", "q2": "", "q3": "", "q4": ""}', 'archive': None, 'stdout': None, 'stderr': None,
    '@type': 'BackendJobDone'}

# docker job (debug=True)
<< {'job_id': 'c77b3525-…', '@type': 'BackendJobStarted'}
<< {'job_id': 'c77b3525-…', 'result': ('success', 'Your code ran correctly. Here is the output :\n\n\n\n.. code-block:: \n\n\thi\n\n\n'),
    'grade': 100.0, 'problems': {}, 'tests': {}, 'custom': {}, 'state': '',
    'archive': b'\x1f\x8b\x08\x08)\x14\xcfj\x02\xffarchive.tgz\x00…' (190 bytes, msgpack bin: c4 be 1f8b0808…),
    'stdout': '', 'stderr': '', '@type': 'BackendJobDone'}

# kill right after submit (job already started), inputdata["@state"] = "prev-state"
>> {'job_id': '6bcab638-…', '@type': 'ClientKillJob'}
<< {'job_id': '6bcab638-…', '@type': 'BackendJobStarted'}
<< {'job_id': '6bcab638-…', 'result': ('killed', ''), 'grade': 0.0, 'problems': {}, 'tests': {}, 'custom': {},
    'state': 'prev-state', 'archive': None, 'stdout': '', 'stderr': '', '@type': 'BackendJobDone'}
# kill of a job still waiting in the backend queue
<< {'job_id': 'f0ceb8d1-…', 'result': ('killed', 'You killed the job'), 'grade': 0.0, 'problems': {}, 'tests': {}, 'custom': {},
    'state': '', 'archive': None, 'stdout': '', 'stderr': '', '@type': 'BackendJobDone'}

# ssh debug job (debug="ssh", env docker/default)
<< {'job_id': '7083c293-…', '@type': 'BackendJobStarted'}
<< {'job_id': '7083c293-…', 'host': '67.180.127.246', 'port': 64128, 'user': 'worker', 'password': '6teG/odU49gT+Q==', '@type': 'BackendJobSSHDebug'}
<< BackendJobDone(...)   # after the student's session ends, or when killed: result ('killed', '')
```
When the job is killed, `state` is the previous state (`inputdata["@state"]`), so the user's task state is not lost.

Other `BackendJobDone` results produced by the backend itself: `("crash", "Duplicate job id")`, `("crash", "Agent restarted")`
(an agent stopped answering pings: more than 5 missed 1 s pings; `stdout`/`stderr` are **None**), `("killed", "You killed the job")`.
The client itself synthesises `("crash", "Backend unavailable, retry later")` (reconnect), `("crash", "Environment not available.")`
and `("crash", "SSH callback not set.")` without any network traffic.

## 6. Client state machine (legacy `BetterParanoidPirateClient` + `Client`)

1. `client_start`: `socket.connect(addr)` → `_on_connect`: clear `available_environments`, send `ClientHello("me")`, start the
   `_ask_queue_update` loop (10 s). Start `_run_socket` (receive loop) and `_do_ping` (1 s loop). `ping_count = 0`.
2. **Any** received message resets `ping_count = 0`. `_do_ping` increments it before each `Ping`. When `ping_count > 10`
   (≈ 11 s without any message), it **reconnects**.
3. `_reconnect` (also triggered by `Unknown`):
   1. every pending transaction (`ClientNewJob` waiting for `BackendJobDone`) is **aborted**: `_handle_job_abort` calls the
      ssh callback with `(None, None, None, None)`, then the job callback with
      `("crash", "Backend unavailable, retry later"), 0.0, {}, {}, {}, "", None, "", ""`, which marks the submission as an
      error. The job may still run on the backend, and its later `BackendJobDone` is then dropped ("unknown transaction" logged).
   2. cancel the loops, `socket.disconnect(addr)` (same socket object, so ZMQ assigns a new identity on reconnect), and start again from step 1.
4. Transactions (`_register_transaction`): `ClientNewJob` ↔ `BackendJobDone`, keyed by `job_id`. The intermediate messages
   `BackendJobStarted` (log only) and `BackendJobSSHDebug` (→ `ssh_callback(host, port, user, password)` → stored in
   `submissions.ssh_*`) do not close it. `BackendJobDone` calls `ssh_callback(None…)` (no-op if already called, since it is wrapped
   `_callable_once`) and then the job callback **exactly once**. A message for an unknown key raises, the exception is logged, and it is ignored.
5. `BackendGetQueue` handler: caches the snapshot and precomputes `job_id → (nb_before, approx_wait)`. For running jobs: `(-1,
   max(0, started_at+max_time-now))` (0 if `max_time` ≤ 0). For waiting jobs, in backend dict order (insertion order, not priority
   order): `(index, cumulative sum of positive max_time)`. It is used by the task page "check" polling (waiting texts) and the
   `/queue` page. The cache can be up to 10 s stale.
6. There is no timeout on a job itself. Jobs only end through `BackendJobDone` or a reconnect. The backend enforces
   `limits.hard_time` through the agents.

Threading in the legacy app (`arch_helper.py`): a `ZMQEventLoop` runs in a daemon thread. Flask request threads call
`client.new_job` / `kill_job`, which schedule work with `loop.call_soon_threadsafe`. Callbacks (`_job_done_callback`) run on the
event loop thread (and ssh callbacks in its executor) and access MongoDB synchronously. In Node, everything runs on one event loop,
with no threading concerns. With `backend: local`, `create_arch` starts the backend and a docker and an mcq agent in-process over
`inproc://` sockets. The rewrite does not need this mode (always a TCP backend). Document it as unsupported.

## 7. Robustness issues in the unchanged backend (must be avoided by the client)

* **The backend expects well-formed messages.** `ZMQUtils.recv_with_addr` → `load()` (`backend.py:329-351`) only accepts
  messages with a known `@type` and exactly the declared fields. Requirements: the TS client must only emit schema-checked
  messages, port 2000 stays on a private network, and adding `restart: unless-stopped` to the backend service is recommended.
* An unknown environment keeps the job waiting forever (only the client-side check prevents it).
* Messages for an unknown job id from an agent are logged. Results for a client that reconnected are sent to the old identity and are lost.
* The backend never forgets registered client identities.

## 8. Requirements for the TS client

1. One DEALER socket, `ipv6: true`, connect to `backend` from the config. Send `ClientHello` (any name, e.g. `"me"` or
   `"sveltekit"`) on (re)connect, and wait for `BackendUpdateEnvironments` before accepting jobs (or answer "Environment not available").
2. Ping every 1 s. Reconnect after 11 s of silence or on `Unknown`. On reconnect, fail every pending job with
   `("crash","Backend unavailable, retry later")` and update MongoDB as the legacy job-done callback does.
3. `ClientGetQueue` every 10 s, keep the snapshot and the per-job wait estimates.
4. Generate `job_id` with `crypto.randomUUID()`. Store it in `submissions.jobid` **after** sending, and guard against the
   done-before-stored race (the legacy code has it, see `jobid: null`).
5. Encode with msgpack: strings as str, `Uint8Array` as bin, `grade`/`@random` as float64, exactly the declared fields, and `@type`.
   Decode `bin` → `Buffer` (to store the archive in GridFS) and accept `result`/`problems` values as 2-element arrays.
6. Only one `BackendJobDone` per job, and call the completion logic exactly once.
7. Kill = `ClientKillJob(job_id)`. The result comes back as a normal `BackendJobDone` with `result[0] == "killed"`.
8. Handle `BackendJobSSHDebug` by storing `ssh_host/ssh_port/ssh_user/ssh_password` on the submission (they are shown to the submitter
   by the "check" polling and `$unset` on job done).
