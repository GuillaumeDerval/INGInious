# SSH remote debugging of a grading container (and webterm iframe)

- **ID**: CORE-07
- **Actors**: course admin | superadmin (debug button on task page, "replay with debug" on a submission); student (SSH sessions opened by tasks using `run_student --ssh` in an `*-ssh` environment)
- **Routes**: POST `/course/<courseid>/<taskid>` (`@action=submit`, `@debug-mode=ssh`), POST `/course/<courseid>/<taskid>` (`@action=check`), POST `/submission/<submissionid>` (`replay-debug`)
- **Depends on**: CORE-08 (backend client), task submission feature, submission admin feature
- **Legacy code**: `legacy/inginious/frontend/templates/task.html:308-320,385-405`, `legacy/inginious/frontend/static/js/task.js:17-20,279-300,332-345,463-499`, `legacy/inginious/frontend/pages/tasks.py:211-221,275-289`, `legacy/inginious/frontend/submission_manager.py:60-82,149-201,423-481,780-785`, `legacy/inginious/frontend/pages/course_admin/submission.py:48-49`, `legacy/inginious/frontend/tasks.py:45-46`, `legacy/inginious/frontend/environment_types/{docker,nvidia}.py`, `legacy/inginious/client/client.py:50-73,145,235-240`, `legacy/inginious/common/messages.py:41,100-106,224-229`, `legacy/inginious/agent/docker_agent/__init__.py:352-358`

## Use case
A teacher writing a task wants to inspect what happens inside the grading container: they submit an
input in "SSH debug" mode, and INGInious shows an `ssh` command (and optionally an in-browser
terminal via the INGInious-xterm "webterm" app) to connect into the running container for up to
30 minutes. Tasks whose environment allows SSH can also open SSH sessions for students.

## Preconditions
- User has admin rights on the course (button only rendered then; server re-checks `is_admin`).
- The agent supports SSH: docker agent started with `ssh_allowed=True` (local arch does, `arch_helper.py:96`), and ports in `debug_ports` reachable from the user (`debug_host`).
- Optional `webterm: "https://host:port"` (INGInious-xterm) for the iframe.

## Main flow
1. Task page (`task.html:390-401`): for course admins, the form contains `<input type="hidden" name="@debug-mode" id="task-debug-mode" value="">`
   and, next to "Submit", a button `#task-submit-debug` (`btn-info`, icon `fa-terminal`, tooltip "Start remote SSH console with this input").
2. Click -> `submitTask(true)` sets `@debug-mode=ssh` and ajax-submits the form (`task.js:279-300`).
3. Server (`pages/tasks.py:211-216`): `debug = is_admin`; if `@debug-mode == "ssh"` and admin -> `debug = "ssh"`; the key is removed from the input.
   `submission_manager.add_job(..., debug)` -> `client.new_job(..., debug, ssh_callback)`; the backend message `ClientNewJob.debug` is `True|False|"ssh"` (`common/messages.py:41`).
   Response JSON `{"status":"ok","submissionid":..., "remove":[...], "text":"<b>Your submission has been sent...</b>"}`.
4. The agent starts the container with port 22 exposed (`docker_agent/__init__.py:352-353`) and time limits forced to 30 min (`:356-358`),
   then sends `AgentJobSSHDebug{job_id, host, port, user, password}` -> backend -> `BackendJobSSHDebug` -> client handler `_handle_job_ssh_debug` (`client.py:235-240`)
   -> `ssh_callback(host, port, user, password)` -> `_handle_ssh_callback` writes `ssh_host, ssh_port, ssh_user, ssh_password` on the `submissions` doc (`submission_manager.py:780-785`).
5. The page polls every second with `@action=check` (`task.js:332-345`). While the submission has `ssh_host`, the server answers
   `{"status":"waiting","text":"<b>SSH server active</b>","ssh_host":..,"ssh_port":..,"ssh_user":..,"ssh_password":..}` (`pages/tasks.py:281-289`).
6. `displayRemoteDebug` (`task.js:463-499`) clones the hidden `#ssh_template` (`task.html:308-320`) into `#task_alert`:
   - command: `ssh <user>@<host> -p <port> -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o PreferredAuthentications=password` in `<pre id="commandssh">`;
   - "The password to connect is `<code>password</code>`";
   - if `webterm` configured: an `<iframe id="iframessh" frameborder=0 scrolling=no src="<webterm>?host=<host>&port=<port>&password=<password>">` and the text "Alternatively, you can also paste this command into your terminal:"; otherwise "Paste this command into your terminal:"
     (verified: with `webterm: "https://webterm.example:8080"` the page contains `<input type="hidden" value="https://webterm.example:8080" id="webterm_link"/>` inside `#webterm`).
7. When the job ends, `_job_done_callback` saves the result and **unsets** `jobid, ssh_host, ssh_port, ssh_user, ssh_password` (`submission_manager.py:79-82`); the polling then shows the normal result. With `debug` truthy the check response also includes `"debug": <submission dump>` displayed in the admin debug modal.
8. Replay in debug mode (submission admin page): POST `replay-debug` -> `replay_job(course, task, submission, dispenser, copy=True, debug="ssh")` creates a copy of the submission run with SSH (`course_admin/submission.py:48-49`).
9. Student SSH: tasks whose `environment_parameters.ssh_allowed` is true get environment type `docker-ssh`/`nvidia-ssh` (`tasks.py:45-46`); `run_student --ssh` inside the grading container makes the agent send the same SSH info, so the *student* sees the same SSH box (ssh_callback is attached to every job).

## Alternative / error flows
- Environment not available on any agent -> `ssh_callback(None,...)` then crash result "Environment not available." (`client.py:320-326`).
- Non-admin posting `@debug-mode=ssh` -> ignored (debug False).
- Late callback with `host=None` is ignored (`submission_manager.py:782`).
- Kill button (`@action=kill`) stops the container.
- Note (2026-10-14): the shared backend container is currently crashed, so live jobs end in a crash result; this flow was documented from code, not observed live.

## UI elements
- `#task-submit-debug` button; `#ssh_template` hidden block with `#webterm`, `#webterm_link`, `#commandssh`, `<code>` password; `#task_alert` loading alert with spinner.

## Data
- `submissions.ssh_host` (str), `ssh_port` (int), `ssh_user` (str), `ssh_password` (str) — present only while the job runs.
- Config: `webterm`, `local-config.debug_host`, `local-config.debug_ports`.
- Backend messages: `ClientNewJob.debug = "ssh"`, `BackendJobSSHDebug{job_id, host, port, user, password}` (see backend protocol reference).

## Permissions & security
- Only course admins can request SSH debug (server-side check). The SSH password is sent to the browser in the check response and, with webterm, in the iframe URL query string (format expected by INGInious-xterm).
- The suggested command uses `-o StrictHostKeyChecking=no` (grading containers are ephemeral).
- The check endpoint returns SSH credentials only to users allowed to view the submission (its authors, course staff).

## Acceptance tests
- Course admin task page has `#task-submit-debug` and hidden `@debug-mode`; student task page has neither.
- POST submit with `@debug-mode=ssh` as admin -> `ClientNewJob.debug == "ssh"` sent to the backend (mock backend); as a student -> `debug == False`.
- When the mock backend sends `BackendJobSSHDebug(host="h", port=1234, user="worker", password="p")`, the submission doc gets `ssh_host/ssh_port/ssh_user/ssh_password` and `@action=check` returns `status: waiting` with these four fields and text "<b>SSH server active</b>".
- The UI shows `ssh worker@h -p 1234 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o PreferredAuthentications=password` and the password.
- With `webterm: W` configured an iframe with `src="W?host=h&port=1234&password=p"` is displayed; without it, no iframe.
- On job completion the four `ssh_*` fields and `jobid` are removed from the submission.
- Replay-debug from the submission admin page creates a new submission run with `debug="ssh"`.
