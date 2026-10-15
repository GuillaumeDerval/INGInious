# Course submissions page: query (filters), listing, pagination

- **ID**: CSTU-11
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /admin/<courseid>/submissions` (endpoint `coursesubmissionspage`) with query parameters; `POST` same URL (filter form, `page`, and actions of CSTU-12/13/14)
- **Depends on**: CSTU-04 (audiences), CSTU-12 (CSV), CSTU-13 (download), CSTU-14 (replay), CSTU-15 (submission view), TASK tags & categories (dispenser config `categories`, course `tags`), evaluation mode (`user_tasks.submissionid`)
- **Legacy code**: `pages/course_admin/submissions.py:L13-L158`, `pages/course_admin/utils.py:L51-L136` (`INGIniousSubmissionsAdminPage.get_course_params`, `get_users`, `get_input_params`), `submission_manager.py:L218-L408` (`get_submissions_mongo_filter`, `get_selected_submissions_queryset`, `get_selected_submissions`), `templates/course_admin/submissions.html`, `templates/course_admin/submissions_query.html`, `static/js/common.js:L163-L211`, `static/js/checked-list-group.js`, twbsPagination, tempusdominus datetimepicker

## Use case
Staff search the submissions of the course: by students or audiences, tasks, task categories,
grade range, date range, only evaluation ("best"/"last") submissions or only crashes, sorted and
paginated, then open, download, export or replay the selection.

## Preconditions
Staff rights on the course.

## Main flow
1. Entry points pre-fill the filter by query string, e.g. `?users=<u>`, `?users=<u>&tasks=<t>`, `?tasks=<t>`, `?audiences=<id>` or `?audiences=<id1>,<id2>` (from CSTU-01/04/09/16, task page "View submissions" link).
2. **Parameter collection**: GET uses `request.args`, POST uses `request.form`; `users`, `audiences`, `tasks`, `org_categories` are read with `getlist` (repeated keys); other keys are single values.
3. **Sanitisation (`get_input_params`)** — exact rules:
   - `users`: if both `users` and `audiences` are empty ⇒ `users` := all registered users **including staff** (`get_course_registered_users(course, True)`, sorted by realname). A single value containing `,` is split. Then filtered to registered users (unknown ones dropped).
   - `audiences`: single value with `,` split; filtered to ids of audiences of this course.
   - `tasks`: empty ⇒ all task ids (`course.get_tasks()`); single value with `,` split; filtered to existing tasks.
   - `org_categories`: single value with `,` split (not validated).
   - `grade_min`, `grade_max`: `int()`; failure ⇒ `''` (= no bound). (Decimal values like `50.5` are rejected → ignored.)
   - `sort_by` ∉ {`submitted_on`, `username`, `grade`, `taskid`} ⇒ `submitted_on`.
   - `order`: `1` if int(value) == 1 else `0` (non-int ⇒ 0).
   - `limit`: `int()`; failure ⇒ 50. In `get_course_params`, `limit <= 0` or absent ⇒ 50.
   - Boolean flags = presence of the key: `eval`, `crashes_only`, `show_tags`, `show_id`, `show_task_name`, `show_stud_name`.
   - `date_after`, `date_before`: free strings, parsed later with Python `datetime.fromisoformat` (accepts `2026-10-14T05:31:00`, `2026-10-14 05:31:00+02:00`, `…+0000`, `…Z`); **invalid ⇒ HTTP 500** (the `try/except ValueError` around it does not cover the parse).
4. **Mongo filter (`get_submissions_mongo_filter`)** on `submissions`:
   - always `courseid`;
   - tasks: if `org_categories` non-empty ⇒ `taskid ∈ {tasks whose dispenser categories intersect org_categories} ∩ tasks`; else `taskid ∈ tasks`; each id validated with `id_checker` (else 403 "List not valid.");
   - users: if `audiences` non-empty ⇒ `username ∈ (∪ audience.students) ∩ users` (users intersection only if users non-empty); else if users non-empty ⇒ `username ∈ users` (matches if **any** member of a group submission is in the list); empty ⇒ no user restriction (**so a filter that only contains unknown users returns every submission of the course**, verified);
   - `grade >= grade_min`, `grade <= grade_max` (floats);
   - `submitted_on >= date_after`, `submitted_on <= date_before` (naive datetimes compared as UTC);
   - `crashes_only` ⇒ `result ∈ ["crash", "timeout"]`;
   - `eval` (or `eval_dl` on download) ⇒ `_id ∈ {user_tasks.submissionid for user_tasks matching the same courseid/taskid/username filter}`.
   The set of evaluation submission ids is always computed and used to flag rows with a star.
5. Sort `sort_by`, ascending iff `order == 1` (default descending `submitted_on`). Pagination: `count()` of the full query, `skip((page-1)*limit)` only if `skip < count` (out-of-range page ⇒ first page shown), `limit(limit)`. `number_of_pages = max(ceil(count/limit), 1)`.
6. Render `submissions.html`: query card (collapsible, `submissions_query.html`, `target="submissions#alerts"`), alerts, "`<count>` submissions selected", table, pagination, download modal.
7. The current, sanitised parameters are serialised to JSON (`displayed_selection`, e.g.
   `{"limit": 3, "users": [...], "audiences": [], "tasks": [...], "org_categories": []}` + any other submitted keys) and put
   in hidden inputs of the CSV/download/replay form, the pagination form and the download modal.
8. Pagination: twbsPagination (`totalPages`, `startPage`, `visiblePages: 5`); clicking another page submits
   `POST {displayed_selection, page}` ⇒ server re-sanitises the JSON and renders that page. `page` non-integer ⇒ **500** (only TypeError is caught).

## Query form (`submissions_query.html`) — exact fields
- Card "Query submissions" (header click toggles via `dropdown()`); form `#select_form` `method=post action="submissions#alerts"`.
- Panel tabs "Select students" / "Select audiences" (active = audiences iff `users` empty and `audiences` non-empty); switching tab **unchecks all checkboxes of the other tab**. Buttons "Select all", "Deselect all" (active tab), "Tutored only" (only if the user tutors at least one audience: checks the students of his audiences / his audiences).
  - students list: `li.list-group-item[data-name="users"][data-value=<username>]` text `"<realname> (<username>)"`, all registered users incl. staff; checked if in `users` (and not audience mode). "No user to display" if none.
  - audiences list: `data-name="audiences"`, value = audience id, text = description; "No audience to display".
  - `checked-list-group.js` turns each `li` into a clickable item with a hidden checkbox `name=<data-name> value=<data-value>`.
- "Select tasks" list (`data-name="tasks"`, tasks in dispenser order, names localised) with Select/Deselect all.
- "Select category" list (`data-name="org_categories"`, values from `get_all_categories()`).
- "Advanced query" collapsible (closed by default): checkboxes `eval` "Only evaluation submissions", `crashes_only` "Only timeouts and crashes", `show_tags` "Show Tags", `show_id` "Show submission id", `show_task_name` "Show task name", `show_stud_name` "Show student name"; numbers `grade_min` (placeholder 0), `grade_max` (placeholder 100); datetimepickers `date_after`, `date_before` (format `YYYY-MM-DD HH:mm:ssZ`, session language and timezone, placeholder `2014-06-29 10:00`); select `sort_by` (Submitted on / User / Grade / Task id); select `order` (0 Descending / 1 Ascending); number `limit` "Submissions per page *" (tooltip "Only visual. Download, replay and csv always consider all queried submissions.").
- Buttons: "Reset" (→ `GET /admin/<c>/submissions`), "Filter" (submit).

## Table
- Row class: `table-success` if `result == "success"`, `table-warning` if `status == "waiting"`, else `table-danger`.
- Columns: star icon (title = submission id) if evaluation submission; usernames (one per line; realnames if `show_stud_name`, `?` for unknown); taskid (or task name if `show_task_name`); id (if `show_id`); "submitted on" and "replayed on" (`<time datetime=iso>iso</time>`, "-" when never replayed); result "Succeeded"/"Waiting"/"Failed" + `(<grade>%)`; tags (if `show_tags`): course tags present in `submission.tests` — type 0 green badge, type 1 red badge, type 2 not shown — plus auto-tags (`*auto-tag-*` keys) as orange badges with the value (truncated to 30 chars + "…", full value in tooltip).
  Note: tags are shown when the key is present in `tests`, **even if its value is false**.
- Header actions (form `POST submissions#alerts` with `displayed_selection`): CSV (CSTU-12), download modal (CSTU-13), replay all (admins, CSTU-14).
- Row actions: "View submission" (→ `/submission/<id>`), "Download submission" (`?download_submission=<id>#alerts`, CSTU-13), "Replay submission" (admins, AJAX, CSTU-14).

## Alternative / error flows
- Submissions of users no longer registered are hidden by default (default user list = registered users) but appear when the user filter becomes empty.
- `audiences=<bad id>` alone ⇒ dropped ⇒ no user filter ⇒ all submissions (verified).
- Messages (`msgs`) are rendered as yellow alerts in `#alerts`.
- There is **no "delete submission" action** in this page (legacy).

## Data
Reads `submissions` (all fields except input), `user_tasks.submissionid`, `audiences`, `courses.students`, `users.realname`, dispenser categories, course tags.

## Permissions & security
- Staff only. Filters are always scoped to `courseid`.
- Every parameter is validated with a schema; task ids, usernames and audience ids are restricted to the tasks,
  registered users and audiences of the course and used as plain values in queries (never as operators or regexes).
- Tutored usernames/audience ids used by the "Tutored only" button are passed to the client as data, not inlined in JS.

## Acceptance tests (verified counts on the cstu fixture: 15 submissions)
- No params ⇒ all submissions of registered users, sorted by date desc, 50 per page.
- `users=a,b` ≡ `users=a&users=b`; `users=a,unknown` ⇒ only a; `users=unknown` ⇒ default selection (registered users; legacy: every submission).
- `audiences=<id>` ⇒ students of the audience; `audiences=<id>&users=a` ⇒ intersection.
- `tasks=t1,t2`; `org_categories=catA` ⇒ tasks of that category; `org_categories=catB&tasks=t_not_in_B` ⇒ 0.
- `grade_min=50&grade_max=50` ⇒ only grade 50; `grade_min=abc` ignored.
- `eval=on` ⇒ only `user_tasks.submissionid` submissions; star column marks them in all cases.
- `crashes_only=on` ⇒ only result crash/timeout.
- `date_after`/`date_before` ISO with and without offset; invalid date ⇒ "Invalid dates" message (legacy 500).
- `sort_by=grade&order=1` ascending; `limit=3` ⇒ ceil(15/3)=5 pages; POST `page=2` shows rows 4–6; page beyond range ⇒ first rows.
- Show-* checkboxes add/replace the documented columns; tags badges per type.
- Admin sees replay buttons, tutor does not.
