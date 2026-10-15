# Task model (`task.yaml`) — reference

This document describes every key of a task description file
(`<tasks_directory>/<courseid>/<taskid>/task.yaml`) as interpreted by the legacy frontend
(`legacy/inginious/frontend/tasks.py`, `task_problems.py`, `common/tasks_problems.py`,
`environment_types/*.py`) and by the grading agents (`agent/mcq_agent`, docker agent).
The rewrite must read (and, for the studio, write) **exactly** this format: the same files are
read by the unchanged backend/agents (the agent receives `task_problems` = the raw `problems`
dict and `environment_parameters`).

Showcase tasks covering every key: `infra/tasks/task_showcase/` (see TASK-xx feature files).

## 1. File, ids and loading

| Aspect | Rule |
|---|---|
| Location | `<tasks_directory>/<courseid>/<taskid>/task.yaml`. A folder of the course is a task iff it contains `task.yaml` (`Course.get_readable_tasks`). `task.json` is also accepted by `loads_json_or_yaml` (decided by extension) but the frontend only looks for `task.yaml`. |
| Ids | `courseid`, `taskid` and every problem id must match `id_checker` = `re.match(r"[a-z0-9\-\._]+$", id, re.IGNORECASE)` (letters, digits, `-`, `.`, `_`; `common/base.py:L17`). Invalid → `InvalidNameException` / exception "Invalid problem _id". |
| Parsing | YAML via `inginious.common.custom_yaml` (ordered dicts; YAML 1.1 → beware `yes`/`no`/`on`/`off` keys and values become booleans). |
| Caching | `fetch_or_cache(task_fs, "task.yaml", loader)`: the `Task` object is cached per process and reloaded when the file mtime changes. |
| Errors | Unreadable YAML → `TaskUnreadableException` → **HTTP 500** on the task page (not handled). Invalid content (bad problem, unknown env type, invalid limits…) → generic `Exception` → 500 on the task page; the course page/task list silently skips the task (logged "Couldn't load task"). |
| i18n | Translations (`<lang>.mo`) are looked up, first existing folder wins: `<task>/$i18n/`, `<task>/student/$i18n/`, `<course>/$common/$i18n/`, `<course>/$common/student/$i18n/`. Every human text (`name`, `context`, `author`, problem `name`/`header`, MCQ `text`/`feedback`/`success_message`/`error_message`) is passed through `gettext(language, text)` with the user's session language. The mcq agent does the same lookup on its side. |

## 2. Top-level keys

| Key | Type | Default | Meaning / notes |
|---|---|---|---|
| `name` | str | `"Task <taskid>"` | Task title (translated). Shown in `<title>`, breadcrumb, `<h2>`. |
| `context` | str (RST) | `""` | Statement, rendered with `ParsableText(..., "rst")` (see TASK-19; the new app sanitizes the output). The `task_context` plugin hook may replace it. |
| `author` | str | `""` | Displayed in the "Information" table ("Author(s)"). Non-string values are ignored (treated as ""). |
| `contact_url` | str | `""` | Displayed as "Contact link" (`target=_blank`). It is a Python `str.format` template receiving `course_id`, `task_id`, `username` (e.g. `mailto:x@y?subject={course_id}/{task_id}`). Non-string ignored. A stray `{` in the URL crashes the page (format error → 500). |
| `problems` | ordered map `problemid → problem` | **required** | Missing → exception "Tasks must have some problems descriptions". Order of the map = display order ("Question 1", "Question 2"…). See §4. May be empty `{}` (then the page has no question; the mcq agent answers `crashed` "No subproblems defined"). |
| `environment_type` | str | `"unknown"` | Must be a registered frontend env type: `docker`, `docker-ssh`, `nvidia`, `nvidia-ssh`, `mcq`. Unknown → exception "Environment type {0} is unknown" (task unloadable). `*-ssh` variants allow the `ssh_student` command inside the container (student SSH sessions). |
| `environment_id` | str | `"default"` | Environment inside the type: for docker the grading image alias (here `default`, `python3`); for `mcq` it must be `mcq`. Sent in `ClientNewJob.environment`. If the backend does not advertise `(environment_type, environment_id)`, the job immediately ends with result `crash`, text "Environment not available.". |
| `environment_parameters` | map | `{}` | Env-type dependent, normalized by `check_task_environment_parameters` (§3). Sent as `ClientNewJob.environment_parameters`. |
| `input_random` | int (or numeric string) | `0` | Number of random floats generated per user (`int(...)`; `'1'` accepted). See TASK-17. |
| `regenerate_input_random` | bool-ish | `false` | `bool(value)`: any non-empty string (even `"off"`) is **true**; the studio writes `'on'` when checked and omits the key otherwise. When true, new random values at every page display. |
| `network_grading` | bool | — | Written top-level by the studio (`"network_grading" in form`) but **not read** by the frontend from there; the effective value is `environment_parameters.network_grading` (or the legacy migration below). |
| `environment` | str | — | **Legacy v0.6** (§5). |
| `limits`, `run_cmd` | — | — | **Legacy v0.6** top-level env parameters (§5). |
| `weight`, `submission_limit`, `stored_submissions`, `groups`, `evaluate`, `accessible`, `categories` | — | — | **Legacy dispenser fields** (§6). Ignored at runtime; only used by the course-admin "import legacy task settings" action. |
| `order`, `file`, other unknown keys | any | — | Ignored by the frontend core but preserved in the file (the `Task` keeps the raw dict and `save()` rewrites it). Plugins may read extra keys (e.g. `task_editor_hook_example`, `contests`). |

## 3. `environment_parameters`

### docker / docker-ssh / nvidia / nvidia-ssh (`GenericDockerOCIRuntime.check_task_environment_parameters`)

Output (what the agent receives):

```yaml
run_cmd: null | "<command line>"   # '' or missing -> null ; split on spaces by the container
network_grading: false             # raw value copied (no bool conversion)
limits:
  time: 20        # CPU time in seconds, int(...)
  hard_time: 60   # wall time, '' or missing -> 3*time
  memory: 1024    # MiB
  disk: 1024      # MiB
```

- Defaults when `limits` is absent: `{time: 20, memory: 1024, disk: 1024}` (**no `hard_time` key**).
- When `limits` is present every value goes through `int()` (strings like `'30'` accepted); any value ≤ 0 or non-integer → exception "Invalid limit" (task unloadable).
- `run_cmd`: when null the container runs `/task/run`, else `run.py`/`run.py3` (with `inginious-ipython`), `run.sh` (bash), then the same in `/course/common`, `/course` (container API `_detect_run_file`).
- Legacy flag `ssh_allowed: true` turns `environment_type` into `<type>-ssh` (v0.8.5 retro-compatibility).

### mcq (`MCQEnvType`)
Always normalized to `{}`.

## 4. Problems

Common keys for every problem: `type` (required, one of the registered types — unknown →
"Invalid type for problem <id>"), `name` (str, default `""`, translated). If the task has exactly one
problem and its `name` is empty, the problem card has no header; otherwise the header is
`"Question <n>: <name>"` (the "Question n:" prefix only when there are ≥ 2 problems).

The frontend uses 3 *input types* to build the submission input from the form (see TASK-08):
`str` (form value), `list` (all values of the field), `dict` (uploaded file).

### 4.1 `code`
| Key | Type | Default | Notes |
|---|---|---|---|
| `header` | RST | `""` | Displayed above the editor. |
| `language` | str | `"plain"` | Must match `^[a-z0-9\-_\.]+$` (case-insensitive) else exception "Invalid language". CodeMirror mode name (python, java, c, cpp, shell, ocaml, …). |
| `default` | str | `""` | Initial content of the editor. |
| `optional` | bool-ish | `false` | Empty answer accepted (stored as `""`). |
| `offset` | int ≥ 1 | `1` | First line number shown in the editor (studio: empty → removed, < 1 or non-int → error). |
- Input type `str`. Consistency: key present and `len(value) > 0` unless optional.
- Grading: never by the frontend; `check_answer` returns `None` (needs a container). In an `mcq` task the mcq agent refuses the job ("Task wrongly configured as a MCQ" → crash).

### 4.2 `code_single_line`
Same keys and rules as `code` (subclass): `header`, `default`, `optional`, `language` (validated
but unused by the template), `offset` (unused). Rendered as `<input type="text" class="monospace form-control">`.

### 4.3 `file`
| Key | Type | Default | Notes |
|---|---|---|---|
| `header` | RST | `""` | |
| `allowed_exts` | list[str] | config `allowed_file_extensions` (default `[".c",".cpp",".java",".oz",".zip",".tar.gz",".tar.bz2",".txt"]`) | Suffix match on the file name (`str.endswith`), case-sensitive. Studio writes a comma-separated string, converted to a list. |
| `max_size` | int (bytes) | config `max_file_size` (default 1 048 576) | Server compares `sys.getsizeof(bytes)` (= len + 33) — see TASK-04. |
- Input type `dict`; stored as `{"filename": str, "value": bytes}` (BSON binary). Not optional.

### 4.4 `multiple_choice`
| Key | Type | Default | Notes |
|---|---|---|---|
| `header` | RST | `""` | |
| `multiple` | bool | `false` | Checkboxes (input `list` of indexes) vs radios (input `str` index). |
| `choices` | list of `{text, valid?, feedback?}` | **required** | Must be a list; each choice needs `text` (RST, translated); `valid` truthy = correct; `feedback` (RST, optional) shown when the choice is selected. At least one valid choice required ("does not have any valid answer"). Choice *index* = position in this list (0-based), used as the form value. |
| `limit` | int ≥ 0 | `0` (= all) | Max number of choices displayed. Must be an `int` ≥ 0 and, if `multiple`, either 0 or ≥ number of valid choices; else exception "Invalid limit". Single: shows up to `limit-1` invalid + ≥1 valid; multiple: all valid + invalid up to `limit`. |
| `unshuffle` | bool | `false` | Keep the original order (otherwise shuffled with seed `"<pid>#<lang>#<username>"`). |
| `centralize` | bool | `false` | Do not add the internal "_wrong_answer…" message per problem. |
| `success_message` | RST | none | Prepended to the problem feedback when correct. |
| `error_message` | RST | none | Prepended to the problem feedback when wrong (replaces the internal wrong-answer message even if not centralized). |
| `optional` | — | — | Accepted by the studio parser (stored as `true`) but **ignored**: an MCQ must always be answered. |

### 4.5 `match`
| Key | Type | Default | Notes |
|---|---|---|---|
| `header` | RST | `""` | |
| `answer` | scalar | **required** | Converted with `str()` (YAML `42` → `"42"`). Compared with `input.strip() == answer` (case-sensitive, inner spaces significant). |
| `centralize` | bool | `false` | Suppress per-problem "Correct answer"/"Wrong answer". |
- Input type `str`; consistency only checks that the key exists (an empty string is accepted).

### 4.6 Plugin problem types
Plugins can register extra types via `register_problem_types` (frontend `DisplayableProblem`
subclasses + common `Problem` subclasses for the agents). JS hooks `load_input_<type>` and
`load_feedback_<type>` must exist for each type used on a task page.

## 5. Legacy (v0.6) environment format — `_migrate_from_v_0_6`

If the key `environment` exists:
```
environment_id         = environment
environment_type       = "mcq" if environment == "mcq" else "docker"
environment_parameters = {limits: <limits or {}>, run_cmd: <run_cmd or ''>, network_grading: <network_grading or False>}
del environment
```
(Showcase: `task_showcase/legacy_env`.) The migration happens in memory; the file is rewritten
only if the task is saved from the studio.

## 6. Legacy dispenser fields (now in `course.yaml`)

Since v0.9 these settings live in `course.yaml` → `dispenser_data.config.<taskid>` (table of
contents dispenser `toc`); in `task.yaml` they are **ignored at runtime**:

| task.yaml (legacy) | course.yaml `dispenser_data.config.<taskid>` key | Type / default | Validation (`task_dispensers/util.py`) |
|---|---|---|---|
| `weight` | `weight` | number ≥ 0, default `1` | non-numeric/negative → InvalidTocException |
| `submission_limit` | `submission_limit` | `{amount:int, period:int}`, default `{amount:-1, period:-1}` | ints ≥ -1; `amount=-1` with `period≠-1` rejected. `period` in **hours**. |
| `stored_submissions` | `no_stored_submissions` | int ≥ 0, default `0` (= keep all) | |
| `groups` | `group_submission` | bool, default `false` | must be a real bool |
| `evaluate` | `evaluation_mode` | `"best"` \| `"last"`, default `"best"` | anything else rejected (**no `student` mode in this version**) |
| `accessible` | `accessibility` | `true` \| `false` \| `"start / soft_end / end"` string, default **`false`** | parsed by `AccessibleTime` |
| `categories` | `categories` | list[str], default `[]` | `""` rejected |

`TableOfContents.import_legacy_tasks()` copies these fields from all task files into the course
config (course-admin action). **Default accessibility is `false`**: a task listed in the TOC
without config is invisible to students.

Gotcha: the dispenser prunes config entries of tasks that do not exist **when the course is
loaded**, mutating the cached `course.yaml` content; the course object is cached until the
`course.yaml` mtime changes. Creating task folders after the course was first loaded leaves
them closed until `course.yaml` is touched.

`AccessibleTime` string formats: `"<start>"`, `"<start> / <end>"`, `"<start> / <soft_end> / <end>"`,
each part ISO (`2024-01-31 23:59:59`, `datetime.fromisoformat`) or `%d/%m/%Y[ %H[:%M[:%S]]]`,
empty part = unbounded; interpreted in the **server local timezone** (`.astimezone()`); a soft
end after the hard end is clamped to the hard end.

## 7. Task folder layout (files used around the task)

| Path | Use |
|---|---|
| `task.yaml` | description |
| `run`, `run.py`, `run.sh`, … | grading script (docker), mounted read-only as `/task` |
| `public/**` | files served at `/course/<courseid>/<taskid>/<path>` (TASK-22) |
| `<course>/$common/public/**` | served at `/course/<courseid>/$common/<path>` |
| `<course>/$common/**` | mounted as `/course/common` in the grading container |
| `$i18n/*.mo`, `student/$i18n/*.mo` | translations |
| `student/**` | files copied in the student container (container API) |

## 8. Example (complete, docker)

```yaml
name: Python code - count to n
author: INGInious test-suite
contact_url: mailto:teacher@example.org?subject={course_id}/{task_id}/{username}
context: |
    Write a Python function ``count_to(n)``...
environment_type: docker
environment_id: default
environment_parameters:
    limits: {time: 10, hard_time: 30, memory: 256, disk: 100}
    run_cmd: ''
    network_grading: false
input_random: 0
problems:
    code:
        type: code
        name: Your function
        header: Implement ``count_to(n)``.
        language: python
        offset: 3
        default: |
            def count_to(n):
                pass
```
