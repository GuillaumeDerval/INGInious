# Statistics — "Submissions" tab (global stats, tag stats, time chart, per-task and per-user tables)

- **ID**: CSTU-17
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /admin/<courseid>/stats?<filters>`; `POST /admin/<courseid>/stats` (query form, `action="stats#alerts"`)
- **Depends on**: CSTU-11 (same query form and filter semantics), CSTU-16, course tags
- **Legacy code**: `pages/course_admin/statistics.py:L17-L106,L137-L300`, `templates/course_admin/stats.html:L90-L273`, `templates/course_admin/submissions_query.html` (with `is_stats=True`), `static/js/libs/chart.min.js` (Chart.js 2.x)

## Use case
Teachers analyse the activity in a period: how many submissions, how many evaluation submissions
succeeded, how often each tag (test/misconception) was triggered, submissions over time, the most
submitted tasks and the most active users.

## Preconditions
Staff rights.

## Main flow
1. Parameters collected and sanitised exactly like CSTU-11 (`get_input_params`, fallback limit 500) from GET args or POST form.
2. Date range: `date_before` = `fromisoformat(param)` or now (session timezone); `date_after` = param or (date_before at 00:00) − 14 days, written back into params so the form shows it. Invalid date ⇒ **500**.
   `display_hour` = range < 4 days (chart min unit), aggregation by hour if range < 7 days else by day.
3. `limit` = `params.limit` if > 0 else **50** — note the form displays `500` as default value, but the first GET uses 50.
4. Filter = `get_submissions_mongo_filter(tasks, org_categories, users, audiences, grade bounds, submit_time_between=[after, before], crashes_only)` (no `eval`); evaluation ids set computed.
5. Computations (intended behaviour):
   - **Tasks table** `_tasks_stats`: submissions matching the filter, `$limit` N, grouped by taskid: `submissions` count, `validSubmissions` = count `result == "success"`, sorted by submissions desc; name = localised task name (or id). Columns "Tasks", "# submissions", "# valid submissions".
   - **Users table** `_users_stats`: `$limit` N, unwind `username` (group submissions count for each member), group by username, same counts, `$limit` N, sort desc. Columns "user", "# submissions", "# valid submissions".
   - **Chart** `_graph_stats`: buckets (hour or day, in `session.timezone`) from min to max date inclusive, zero-filled; two line datasets "All submissions" (red, no fill) and "Valid submissions" (blue, filled); x = bucket datetime string, y = count; Chart.js time axis (`distribution: 'series'`, hour format `ddd H:mm`, `minUnit: 'day'` unless display_hour), y label "# submissions".
   - **Global statistics** card "Submissions statistics" (`fast_stats`): "Number of submissions", "Evaluation submissions (Total)", "Evaluation submissions (Succeeded)", "Evaluation submissions (Failed)" over the first N matching submissions (evaluation = id in the evaluation set).
   - **Tag statistics** card (only if non-empty): for every course tag of type 0 or 1 and each (user, task) pair of the selected submissions: counts [all, tag true in all, evaluation, tag true in evaluation]. Normal mode (`stat=normal`): `100 × Σtrue/Σall` and `100 × Σtrue_eval/Σeval`; weighted mode (`stat=pond_stat`): mean over (user, task) pairs of the per-pair ratio. Displayed truncated to 1 decimal, `"> 0"` when non-zero but rounds to 0, columns "Tag" (badge red for misconception, blue otherwise, tooltip = description), "All submissions", "Best submissions".
6. Stats-specific form fields (instead of sort/order): `limit` "Limit" (default shown 500) and select `stat` ∈ `normal` ("Normal statistics") / `pond_stat` ("Weighted statistics").

## Legacy status: largely BROKEN (verified on the cstu fixture)
- **Tasks table always empty**: `_tasks_stats` passes the mongoengine-style filter (`taskid__in`, `username__in`, `submitted_on__gte`) to a raw `$match` stage, which matches nothing.
- **Chart and global/tag stats always 0**: `_graph_stats` mutates the shared filter dict, adding `submitted_on: {"$gte": …, "$lt": …}` which mongoengine turns into an equality to `None`, so both the chart and `_global_stats` (called afterwards) select nothing.
- Only the Users table works. The `$limit` is applied before grouping on natural order (not "most recent N").
- The rewrite should implement the intended behaviour above (and specify the limit semantics, e.g. most recent N).

## Alternative / error flows
- Bad `date_after`/`date_before` ⇒ 500 (rewrite: validation message).
- Messages list `msgs` is always empty.

## UI elements
Tab "Submissions" (icon dashboard) containing the collapsible query card (same as CSTU-11, with Limit/Statistics), alerts, "Global statistics" (two cards), "Submissions" (canvas chart), "Tasks" table, "Users" table.

## Data
Read-only `submissions`, `user_tasks`, `audiences`, course tags.

## Permissions & security
Staff only; queries scoped by courseid. Chart data (numbers/dates) is passed as page data and serialised by the
framework, not concatenated into a script. The query parameters are validated like CSTU-11 (invalid dates give the "Invalid dates" message).

## Acceptance tests
- Default GET: range = last 14 days (from midnight, session tz) to now; daily buckets (15 points per dataset); counts equal to the number of course submissions per day; valid = result success.
- Range < 7 days ⇒ hourly buckets.
- Tasks table sorted by submissions desc with valid counts; users table counts group submissions for each member.
- Global stats: N submissions, evaluation totals/succeeded/failed consistent with `user_tasks.submissionid`.
- Tag stats normal vs weighted on a fixture with two users × tasks (hand-computed percentages, "> 0" rendering).
- Filters (users, audiences, tasks, categories, grades, crashes_only, limit) restrict every statistic.
