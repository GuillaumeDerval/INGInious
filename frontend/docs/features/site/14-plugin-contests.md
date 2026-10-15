# Plugin "contests": ACM-ICPC style contest task dispenser and scoreboard

- **ID**: SITE-14
- **Actors**: course admin (configures), student (participates and reads the scoreboard), course staff
- **Routes**: GET /contest/<courseid>; app: GET|POST /contest/<courseid>/admin (settings); legacy: configuration through POST /admin/<courseid>/tasks (task dispenser form)
- **Depends on**: SITE-12, COURSE-ADMIN task list / task dispensers (TOC), SUBMISSION
- **Legacy code**: `plugins/contests/__init__.py:L1-257`, templates `plugins/contests/{admin,contests,course_menu,scoreboard}.html`,
  static `static/plugins/contests/{contests.js,jquery.countdown.min.js,scoreboard.css}`,
  `pages/course_admin/task_list.py:L28-91`, `task_dispensers/toc.py`

## Use case
A teacher organises a timed programming contest: all tasks become visible at the start time; the
ranking counts solved problems then total time (minutes since start + penalty per wrong try); the
ranking can be frozen ("blackout") during the last hours.

## Preconditions
- Plugin enabled (`- plugin_module: inginious.frontend.plugins.contests`, no options). It registers:
  task dispenser `contest` (name "Contest"), page `/contest/<courseid>`, hooks `css`
  (`/static/plugins/contests/scoreboard.css`), `javascript_header` (`jquery.countdown.min.js`,
  `contests.js`) — these assets are included in **every page** of the site — and `course_menu`.
- Course task dispenser set to "Contest" (Tasks page → "Switch task dispenser"), which resets `dispenser_data` to `{}`.

## Main flow
App behaviour (`app/src/lib/server/plugins/bundled/inginious.frontend.plugins.contests.ts`):
the contest settings (same fields, validation and stored format) have their own page
`/contest/<courseid>/admin` (course admins only, plugin enabled), a rejected form never
changes the running contest, the course menu shows links instead of the JavaScript
countdown (no contest assets are added to every page), and the scoreboard page shows the
dates and refreshes itself every 30 seconds. The legacy configuration flow below is kept
for reference.

### Configuration (course admin)
1. `/admin/<courseid>/tasks` with dispenser `contest` renders `contests/contests.html`: the
   "Contest settings" block (`contests/admin.html`, `img/contest-admin-settings.png`) + the regular TOC editor.
   Help text explains that the contest start overrides task accessibility.
   Fields (form `#task_dispenser_settings_form`): "Enable contest plugin" checkbox `enabled`;
   "Contest starts" `start` and "Contest ends" `end` (datetimepicker, format `YYYY-MM-DD HH:mm:ssZ`,
   placeholder `2014-06-29 10:00:00`); "Blackout duration (in hours)" `blackout`;
   "Penalty for wrong submissions (in minutes)" `penalty`.
2. "Save changes" → `dispenser_submit('contest')` → JS `dispenser_structure_contest()` posts
   `course_structure = JSON {toc: [...], config: {...}, settings: {enabled: bool, start, end, blackout, penalty}}`
   (+ `new_tasks`, `deleted_tasks`, `wiped_tasks`).
3. `Contest.check_dispenser_data`: TOC validation, then `enabled = (settings.enabled == True)`,
   `start/end` must parse with `datetime.fromisoformat` ("Invalid start date" / "Invalid end date"),
   `start < end` ("Start date should be before end date"), `blackout` int ≥ 0
   ("Invalid number of hours for the blackout" / "...: should be greater than 0"), `penalty` int ≥ 0
   ("Invalid number of minutes for the penalty" / "...: should be greater than 0"); missing keys →
   "User returned an invalid form". Errors displayed as "Something wrong happened: Invalid course structure: <msg>".
   A request without `settings` → "Something wrong happened: 'settings'".
4. Saved `course.yaml` (verified):
   ```yaml
   task_dispenser: contest
   dispenser_data:
       contest_settings: {enabled: true, start: '2026-10-14 04:42:01+00:00', end: '2026-10-15 05:42:01+00:00', blackout: 2, penalty: 30}
       toc_data:
           config: {code1: {}, mcq1: {}}
           imported: false
           settings: {blackout: '2', enabled: true, end: '...', penalty: '30', start: '...'}   # raw form copy (strings)
           toc: [{title: Problems, tasks_list: [mcq1, code1]}]
   ```
   Defaults when `contest_settings` absent: `enabled: false`, `start: now`, `end: now+1h`, `blackout: 0`, `penalty: 20`.

### Effect on tasks
- `enabled: true`: every task present in the TOC gets accessibility `AccessibleTime(start + "/")`
  (open from start, never closes); tasks not in the TOC are inaccessible. TOC per-task
  accessibility is ignored. `enabled: false`: normal TOC behaviour.

### Course page (hook `course_menu`, `img/contest-course-menu.png`)
Shown only if dispenser is `contest` and enabled: heading "Contest"; "Contest starts: <time>",
"Contest ends: <time>"; countdown ("Contest starts in: …" before start — page reloads when it reaches
0 — or "Time remaining: …" and "Blackout in …" (only if blackout > 0), then "Contest ended!"/"Blackout");
link "Scoreboard" → `/contest/<courseid>`.

### Scoreboard `/contest/<courseid>` (`img/contest-scoreboard.png`)
1. Competitors = `get_course_registered_users(course)` = `set(courses.students + course staff (admins + tutors))`
   (unordered set; verified "Site Admin" row); tasks = **all** course tasks (`course.get_tasks()` keys, not only the TOC).
2. Submissions `{username ∈ users, courseid, submitted_on ∈ [start, end-blackout), status: "done"}` sorted by date.
3. Per user and task, until accepted: `success` → status `ACF` if first success on this task among
   all users, else `AC`; `tries += 1`; `score = minutes(submitted_on - start) + penalty*(tries-1)`.
   `failed`/`killed` → `WA`, tries+1; `timeout` → `TLE`, tries+1; other results (crash, overflow, error) ignored.
   Group submissions count for each member.
4. User score = `(solved count, Σ task scores)`; sort by solved desc, time asc; rank shared on ties
   (displayed only on the first tied row).
5. Table: Rank, Contestant (realname), Score (two cells: solved, total minutes as int), one column per
   task id (link to task page). Cell classes: `contest_ac_first` (`tries/score`), `contest_ac`,
   `contest_wa_tle` (tries), `contest_na` ("0").
6. "Activity" table (newest first): Time, Contestant, Task, Result ("Succeeded"/"Failed"); one row per
   counted submission per member (submissions after a task's acceptance are not listed).
7. While the contest is not finished: `<meta http-equiv="refresh" content="30">` and text
   "The scoreboard will refresh every 30 seconds."; before start: "Contest has not started yet." instead of tables.

Verified example: Bob "1 | 60" (code1 ACF 1/60, mcq1 WA 1), Alice "1 | 80" (mcq1 ACF 2/80 after one WA, code1 WA), Carol "1 | 80" (code1 AC 2/80), Site Admin 0.

## Alternative / error flows
- `/contest/<id>` for a course whose dispenser isn't `contest`, or contest disabled → 404.
- Unknown course → 404 (legacy: 500).
- Plugin disabled → 404.
- Legacy bug (not reproduced): `check_dispenser_data` mutates the cached `contest_settings` dict before validating, so a
  rejected form still changes the in-memory contest (verified: after a rejected save the scoreboard
  showed the rejected end date and blackout) until course.yaml changes on disk.
- Timezone: stored strings may be with offset (`+00:00`); `fromisoformat` naive dates are interpreted in server local time (`astimezone()`).

## Data
`course.yaml` `task_dispenser`, `dispenser_data.contest_settings`, `dispenser_data.toc_data`; reads
`submissions` (`username, taskid, result, submitted_on, status`), `courses.students`, `users.realname`.

## Permissions & security
- Scoreboard page: signed-in users registered in the course (students, course staff,
  superadmins) to whom the course is open; others get 403, anonymous users are sent to the
  sign-in page, LTI sessions are refused.
- Settings page and its POST require course admin rights; the POST is protected by the
  origin check of form POSTs.

## Acceptance tests
- Dispenser switch to Contest; save with valid settings → course.yaml exactly as above.
- Each validation error message.
- Enabled contest: TOC tasks inaccessible before start, accessible after; non-TOC tasks never.
- Scoreboard ranking/penalty/ACF/blackout/ignored results as specified; admin rows present.
- Course menu block only for enabled contest; countdown texts.
- 404 when not a contest / disabled.
- A logged-in user not registered in the course cannot read the contest scoreboard.
