# Random inputs (per-student parameters)

- **ID**: TASK-17
- **Actors**: student, course admin (configures `input_random`)
- **Routes**: `GET`/`POST /course/<courseid>/<taskid>`
- **Depends on**: TASK-01, TASK-08
- **Legacy code**: `legacy/inginious/frontend/pages/tasks.py:L112-L120,L175-L181`, `tasks.py:L108-L112,L192-L198`, `templates/task.html:L292-L302,L360-L363,L436-L440`, `submission_manager.py:L462`

## Use case
Give each student different numbers (e.g. "solve 2x² − 18 = 0") so that answers cannot be copied;
both the statement (JS) and the grading script see the same values.

## Preconditions
`input_random: N > 0` in task.yaml; optionally `regenerate_input_random: true`.

## Main flow
1. On every GET of the task page: `random.seed(str(username or "") + taskid + courseid + (str(time.time()) if regenerate else ""))` (global `random` module!), `random_input_list = [random.random() for _ in range(N)]`.
2. `user_tasks.random` is **overwritten** with the list (same values for the same user unless regenerate).
3. Exposed to the page: JS `input["@random"]` (array of floats, Python repr e.g. `[0.051084…, 0.838430…]`) and hidden fields `<input type="hidden" name="@random_<i>" id="random_input" value="<float>">`.
4. Submit: every `@random_<i>` must be present and `float(value) == user_tasks.random[i]` else "Your task has been regenerated. This current task is outdated." (so opening the task in a second tab with regeneration invalidates the first tab).
5. The job input contains `@random` = `user_tasks.random` (list of floats).
6. Grading scripts: `input.get_input("@random")` / `getinput @random` (JSON list).

## Alternative / error flows
- `N = 0` → `random: []` still written at each display.
- Non-float `@random_<i>` → "Your task has been regenerated. This current task is outdated.".
- Anonymous preview → seed with "" username.

## UI elements
Hidden inputs; values typically displayed by `.. raw:: html` scripts in the context.

## Data
`user_tasks.random: [float]`; submission input `@random: [float]`.

## Permissions & security
- Values are derived from username+taskid+courseid: they are a per-student variation, not a secret.
- Generation uses its own generator instance (no shared global random state).

## Acceptance tests
- `task_showcase/random_inputs`: two GETs give the same 2 values; `user_tasks.random` equals them; submitting `int(r0*100)+int(r1*100)` → success.
- Posting without `@random_0` or with a modified value → "Your task has been regenerated. This current task is outdated.".
- `random_regen`: each GET changes the value; submitting the form of an older tab → outdated error; the current tab succeeds.
- Values are identical between the legacy and the rewrite for the same (username, taskid, courseid) — **requires reproducing CPython's `random.seed(str)` + `random.random()` (Mersenne Twister with SHA-512 string seeding)**, or document a deliberate divergence (stored `user_tasks.random` is the source of truth).
