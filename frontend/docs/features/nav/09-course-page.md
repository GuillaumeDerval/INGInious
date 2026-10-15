# Course page (student view: header, side column, description)

- **ID**: NAV-09
- **Actors**: student, tutor, course admin, superadmin, anonymous (preview only)
- **Routes**: GET /course/<courseid>; POST /course/<courseid> (unregister → NAV-08, otherwise same as GET)
- **Depends on**: NAV-05 (access), NAV-06, NAV-08, NAV-10 (task list rendering), NAV-11 (grade), NAV-12 (category filter), NAV-15 (preview), NAV-16 (group link), NAV-21 (last tried)
- **Legacy code**: `legacy/inginious/frontend/pages/course.py:L26-L95`, `templates/course.html:L1-L182`, `courses.py:L259-L266`

## Use case
A student opens a course to see its description, the structured list of tasks with their
progress, their current course grade, their last attempts, and links to group management /
unregistration. Staff use it as the entry point to the course administration.

## Preconditions
Course open to the user (NAV-05) or previewable (NAV-15).

## Main flow
1. `tasks = course.get_tasks()` (all task folders).
2. `user_task_list` = `dispenser.get_user_task_list([username])[username]` = task ids whose accessibility `after_start()` (combinatory test: only the user's draw).
3. Last submissions: `get_user_last_submissions(5, {courseid, taskid__in: user_task_list})`, each with `taskname` = translated task name.
4. `tasks_data = {taskid: {succeeded: False, grade: 0.0}}` for every visible task, overwritten from `user_tasks` documents `{username, courseid, taskid ∈ list}` (fields `succeeded`, `grade`).
5. `grade = dispenser.get_course_grade(user_tasks, username)` (NAV-11).
6. `categories = dispenser.get_all_categories()` (NAV-12).
7. Render `course.html`:
   - `<title>`: course name. Breadcrumb: icon link to `/mycourses` (tooltip "My courses") if registered (staff count as registered), else to `/courselist` (tooltip "Course list"); then active course name.
   - Left column, in order:
     1. `course_menu` plugin hook entries (`| safe`; e.g. scoreboard, contest info).
     2. If registered or staff: h3 "Current grade" + progress bar (`bg-success`, width `grade|int`%, label "`N` %"); h3 "Last tried exercises" + list (NAV-21, task names only) or disabled "No submissions".
     3. If staff: if `not course.is_open_to_non_staff()` alert-warning "This course is currently invisible for students. You can change this by modifying the \"accessibility\" option in the configuration of the course."; info link "Course administration" (`fa-user-secret`) → `/admin/<courseid>`.
     4. Else if registered: info link to `/group/<courseid>` (`fa-group`) labelled "Group : <description>" when the user is in a group of the course, else "Group management"; if `allow_unregister()` the "Unregister from this course" modal link (NAV-08).
     5. Else if not logged in: sign-in button block.
     6. Else if `is_registration_possible(user)`: h3 "Enroll in the course", alert-warning "Please enroll in the course to be able to submit answers to problems.", info link "Enroll in the course" (`fa-sign-in`) → `/register/<id>`.
   - Content:
     - Row: h2 course name; if categories non-empty, a `<select id="tag_filter">` (NAV-12).
     - If the raw `description` key is non-empty: accordion card "About this course" (`fa-chevron-right`, collapsed by default, `#course_desc`) containing the rendered rst description (`| safe`).
     - Inline CSS for section dividers, then `dispenser.render(course, tasks_data, categories, username)` (NAV-10).
     - Unregister modal (always included).
8. The group link label uses `get_course_user_group` (`groups` doc `{courseid, students: username}`).

## Alternative / error flows
- Not accessible → NAV-05 flows.
- `$i18n` translation of name/description per `session.language`.

## Data
- Reads `course.yaml`, task.yaml names, `user_tasks` (`username, courseid, taskid, succeeded, grade`), `submissions` (aggregation), `groups`, `courses`, `users`.
- No writes on GET.

## Permissions & security
- The rendered description HTML is sanitized.
- Staff see the same task list as students (accessibility rules apply to them on this page; staff can still open hidden tasks by URL — task page feature).

## Acceptance tests
- nav_alice on /course/navopen (registered, user_tasks seeded: t1=100 succeeded, t2=50, textra=100, tpast=100, tfuture=100): "Current grade 77 %", sections Part 1 › Basics (T1 easy 100 % ✓, T2 hard 50 %), Advanced (collapsed, T3), Deadlines (T past - deadline reached, T soft deadline 0 %); "Hidden if empty" section absent; "Group management" and "Unregister from this course" links; breadcrumb icon → /mycourses.
- "About this course" collapsed by default; clicking shows "This is the NAV open course." and the two bullet items.
- Course without description (navcombi): no accordion.
- nav_tutor: "Course administration" link, no group/unregister links, grade 0 %.
- superadmin on navclosed: invisibility warning shown.
- After two submissions (t2, t3) the "Last tried exercises" lists "T3 weight zero", "T2 hard" (most recent first) with colour classes per status.
- When nav_alice is in "Group A", the left link reads "Group : Group A".
