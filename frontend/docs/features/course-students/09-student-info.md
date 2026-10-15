# Per-student task status page (+ CSV)

- **ID**: CSTU-09
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /admin/<courseid>/student/<username>` (endpoint `coursestudentinfopage`), `GET …?csv`
- **Depends on**: CSTU-01, CSTU-10 (reset state), CSTU-11 (submission filter links), CSTU-15 (submission view)
- **Legacy code**: `pages/course_admin/student_info.py:L13-L63`, `templates/course_admin/student_info.html`

## Use case
A teacher looks at one student's progress: for every task, whether it was viewed, attempted,
succeeded, the evaluation grade and number of submissions, with links to the evaluated submission
and to all submissions.

## Preconditions
Staff rights. Any `<username>` is accepted: an unknown or unregistered user gives a page with all tasks "Not viewed".

## Main flow
1. `user_tasks.find({username, courseid})`.
2. Tasks in dispenser order (`get_ordered_tasks()`); initial row per task:
   `{taskid, name (session language), tried: 0, status: "notviewed", grade: 0, visible: False, url: "?tasks=<taskid>&users=<username>"}`.
3. For each user_task of a listed task: `tried`; status `notattempted` if tried == 0, `succeeded` if `succeeded`, else `failed`; `grade`; `submissionid` = str(user_task.submissionid) (string `"None"` if null).
4. `visible = True` for tasks in `get_user_task_list([username])` (accessibility `after_start()`).
5. Render: title "<realname> - <course>", h2 "Statistics for student {realname} ({username})", breadcrumb course › admin › students › realname.
6. Table rows coloured: not visible → `bg-dark text-white` with ban icon tooltip "Not served by the task dispenser"; notattempted → `table-warning`; succeeded → `table-success`; failed → `table-danger`.
   Columns: task name; status ("Not viewed", "Not attempted (viewed)", "Succeeded (<grade>%)" / "Failed (<grade>%)" as links to `/submission/<submissionid>` titled "View evaluation submission"); `# submissions` (= tried); actions: "View all submissions" (→ `/admin/<c>/submissions?users=<u>&tasks=<t>`) and "Reset state" (CSTU-10).
7. Header actions: "Download CSV" (`?csv=`) and "View all submissions" (→ `/admin/<c>/submissions?users=<u>`).
8. `?csv` → `make_csv(result)` (dict keyed by taskid). Verified:
   ```
   id,grade,name,status,submissionid,taskid,tried,url,visible
   02_courses,50.0,2. Courses,failed,6acf13a5d379057911ec076a,02_courses,2,?tasks=02_courses&users=cstu_eve,True
   03_tasks,0,3. Tasks,notviewed,,03_tasks,0,?tasks=03_tasks&users=cstu_eve,True
   ```
   (`submissionid` column only present if at least one task has one; `visible` is `True`/`False`.)

## Alternative / error flows
- Failed/succeeded status whose `submissionid` is null links to `/submission/None` (→ 500).
- Group submissions update each member's user_task, so the status is shared.

## UI elements
See above; the `url` field is a relative query string used only by the CSV.

## Data
Reads `user_tasks` (`tried`, `succeeded`, `grade`, `submissionid`), task names from disk, `users.realname`.

## Permissions & security
- Staff only. Only data of this course is shown.
- CSV text cells starting with a formula character (`=`, `+`, `-`, `@`, tab, carriage return) are neutralised (prefixed with `'`) in the CSV export.

## Acceptance tests
- Fixture with tasks: not viewed, viewed-not-attempted, failed (grade 50), succeeded (100), not yet accessible ⇒ statuses, colours, links and `visible` as described.
- `?csv` returns the documented columns in this order.
- Unknown username ⇒ 200 with all "Not viewed".
- Student → 403.
