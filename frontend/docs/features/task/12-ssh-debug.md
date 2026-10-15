# Remote SSH debugging of a submission (course admins)

- **ID**: TASK-12
- **Actors**: course admin, superadmin
- **Routes**: `POST /course/<courseid>/<taskid>` with `@action=submit` and `@debug-mode=ssh`; replay variant `POST /submission/<id>` with `replay-debug` (course admin pages)
- **Depends on**: TASK-08, TASK-09, TASK-24
- **Legacy code**: `legacy/inginious/frontend/pages/tasks.py:L211-L216,L281-L289`, `submission_manager.py:L474,L780-L785`, `templates/task.html:L308-L320,L390-L402`, `static/js/task.js:L18-L21,L279-L287,L339-L345,L462-L500`, container API `scripts/INGInious.py` (`start_ssh_server`, `ssh_wait`)

## Use case
A task author wants to inspect the grading container interactively: instead of running the
grading script, the container starts an SSH server and the page shows how to connect.

## Preconditions
User has admin rights on the course (`has_admin_rights_on_course`); docker-type environment; agent able to expose a port.

## Main flow
1. The admin sees the terminal button `#task-submit-debug` next to Submit; click → `submitTask(true)` sets hidden `@debug-mode=ssh`.
2. Server: `debug = is_admin`; `@debug-mode == "ssh"` and admin → `debug = "ssh"`; job sent with `debug="ssh"` and an `ssh_callback`.
3. Container: does not run `run`; starts sshd for user `worker` (or root if `run_as_root`), sends `ssh_debug` info; the backend relays `BackendJobSSHDebug(host, port, user, password)`; the frontend stores `ssh_host`, `ssh_port`, `ssh_user`, `ssh_password` in the submission (`_handle_ssh_callback`, ignores calls with host None).
4. Polling returns `{"status":"waiting","text":"<b>SSH server active</b>","ssh_host":…,"ssh_port":…,"ssh_user":…,"ssh_password":…}`; JS `displayRemoteDebug` clones `#ssh_template`: text "Paste this command into your terminal:" (or the `webterm` iframe `<webterm>?host=<h>&port=<p>&password=<pw>` + "Alternatively, you can also paste this command into your terminal:"), `<pre id="commandssh">ssh <user>@<host> -p <port> -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o PreferredAuthentications=password</pre>`, "The password to connect is <code>pw</code>", plus the kill button. Re-rendered only when the command changes.
5. When the admin logs out of SSH (or after 30 min / nobody connected → result crash "[SSH Debug] Nobody connected to the SSH server."), the job ends; `ssh_*` fields are unset at completion.

## Alternative / error flows
- Non-admin posting `@debug-mode=ssh` → ignored (`debug=False`), normal grading.
- `debug="ssh"` without callback → crash "SSH callback not set." (not reachable from the page).

## UI elements
Terminal button (tooltip "Start remote SSH console with this input"), SSH info card, optional webterm iframe.

## Data
`submissions.ssh_host` (str), `ssh_port` (int), `ssh_user` (str), `ssh_password` (str) while running; removed on completion.

## Permissions & security
- The SSH connection info (including its one-time password) is kept on the submission only while the job runs (unset at completion). Only course admins can start an SSH debug job; the connection info is shown on the task page while the job runs.
- The displayed SSH command skips host key checking (the debug container is ephemeral).

## Acceptance tests
- As superadmin on `outcomes`, click the SSH button → `check` returns the ssh fields; the page shows the `ssh worker@… -p …` command and the password; killing the submission ends it with `killed`.
- As student, posting `@debug-mode=ssh` produces a normal graded submission.
