# Job queue status page ("Service status")

- **ID**: NAV-17
- **Actors**: any logged-in user (view); superadmin and course admins (kill jobs)
- **Routes**: GET /queue; POST /queue (field `jobid`, superadmin or admin of the job's course)
- **Depends on**: backend client protocol (ClientGetQueue / BackendGetQueue / ClientKillJob)
- **Legacy code**: `legacy/inginious/frontend/pages/queue.py:L14-L28`, `templates/queue.html:L1-L125`, `submission_manager.py:L787-L825`, `client/client.py:L153-L202,L341-L345`, `common/messages.py:L46-L53,L109-L134`, `templates/layout.html` (menu entry "Service status")

## Use case
Users check whether the grading backend is busy (why their submission waits); superadmins
can kill a stuck job.

## Preconditions
Logged in (menu "Service status", `fa-dashboard`, in the user dropdown).

## Main flow
1. The frontend's client periodically sends `ClientGetQueue()` to the backend (every `queue_update` = 10 seconds, the `Client` default; skipped while a previous request is unanswered, with log "Not asking for a job queue update as previous update not yet received"); the reply `BackendGetQueue(jobs_running, jobs_waiting)` is cached.
2. GET: `get_job_queue_snapshot()` returns the cached `(jobs_running, jobs_waiting)` or `(None, None)` if no snapshot yet.
3. Render:
   - h2 "Job queue", paragraph "This page shows a <strong>snapshot</strong> of the job queue."
   - h3 "Running jobs": table with columns Type | Agent name | Name | Launcher name | Started at | Timeout at | Action, one row per tuple `(job_id, is_current_client_job, agent_name, info, launcher, started_at, max_time)`: Type cell text "Task" with tooltip = job_id; Name = `info` ("courseid/taskid" or the environment/info string); Started at = `show_time(datetime.fromtimestamp(started_at).astimezone())`; Timeout at = `show_time(started_at + max_time)` or "No timeout set" if `max_time < 0`. Else "There are no jobs running".
   - h3 "Jobs in queue": columns Type | Name | Launcher name | Maximum runtime in seconds | Action, tuples `(job_id, is_current_client_job, info, launcher, max_time)`; max_time or "No timeout set". Else "There are no jobs waiting in queue".
   - Action column (superadmin only): warning button (`fa-remove`, title "Kill Job") opening modal `#kill_modal` ("Kill job", "Are you sure ?", Cancel / red "Kill" submit with `name="reset"`), JS copies the row's `data-job_id` into hidden `#jobid`.
4. POST (superadmin): `client.kill_job(form["jobid"])` → sends `ClientKillJob(job_id)` to the backend (fire-and-forget), then renders the page (snapshot may still show the job).

## Alternative / error flows
- POST for a job the user may not kill, or for a job id not in the current snapshot (including a missing `jobid`) → refused (HTTP 403 "You're not allowed to do that"), nothing sent to the backend.
- Backend disconnected → stale or empty snapshot (no error shown).
- Job ids of other clients are listed; `is_current_client_job` is not displayed.

## Data
No MongoDB access. Backend messages only.

## Permissions & security
- Logged-in users see the queued jobs' course/task ids and launcher names.
- Only superadmins, and the admins of the course a job belongs to (job info `<courseid>/<taskid>`), can kill a job, and only a job listed in the current snapshot; the kill is a POST protected by the app's origin check.

## Acceptance tests
- Student GET /queue → 200, both sections; no Action buttons.
- With a waiting job (e.g. a submission on an unavailable environment) the "Jobs in queue" table lists it (observed: Name "nonexistent_env", Launcher "core", "No timeout set" when max_time = -1).
- superadmin sees kill buttons; submitting the modal posts `jobid=<id>` and the backend receives `ClientKillJob`.
- POST jobid by a user who may not kill that job → HTTP 403, no message sent.
