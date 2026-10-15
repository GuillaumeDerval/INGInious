# Backend connection: asyncio/ZeroMQ client thread, local vs remote backend (arch_helper)

- **ID**: CORE-08
- **Actors**: system (operator configures `backend`)
- **Routes**: none directly; used by submissions, queue page (`/queue`), task editor (environment list), simple_grader, LTI...
- **Depends on**: —
- **Legacy code**: `legacy/inginious/frontend/arch_helper.py:15-113`, `legacy/inginious/frontend/app.py:146,167-172,214-231,119-122`, `legacy/inginious/scripts/webapp.py:50-56`, `legacy/inginious/client/client.py:126-345`, `legacy/inginious/client/_zeromq_client.py:15-215`, `legacy/inginious/common/messages.py`

## Use case
The web frontend never grades anything itself: it forwards jobs to the INGInious backend over
ZeroMQ and receives results asynchronously. For small installs the frontend can embed a complete
backend + agents in-process (`backend: local`); production uses a separate backend container
(`backend: tcp://backend:2000`). The rewrite (TypeScript server) must speak the same protocol to the
unchanged Python backend.

## Preconditions
- `backend` config: `"local"` (default) or a ZeroMQ endpoint of the backend's *client* socket.

## Main flow
1. `start_asyncio_and_zmq(debug_asyncio)` (`arch_helper.py:15-28`, called at `app.py:146`): creates a `zmq.asyncio.ZMQEventLoop`, sets it as the current loop,
   optionally `loop.set_debug(True)`, creates a `zmq.asyncio.Context`, and starts a **daemon thread** running `loop.run_forever()`
   (`_run_asyncio`, `:30-44`; on exit closes the loop and `zmq_context.destroy(1000)`). Flask request threads talk to it with `loop.call_soon_threadsafe(...)`.
2. `create_arch(config, zmq_context)` (`arch_helper.py:55-113`, called at `app.py:167`):
   - **`backend: local`**: logs "Starting a simple arch (backend, docker-agent and mcq-agent) locally"; reads `local-config` (`concurrency` default CPU count, `debug_host`, `debug_ports` "a-b" -> `range(a,b)` default `range(64100,64111)`, `debugger`, `tmp_dir` default `./agent_tmp`);
     imports `DockerAgent`, `MCQAgent`, `Backend` (not installed in the split containers); wires them with in-process ZMQ:
     `Client(ctx, "inproc://backend_client")`, `Backend(ctx, "inproc://backend_agent", "inproc://backend_client")`,
     `DockerAgent(ctx, "inproc://backend_agent", "Docker - Local agent", concurrency, debug_host, debug_ports, debugger, tmp_dir, ssh_allowed=True)`,
     `MCQAgent(ctx, "inproc://backend_agent", "MCQ - Local agent", 1)`; each agent/backend `run()` is scheduled with `_restart_on_cancel` (restarts on `CancelledError`).
   - **otherwise**: logs "Creating a client to backend at %s" and creates `Client(ctx, backend_link)` (e.g. `tcp://backend:2000` in infra).
   - Warns for obsolete keys `agents`, `containers`, `machines`, `docker_daemons`.
3. The client object is shared through `flask_app.client`, `WebAppSubmissionManager(client, user_manager, lti_score_publishers)` and passed to plugins' `init(plugin_manager, client, conf)`.
4. After routes and plugins are registered, `client.start()` (`app.py:229`) schedules `client_start()` on the loop (`client.py:257-259`): the `BetterParanoidPirateClient` opens a ZMQ **DEALER** socket (`ipv6=True`) connected to the backend ROUTER,
   sends `ClientHello("me")` (`client.py:253`), sends `Ping` every second and reconnects (`_reconnect`: on_disconnect -> socket disconnect/reconnect -> on_connect) when Pongs stop or the backend answers `Unknown` (`_zeromq_client.py:30-215`).
5. Client capabilities used by the frontend:
   - `new_job(priority, job_info, inputdata, callback, launcher_name, debug, ssh_callback)` -> `ClientNewJob` (courseid, taskid, problems dict, input, environment_type, environment, environment_parameters, debug, launcher) and a transaction expecting `BackendJobStarted`, `BackendJobSSHDebug`, `BackendJobDone` (`client.py:136-146,272-338`); callbacks run in the default executor thread.
     If the environment type/name is not in `get_available_environments()`, the job immediately ends with `("crash", "Environment not available.")`.
   - `kill_job(job_id)` -> `ClientKillJob` (`client.py:341-345`).
   - `get_available_environments()` updated by `BackendUpdateEnvironments` (`{env_type: [env names]}`).
   - `get_job_queue_snapshot()` / `get_job_queue_info(jobid)` from `BackendGetQueue`, refreshed by a `ClientGetQueue` every 10 s (`queue_update=10`).
6. Shutdown: `scripts/webapp.py` installs SIGINT/SIGTERM handlers calling `_close_app` -> `client.close()` (no-op) + mongoengine `disconnect()` then raising `KeyboardInterrupt`.
7. Maintenance mode creates the client but never starts it (CORE-03).

## Alternative / error flows
- Backend down: the client keeps reconnecting; submissions wait (or end when the backend answers); `/queue` shows stale/empty data.
  (2026-10-14: the shared backend container is crashed by another test; job results observed now would be crashes and are not frontend behaviour.)
- `debug_ports` malformed -> "debug_ports should be in the format 'begin-end'..." and `exit(1)`.
- `backend: local` in the split containers fails at import (agents not installed).
- Multi-process WSGI (several gunicorn workers) would create one independent client per worker; job callbacks are bound to the worker that submitted (the reference deployment uses gunicorn's default single worker).

## UI elements
- None (see `/queue` "Service status" page feature for the queue display).

## Data
- No MongoDB writes by the client itself; results are persisted by `WebAppSubmissionManager` callbacks (`submissions`, `user_tasks`, GridFS archives).
- Config: `backend`, `local-config.*`, `debug_asyncio` (`docs/reference/config.md`).
- Wire protocol: msgpack-serialised dicts `{"@type": "<MessageClass>", ...fields}` (`common/messages.py:276,300`) over ZMQ (see backend protocol reference).

## Permissions & security
- The backend client port must only be reachable from the frontend (infra binds `127.0.0.1:2000`).

## Acceptance tests
- With `backend: tcp://host:port`, the new server opens a DEALER connection to that endpoint at start-up and registers; a fake backend receives `ClientHello{name}` and periodic `Ping`s.
- Fake backend sends `BackendUpdateEnvironments({"docker": ["default"]})` -> the task editor/environment list shows it; submitting a task whose environment is missing yields result `crash` "Environment not available." without contacting the backend.
- Submitting a task sends a `ClientNewJob` whose fields match the legacy encoding (byte-for-byte msgpack comparison against a recorded legacy message for the same task/input).
- `BackendJobStarted` / `BackendJobDone` received -> the submission doc is updated as legacy does.
- `ClientGetQueue` is sent periodically (every 10 s) and `BackendGetQueue` populates the queue page.
- Backend restart: the client reconnects automatically and new submissions succeed without restarting the frontend.
- `backend: local` is either supported (spawning the Python backend/agents) or rejected with a clear error (document decision).
