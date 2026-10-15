# Grading environment types and available environments

- **ID**: SITE-24
- **Actors**: course admin (task editor), system (task loading, job submission)
- **Routes**: GET/POST /admin/<courseid>/edit/task/<taskid> (environment tab); no dedicated route
- **Depends on**: TASK-EDIT, SUBMISSION, backend protocol (`BackendUpdateEnvironments`, `ClientNewJob`)
- **Legacy code**: `frontend/environment_types/{__init__,env_type,generic_docker_oci_runtime,docker,nvidia,mcq}.py`,
  `frontend/tasks.py:L32-46` (`_migrate_from_v_0_6`), `L78-87` (validation), `client/client.py:L42-50,L207-210,L265-270,L318-335`,
  `backend/backend.py:L108-117`, `pages/course_admin/task_edit.py:L43-52,L70-93`,
  templates `course_admin/edit_tabs/environment.html`, `course_admin/edit_tabs/env_generic_docker_oci.html`,
  `static/js/studio.js:L46-54`

## Use case
Each task runs in a grading environment: a *type* (which agent / runtime: standard container,
container with SSH, NVIDIA GPU container, MCQ solver) and an *environment id* (docker image alias like
`default`, `python3`, or `mcq`). The course admin chooses them in the task editor among what the
connected agents currently offer, plus type-specific parameters (limits, network, custom command).

## Environment types (registered at start-up by `register_base_env_types()`, in this order)
| id | name (translated) | class | parameters |
|---|---|---|---|
| `docker` | "Standard container" | `DockerEnvType(ssh_allowed=False)` | generic OCI (below) |
| `docker-ssh` | "Standard container + SSH" | `DockerEnvType(ssh_allowed=True)` | generic OCI |
| `nvidia` | "Container with GPUs (NVIDIA)" | `NvidiaEnvType()` | generic OCI |
| `nvidia-ssh` | "Container with GPUs (NVIDIA) + SSH" | `NvidiaEnvType(ssh_allowed=True)` | generic OCI |
| `mcq` | "Multiple Choice Question solver" | `MCQEnvType` | none (`{}`), no extra form |

`FrontendEnvType` interface: `id`, `name`, `check_task_environment_parameters(data) -> dict` (raise on
invalid), `studio_env_template(task_data) -> html`. Registration API: `register_env_type(obj)`,
`get_env_type(id)`, `get_all_env_types()` (dict id → obj, insertion order). The WebDAV app also registers them.

### Generic OCI parameters (`GenericDockerOCIRuntime.check_task_environment_parameters`)
Input `data` = `environment_parameters` dict; output (stored on the Task object, and what is sent to the agent):
- `run_cmd`: `None` if missing/empty string, else the string;
- `network_grading`: `data.get("network_grading", False)` (as given — the editor sends `"on"` for a checked box);
- `limits`: default `{"time": 20, "memory": 1024, "disk": 1024}` if `limits` absent; if present:
  `time=int(limits.time or 20)`, `hard_time = 3*time` if missing/blank else `int`, `memory=int(.. or 1024)`,
  `disk=int(.. or 1024)`; any value ≤ 0 or non-integer → `Exception("Invalid limit")`
  (task fails to load / editor save returns "Invalid data: Invalid limit").

Editor form (`env_generic_docker_oci.html`, one block per type id): "Timeout limit (in seconds)"
`envparams[<type>][limits][time]` (placeholder 30, default value 30), "Hard timeout limit (in seconds)
Default to 3*timeout" `[limits][hard_time]`, "Memory limit (in megabytes)" `[limits][memory]`
(default value 100), checkbox "Allow internet access inside the grading container?" (tooltip "It also adds
and configures local interfaces with IPv4 and IPv6.") `[network_grading]`, "Custom command to be run in
container (instead of running the run script)" `[run_cmd]` (placeholder "Optional").
No disk limit field in the form (disk default 1024 applies).

## Available environments (from the backend)
1. Agents announce their environments to the backend (`AgentHello`: per env type, name → {id, created, advertised}).
2. Backend sends `BackendUpdateEnvironments(available_environments)` to every client on `ClientHello`
   and whenever agents change: `{env_type: [env names with advertised=True]}`.
   Example (reference env): `{"docker": ["default", "python3"], "mcq": ["mcq"]}` (images labelled
   `org.inginious.grading.name=<name>`; `org.inginious.grading.advertise="false"` images such as
   `taskless-hello-world` are hidden but still runnable).
3. The frontend client stores it (`_available_environments`, reset to `{}` on each (re)connection attempt `_on_connect`, so it stays empty while the backend is unreachable);
   `submission_manager.get_available_environments()` returns it.
4. When a task submission is sent (`Client.new_job` with course+task), if `environment_type` or
   `environment` is not available → job immediately ends with result `("crash", "Environment not available.")`.

## Task editor flow
1. Environment tab (`img/task-editor-environment-tab.png`): select "Grading environment type"
   `name="environment_type"` with all registered types (selected = task's type); for each type a box
   `#environment-box-<type>` containing select "Grading environment" `name="environment_id[<type>]"` with the
   **sorted** names available for that type from the backend (selected = task's `environment_id`), followed
   by the type's `studio_env_template`. JS `studio_update_environments()` shows only the box of the selected type.
   If the backend is disconnected all environment selects are empty (verified on the reference frontend after
   the backend went down).
2. Save: `environment_type = form.environment_type`; `environment_id = environment_id[<type>]` (or "");
   `environment_parameters = envparams[<type>]` dict (or `{}`). Stored in task.yaml as
   `environment_type`, `environment_id`, `environment_parameters`; then `Task(...)` validates the type
   (unknown → "Environment type X is unknown") and the parameters.
3. Legacy task migration on load (`_migrate_from_v_0_6`): old key `environment` → `environment_id`;
   `environment_type = "mcq" if environment_id == "mcq" else "docker"`; `environment_parameters =
   {limits, run_cmd, network_grading}` from old top-level keys; if `environment_parameters.ssh_allowed`
   is true → type suffixed `-ssh`. (In-memory only, the file is rewritten on next editor save.)
4. `-ssh` types allow the SSH debug mode for students on the task page (TASK/SUBMISSION areas).

## Alternative / error flows
- Task with unknown `environment_type` → task unreadable (listed with error in the course admin task list).
- Environment id not currently offered: editor shows no selected option (value lost on save unless re-chosen); submissions crash with "Environment not available.".

## Data
task.yaml keys: `environment_type` (str), `environment_id` (str), `environment_parameters`
(dict: `limits {time, hard_time, memory, disk}`, `run_cmd`, `network_grading`; `{}` for mcq).
Backend messages: `BackendUpdateEnvironments.available_environments: Dict[str, List[str]]`.

## Permissions & security
Editor requires course admin. `run_cmd` and network access are admin-controlled by design.

## Acceptance tests
- Editor lists the 5 types in order with the exact names; environment selects reflect the backend list (sorted) per type.
- Saving docker task with limits stores the parameters; hard_time defaults to 3×time when blank; 0/negative/non-int → "Invalid limit".
- mcq type stores `environment_parameters: {}`.
- Legacy `environment: default` task loads as `docker/default`; `ssh_allowed: true` → `docker-ssh`.
- Submitting to a task whose environment is not offered → submission error "Environment not available.".
