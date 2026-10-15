# Plugin "taskless-hello-world": run a grading job without a task

- **ID**: SITE-21
- **Actors**: superadmin (demo page)
- **Routes**: GET /taskless_hello_world, POST /taskless_hello_world
- **Depends on**: SITE-12, backend client (`ClientSync`), a docker environment named `taskless-hello-world`
- **Legacy code**: `plugins/taskless-hello-world/__init__.py:L1-47`, templates `templates/{call,result}.html`,
  `container/{Dockerfile,run.py}`, `client/client.py:L326-330` (taskless branch of `new_job`)

## Use case
Demonstrates "taskless jobs": a plugin sends arbitrary input to a grading environment without any
course/task (e.g. to run code for a non-graded feature).

## Preconditions
- Plugin enabled: `- plugin_module: inginious.frontend.plugins.taskless-hello-world`.
- A docker agent offers an environment image labelled `org.inginious.grading.name=taskless-hello-world`
  (built from `container/Dockerfile`: `FROM ${REGISTRY}/inginious/env-base`, label
  `org.inginious.grading.advertise="false"` so it is not listed in the task editor, copies `run.py` to `/course/run.py`).

## Main flow
1. `GET /taskless_hello_world` → layout page "Taskless job - basic Hello World" with a form:
   label "Input your name", `input[name=name]`, button "Run Job" (`img/taskless-form.png`).
2. `POST` `name=<str>` → `ClientSync.new_job(priority=0, job_info={"environment_type": "docker",
   "environment": "taskless-hello-world"}, inputdata={"hello_world_name": name},
   launcher_name="Plugin - taskless Hello World", debug=False)`; blocks until the job ends.
3. `run.py` sets global feedback `"Hello World! I am <name>"` and result success.
4. Result page "Taskless job - basic Hello World result" showing `result[1]` (the feedback text),
   e.g. "Hello World! I am Bob" (verified with an environment built locally; `img/taskless-result.png`).

## Alternative / error flows
- Backend disconnected → message "Backend unavailable, retry later" (verified).
- Environment not present on any agent: the backend keeps the taskless job queued; the job is
  killed after a configurable timeout and an error is shown.
- Name is HTML-escaped on output.

## Data
No DB access. Sends `ClientNewJob(course_id=None, task_id=None, problems={}, inputdata, "docker", "taskless-hello-world", {}, False, launcher)`.

## Permissions & security
Superadmins only (starting grading containers is restricted): anonymous users are sent to the
sign-in page, other users get 403 (page and POST); 404 when the plugin is disabled. The POST is
protected by the origin check of form POSTs. Jobs are killed after the plugin option `timeout`
(default 60 s).

## Acceptance tests
- GET shows the form; POST with name "Bob" (env available) shows "Hello World! I am Bob".
- Backend down → "Backend unavailable, retry later".
- Environment not available → the job is stopped after the timeout and an error is shown.
- Non-superadmin → 403; anonymous → sign-in page.
