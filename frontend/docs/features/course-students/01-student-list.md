# Course user management page: student & staff lists, grade export (CSV)

- **ID**: CSTU-01
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /admin/<courseid>/students` (endpoint `coursestudentlistpage`); query flags `?csv_student`, `?audiences` (open Audiences tab); POST is shared with CSTU-02/04/06/07/08.
- **Depends on**: CSTU-02 (register/unregister), CSTU-04 (audiences tab), CSTU-07 (groups tab), CSTU-09 (student info), CSTU-11 (submissions), COURSE (course.yaml admins/tutors), TASK dispenser grade computation
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/student_list.py:L20-L115` (`GET_AUTH`, `page`, `get_student_list_params`), `pages/course_admin/utils.py:L20-L48` (`get_course_and_check_rights`), `L169-L226` (`make_csv`), `templates/course_admin/student_list.html:L1-L78,L464-L468`, `templates/course_admin/student_list_table.html`, `templates/course_admin/menu.html`, `user_manager.py:L399-L452` (`get_course_caches`), `task_dispensers/toc.py:L85-L105` (`get_course_grades`)

## Use case
A teacher (admin or tutor) wants to see who is enrolled in the course, how far every student
got (tasks tried / succeeded, current course grade) and export that table as CSV (this CSV is
the only "grade export" of the legacy frontend). They also see the teaching staff with the same
statistics.

## Preconditions
- Logged in (otherwise the sign-in page `auth.html` is rendered in place, HTTP 200).
- `has_staff_rights_on_course` (course admin, tutor or superadmin). Otherwise **403** "You don't have
  staff rights on this course." — but because `get_course_and_check_rights` wraps everything in
  `try/except`, *any* error (unknown course, broken course.yaml, …) becomes **403 "This course is unreachable"**.

## Main flow
1. `GET /admin/<courseid>/students`.
2. Special query parameters are handled first (see CSTU-06 `preferred_field`, CSTU-08 `download_groups`).
3. Build `user_data` (ordered dict username → row):
   - staff = `course.get_staff()` (= `set(tutors + admins)`, **unordered**), sorted by realname;
   - students = `courses.students` of the `courses` collection document `{_id: courseid}`, sorted by realname
     (users missing from `users` get realname "");
   - concatenation **staff first, then students**;
   - each row initialised to `{"username", "realname", "email", "total_tasks": 0,
     "task_grades": {"answer": 0, "match": 0}, "task_succeeded": 0, "task_tried": 0, "total_tries": 0, "grade": 0}`
     then `update()`d with `get_course_caches(usernames, course)` (see Data).
4. Render `student_list.html`; the active tab is `tab_students` (or `tab_audiences` when `?audiences` is present).
   The page has 4 tabs: Students, Teaching staff, Audiences (CSTU-04), Groups (CSTU-07, hidden when `course.is_lti()`).
5. Students tab: "Number of students : N" then the table (rows `user_data[len(staff):]`).
   Teaching staff tab: rows `user_data[0:len(staff)]`.
6. `?csv_student` → `make_csv(user_data)` instead of HTML (see Data for the exact format).

## Alternative / error flows
- A user that is both staff and in `courses.students` appears only once in the OrderedDict, so the
  staff/student slicing by `len(course.get_staff())` is shifted (one student hidden / misplaced). New
  implementation should list staff and students explicitly.
- Registered usernames that do not exist in `users` are listed with empty realname/email.
- No pagination: every student is rendered.

## UI elements
- Left menu (`course_admin/menu.html`): "Course settings" (admins only), "Statistics", "User management",
  "Tasks" (admins only), "Submissions", "Danger zone" (admins only), plugin entries
  (`course_admin_menu` hook), help links ("How to create a task?", "Documentation").
- Breadcrumb: course name → `/course/<id>`; admin icon → `/admin/<id>` (redirects tutors to `/admin/<id>/tasks`, admins to `/settings`); "User management".
- Table columns: `student` (or `member` on staff tab) = realname or username; `username`; `email address`
  (mailto link); `# task tried` (= `task_tried`); `# task done` (= `task_succeeded`); `current grade` with
  tooltip "The current grade is computed over the tasks that are visible for users." rendered as a
  Bootstrap progress bar of width `grade|int`% and label `"{grade}%"`.
- Header buttons: CSV (`?csv_student=`, title "Download CSV"), "View all submissions" (→ `/admin/<id>/submissions`),
  and — students tab, admins only — "Unregister all" (CSTU-02).
- Row buttons: "View submissions" → `/admin/<id>/student/<username>` (CSTU-09); "Unregister" (admins only, students tab, CSTU-02).
- Below the student table (admins only): user-selection box + "Add student" (CSTU-02).
- Inline script activates the tab named by `active_tab`.

## Data
- Reads `courses` (`{_id: courseid, students: [username]}`; missing doc ⇒ no students), `users`
  (`username`, `realname`, `email`), `user_tasks`.
- `get_course_caches`: aggregation on `user_tasks` with match
  `{courseid, username: {$in: usernames}, taskid: {$in: <task folders on disk containing task.yaml>}}`,
  grouped by username: `task_tried` = count of docs with `tried != 0`; `total_tries` = Σ`tried`;
  `task_succeeded` = number of distinct succeeded taskids **that are visible** (dispenser `after_start()`);
  `task_grades` = `{taskid: grade}` restricted to visible tasks; `grade` = dispenser course grade.
  Users without any `user_tasks` get `{"task_succeeded": 0, "task_grades": [], "grade": 0}`.
- Course grade (TOC dispenser): `round(Σ grade_t × weight_t / Σ weight_t)` over tasks whose accessibility
  `after_start()` is true (weight from dispenser config, default 1). Tasks never viewed count as 0.
- **CSV format** (`make_csv`, response `text/csv; charset=utf-8`, header `Content-disposition: attachment; filename=export.csv`):
  dict input ⇒ first column `id` (the username) then **all keys sorted alphabetically**; sub-dicts are flattened as
  `key[subkey]` and the original column removed; values are `str()`-ed (Python reprs: `True`, `[]`,
  `"['a', 'b']"`, floats `50.0`); missing values empty. Excel dialect, CRLF line endings. Example (verified):
  ```
  id,_id,email,grade,realname,task_grades,task_grades[02_courses],task_grades[03_tasks],task_grades[answer],task_succeeded,task_tried,total_tasks,total_tries,username
  cstu_admin,,cstu_admin@x.org,0,Alice Admin,[],,,,0,0,0,0,cstu_admin
  cstu_bob,cstu_bob,cstu_bob@x.org,20,Bob Student,,50.0,0.0,50.0,0,2,0,2,cstu_bob
  ```
  (`_id` comes from the aggregation result; `task_grades` is `[]` for users without data and is replaced by
  the flattened columns otherwise; `total_tasks` is always 0; staff rows come first.)

## Permissions & security
- GET: staff (tutor + admin + superadmin). Admin-only controls are shown to admins only, and the matching POST
  actions are checked server-side (see CSTU-02/04/07 and the CSTU-18 matrix).
- CSV text cells starting with a formula character (`=`, `+`, `-`, `@`, tab, carriage return) are neutralised (prefixed with `'`) in the CSV export.
- Output is escaped.

## Acceptance tests
- Tutor, admin and superadmin get 200; a registered student gets 403; anonymous is redirected to the sign-in page; unknown course → 404.
- With 2 staff and 4 students: staff tab lists exactly the staff (sorted by realname), students tab shows "Number of students : 4".
- Columns `# task tried`, `# task done`, `current grade` match the aggregation for a fixture (`user_tasks` with tried/succeeded/grade, weights, a task not yet accessible excluded from grade and from task_done).
- `?csv_student` returns `text/csv`, filename `export.csv`, header line exactly as computed (id + sorted keys, flattened `task_grades[...]`), one row per staff + student, staff first.
- `?audiences` opens the Audiences tab; LTI course hides the Groups tab.
- Admin sees "Add student"/"Unregister"/"Unregister all"; tutor does not.
