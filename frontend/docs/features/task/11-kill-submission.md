# Killing a running submission

- **ID**: TASK-11
- **Actors**: submitter (student/staff)
- **Routes**: `POST /course/<courseid>/<taskid>` with `@action=kill&submissionid=<id>`
- **Depends on**: TASK-08, TASK-09
- **Legacy code**: `legacy/inginious/frontend/pages/tasks.py:L269-L271`, `submission_manager.py:L570-L585`, `client/client.py:L341-L345` (`ClientKillJob`), `static/js/task.js:L400-L412,L440-L449`

## Use case
A student who submitted an infinite loop (or a long SSH debug session) stops the grading instead
of waiting for the timeout.

## Preconditions
Submission waiting with a `jobid`; requester listed in `submission.username`.

## Main flow
1. The loading card shows a red button `<button class="btn btn-danger kill-submission-btn btn-small" onclick="killSubmission('<id>')"><i class="fa fa-close"></i></button>`.
2. Click → buttons disabled, POST `{"@action":"kill","submissionid":id}`; re-enabled on response.
3. Server: `kill_running_submission(id, as_username=username)` — **always** with ownership check (even staff cannot kill others' jobs from here); not found/not owner or no `jobid` → logged warning, nothing done; else `client.kill_job(jobid)` → `ClientKillJob(job_id)` to the backend.
4. Response always `{"status":"done"}`.
5. The agent stops the container; the job ends with result `killed` → TASK-09 shows "Your submission was killed." (warning card), `status:"error"`, grade 0, the try is counted.

## Alternative / error flows
- Invalid or foreign id → `{"status":"done"}` and nothing happens.
- Job already finished → no `jobid` → nothing.

## UI elements
Kill button in the loading/SSH card.

## Data
No direct DB write by the kill action; the completion writes the submission (`result:"killed"`).

## Permissions & security
Only the submitter(s) can kill a submission; the request is a POST protected by the app's origin check.

## Acceptance tests
- `outcomes` with mode `sleep` → click kill within 20 s → result `killed`, title "Your submission was killed.", `user_tasks.tried` incremented.
- Kill a foreign submission id → `{"status":"done"}`, the other job keeps running.
