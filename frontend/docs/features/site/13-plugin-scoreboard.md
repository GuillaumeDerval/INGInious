# Plugin "scoreboard": per-course scoreboards based on custom scores

- **ID**: SITE-13
- **Actors**: student registered in the course, course staff, course admin (configures via course.yaml)
- **Routes**: GET /scoreboard/<courseid>, GET /scoreboard/<courseid>/<scoreboardid>
- **Depends on**: SITE-12, SUBMISSION (`custom` dict filled by the grader), COURSE (course.yaml)
- **Legacy code**: `plugins/scoreboard/__init__.py:L1-229`, templates `plugins/scoreboard/{main,scoreboard,course_menu,task_menu}.html`

## Use case
A teacher runs a competition ("fastest program", "best compression ratio"...): the grading script
stores a numeric score with `feedback.set_custom_value("score", x)`; students see a ranking table.

## Preconditions
- Plugin enabled: `- plugin_module: inginious.frontend.plugins.scoreboard` (no options).
- `course.yaml` contains a `scoreboard` list (no UI to edit it — edit course.yaml by hand/WebDAV):
  ```yaml
  scoreboard:
  - name: Code 1 only
    content: code1                      # single task id
  - name: Both code tasks
    content: [code1, code2]             # list → coefficient 1 each
  - name: Weighted reverse
    content: {code1: 2, code2: -1}      # dict taskid → coefficient
    reverse: true                       # lower total is better
  ```

## Main flow
1. Course page left column (hook `course_menu`): if `scoreboard` is non-empty, a box with link
   "Scoreboards" (trophy icon) → `/scoreboard/<courseid>` (`img/scoreboard-course-menu.png`).
2. Task page left column (hook `task_menu`): one link "Scoreboard: <name>" per scoreboard whose
   `content` contains the task id (`img/scoreboard-task-menu.png`).
3. `/scoreboard/<courseid>`: title "<course> - Available scoreboards", heading "Available scoreboards",
   list of links (index → name) (`img/scoreboard-list.png`).
4. `/scoreboard/<courseid>/<n>` (`img/scoreboard-single.png`, `img/scoreboard-multi.png`):
   1. content normalized to ordered `{taskid: coef}`; each task must exist (`course.get_task`) else 404 "Unknown task id <id>";
   2. query `submissions` `{courseid, taskid ∈ content, "custom.score" exists, result: "success"}`
      projecting `taskid, username, custom.score`;
   3. score = `custom.score` as number (`float()` conversion for strings; unparsable → submission skipped);
   4. key = tuple of usernames of the submission (a group = one competitor); per (key, task) keep the
      best score: **max** unless `reverse XOR (coef < 0)`, then **min**;
   5. per key: `total = Σ best*coef` over tasks present, `solved` = number of tasks present;
   6. sort by `(-solved, -total)` or `(-solved, total)` when `reverse`;
   7. rank increments only when `(solved,total)` changes (ties show empty rank cell);
   8. names = realname (or username if no realname / unknown user), sorted, joined with `,`.
   - One task: header `["", "Student(s)", "Score"]`, "Score" column highlighted (`table-info`).
   - Several tasks: header `["", "Student(s)", "Solved", "Total score", <task names...>]`, Solved and
     Total highlighted; per-task cells are the best score or empty.
   Example verified (content `{code1:2, code2:-1}`, reverse): Alice 2 solved 17.0; Bob 2 / 37.0; Carol 1 / 10.0 (Carol's min code1 score 5 kept).

## Alternative / error flows
- Course without `scoreboard` (or empty) → `/scoreboard/<id>` 404.
- Scoreboard entry without `name` → 404 "Invalid configuration".
- Bad index (out of range, non-integer, entry without `content`) → 404.
- Unknown course id → 404 (legacy: 500).
- Plugin disabled → 404.
- Failed/crashed submissions and submissions without `custom.score` are ignored.
- Scores are displayed as Python floats (`20.0`).

## UI elements
Breadcrumb: course name → trophy (list) → scoreboard name. Bootstrap `table table-hover`. Pages are
server-rendered; no JS.

## Data
Reads `course.yaml` `scoreboard`, `submissions` (`courseid`, `taskid`, `username`, `custom.score`, `result`), `users` (`realname`).
No writes.

## Permissions & security
- Only signed-in users registered in the course (students, course staff, superadmins) to whom
  the course is open (course page rule, outside LTI) can read its scoreboards, which show the
  real names of participants; others get 403 "You are not registered to this course.",
  anonymous users are sent to the sign-in page, LTI sessions are refused.
- `task_menu` matches whole task ids (legacy did a substring test when `content` was a
  string: task `code` got a link for scoreboard `code1`).
- No caching: each view scans submissions.

## Acceptance tests
- Course menu link present only when `scoreboard` defined; task menu links only for tasks in content.
- Ranking for the three content forms (string, list, dict with negative coefficient, reverse) matches the algorithm above, including ties (empty rank) and groups (comma-joined names).
- Non-numeric `custom.score` ignored; string numeric score accepted.
- 404 for missing config / bad index / unknown task in content / unknown course (legacy 500).
- A logged-in user not registered in the course cannot read its scoreboards.
