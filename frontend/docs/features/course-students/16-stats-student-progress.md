# Statistics — "Student progress" tab (+ CSV)

- **ID**: CSTU-16
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /admin/<courseid>/stats` (endpoint `coursestatisticspage`, tab active by default); `GET /admin/<courseid>/stats?progress_csv`
- **Depends on**: CSTU-17 (same page), CSTU-11 (links)
- **Legacy code**: `pages/course_admin/statistics.py:L108-L135` (`_progress_stats`), `L148-L217`, `templates/course_admin/stats.html:L36-L89,L275-L285`

## Use case
Get, per task, how many students viewed, attempted and succeeded it, and the total number of attempts.

## Preconditions
Staff rights.

## Main flow
1. Aggregation on `user_tasks` with `{courseid, username ∈ registered students (staff excluded)}` grouped by `taskid`:
   `viewed` = count of docs, `attempted` = count with `tried != 0`, `attempts` = Σ`tried`, `succeeded` = count with `succeeded` true.
2. Rows for every task in dispenser order (`get_ordered_tasks`), zeros when no data; `name` localised.
3. Table "Tasks": `task name`, `# student viewed`, `# student attempted`, `# student succeeded`, `# attempts`, row action "View submissions" (→ `/admin/<c>/submissions?tasks=<taskid>`); header actions "Download CSV" (`?progress_csv=`) and "View all submissions".
4. `?progress_csv` → `make_csv(ordered dict)`; verified:
   ```
   id,attempted,attempts,name,succeeded,viewed
   02_courses,3,4,2. Courses,0,3
   answer,4,7,Answer task,3,4
   ```
   (`text/csv; charset=utf-8`, `filename=export.csv`). Only honoured on GET (`request.args`).
5. The page computes all CSTU-17 statistics before checking `progress_csv` (so filter params also apply and a bad date ⇒ 500 even for the CSV).

## Alternative / error flows
- Group submissions update every member's user_task ⇒ counted per member.
- Tasks whose user_tasks exist but which are no longer in the dispenser are ignored.

## UI elements
Tab "Student progress" (icon tasks). On page load, unless the URL contains `alerts`, the query panel of the Submissions tab is collapsed (`dropdown(query_header)`); if the URL contains `alerts` the Submissions tab is shown.

## Data
Read-only `user_tasks`, `courses.students`.

## Permissions & security
Staff only. CSV text cells starting with a formula character (`=`, `+`, `-`, `@`, tab, carriage return) are neutralised (prefixed with `'`) in the CSV export.

## Acceptance tests
- Fixture: 3 students, task T viewed by 3, attempted by 2 (tries 1 and 3), succeeded by 1 ⇒ row `3 / 2 / 1 / 4`; staff user_tasks excluded.
- `?progress_csv` columns and order as documented, tasks in dispenser order.
- Unviewed task ⇒ zeros.
