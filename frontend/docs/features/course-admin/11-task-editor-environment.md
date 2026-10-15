# Task editor: grading environment tab

- **ID**: CADM-11
- **Actors**: course admin, superadmin
- **Routes**: part of `GET|POST /admin/<courseid>/edit/task/<taskid>` (CADM-10)
- **Depends on**: CADM-10, backend protocol (list of available environments per type, `docs/reference/backend-protocol.md`), reference `docs/reference/task-model.md` §3
- **Legacy code**: `legacy/inginious/frontend/templates/course_admin/edit_tabs/environment.html:L1-L38`, `edit_tabs/env_generic_docker_oci.html:L1-L40`; `environment_types/__init__.py:L1-L30`, `environment_types/generic_docker_oci_runtime.py:L1-L60`, `docker.py`, `nvidia.py`, `mcq.py`; `submission_manager.get_available_environments()`; `static/js/studio.js:L46-L54` (`studio_update_environments`)

## Use case
The admin chooses in which kind of grading environment (container image) the task runs and its resource limits.

## Main flow
1. Select `environment_type` "Grading environment type" listing registered env types in registration order:
   `docker` "Standard container", `docker-ssh` "Standard container + SSH", `nvidia` "Container with GPUs (NVIDIA)", `nvidia-ssh` "Container with GPUs (NVIDIA) + SSH", `mcq` "Multiple Choice Question solver" (plugins may register more). Selected = `task_data.environment_type`.
2. One box `#environment-box-<type>` per type; only the selected one is shown (`studio_update_environments` on change). Each contains select `environment_id[<type>]` "Grading environment" with the environments the backend reports for that type (`get_available_environments()` → `{type: [env ids]}`), sorted; selected = `task_data.environment_id`.
3. For docker/nvidia types (`env_generic_docker_oci.html`, ids prefixed `<type>-`):
   - `envparams[<type>][limits][time]` number "Timeout limit (in seconds)" (default shown 30)
   - `envparams[<type>][limits][hard_time]` number "Hard timeout limit (in seconds) <small>Default to 3*timeout</small>" (default empty)
   - `envparams[<type>][limits][memory]` number "Memory limit (in megabytes)" (default shown 100)
   - `envparams[<type>][network_grading]` checkbox "Allow internet access inside the grading container?" (tooltip "It also adds and configures local interfaces with IPv4 and IPv6.")
   - `envparams[<type>][run_cmd]` text "Custom command to be run in container <small>(instead of running the run script)</small>" (placeholder "Optional")
   `mcq` has no parameters.
4. All boxes are posted (hidden ones too); the server keeps only `envparams[<selected type>]` and `environment_id[<selected type>]`.
5. Validation (`Task` → `check_task_environment_parameters`): docker-like: `time` int (default 20), `hard_time` int or `3*time` if blank, `memory` int (default 1024), `disk` int (default 1024, not in UI), all > 0, else "Invalid data: Invalid limit"; `run_cmd` `''` → `None`; `network_grading` default False. mcq → `{}`.
6. **But the stored value is the raw form data** (verified):
   ```yaml
   environment_id: ingi/inginious-c-default
   environment_parameters:
       limits:
           time: '15'
           hard_time: ''
           memory: '256'
       network_grading: 'on'
       run_cmd: python3 run.py
   environment_type: docker
   network_grading: false
   ```
   Strings for numbers, `'on'` for the checkbox (absent when unchecked), `hard_time: ''`, `run_cmd: ''` when empty. The
   cleaned/typed values are only computed when the task is loaded. The rewrite must write a YAML that loads to the
   same effective parameters (the backend receives the cleaned values); preferably typed, but readers must accept the legacy string form.
7. For `mcq`: `environment_id: mcq` (if offered by the backend), `environment_parameters: {}`.

## Alternative / error flows
- No environment of the selected type available → save impossible ("Your browser returned an invalid form ('NoneType' object has no attribute 'get')") — verified in the shared environment where the backend lists no environment.
- `time=0` → "Invalid data: Invalid limit"; unknown type → "Invalid data: Environment type <x> is unknown".
- Default values displayed (30 s / 100 MB) differ from the defaults applied when keys are absent (20 s / 1024 MB).
- Legacy v0.6 format (`environment`, `limits`, `run_cmd`… at top level) is migrated in memory at load (`_migrate_from_v_0_6`) and therefore written in the new format at the next save.

## Data
- `task.yaml`: `environment_type`, `environment_id`, `environment_parameters`, top-level `network_grading: false`.

## Permissions & security
- The "Grading environment" select offers the environments reported by the backend for the selected type (plus the
  task's current value). A submission whose environment is not reported by the backend is not sent for grading: it
  ends immediately as a crash ("Environment not available.").
- `run_cmd` is executed inside the grading container (by design).

## Acceptance tests
- Env type select shows the 5 built-in types; switching shows the matching box.
- Saving docker type with time 15, memory 256, network on, run_cmd → YAML above (or typed equivalent loading to the same values); reloading the editor shows the same values.
- `time=0` → error; blank `hard_time` → effective 3×time.
- Backend with no environments → explicit error, not a crash.
