# Upcoming tasks board (plugin `upcoming_tasks`)

- **ID**: NAV-20
- **Actors**: student (any logged-in user)
- **Routes**: GET /coming_tasks; POST /coming_tasks (field `time_planner`); GET/POST /plugins/coming_tasks/static/<path>; hook `main_menu`
- **Depends on**: NAV-02 (menu location), NAV-14 (accessibilities, soft deadlines), NAV-21
- **Legacy code**: `legacy/inginious/frontend/plugins/upcoming_tasks/__init__.py:L1-L127`, `plugins/upcoming_tasks/templates/coming_tasks.html`, `upcoming_task_list.html`, `main_menu.html`; enabled by `plugins: - plugin_module: inginious.frontend.plugins.upcoming_tasks` (no options)

## Use case
A student sees, across all their courses, the unfinished tasks whose (soft) deadline is
approaching, sorted by urgency, optionally limited to the next 7/14/30 days.

## Preconditions
Plugin enabled; logged in.

## Main flow
1. `main_menu` hook returns `<div class="list-group mt-3"><a class="list-group-item list-group-item-action list-group-item-info" href="/coming_tasks"><i class="fa fa-rocket"></i> Upcoming Tasks</a></div>`, shown in the left column of /courselist, /mycourses and /coming_tasks (escaped as text by those templates — legacy bug, NAV-01).
2. GET → `time_planner = "unlimited"`; POST → `form.time_planner` (default "unlimited"). Conversion: "7"/"14"/"30" → that many days, anything else → 100000 days.
3. `open_courses` = courses open to the user (lti=False) and registered (as NAV-02; staff → all their courses).
4. Last 5 submissions over these courses (NAV-21 format "<b>course</b>: task").
5. For each course:
   - accessibilities of all tasks for the user, sorted by **soft end date**;
   - outdated = not `is_open()` OR soft end > now + time_planner days;
   - candidate tasks = `after_start()` and not outdated;
   - `tasks_data[course] = {taskid: {succeeded, grade}}` for candidates; tasks whose `user_tasks.succeeded` is true are **removed**;
   - courses with no remaining task, and **LTI courses**, are removed.
6. `sorted_tasks[course]` = remaining tasks in soft-deadline order; courses sorted by the soft deadline of their first task.
7. Render (title "Urgent tasks"): breadcrumb "Upcoming Tasks"; left column h3 "Upcoming tasks", warning "This page lists the coming tasks ordered on deadlines for courses you are registered in.", "Course list" link, "Last tried exercises", main_menu hooks; content h2 "My Upcoming Tasks" with button "Switch time planner" (`fa-exchange`) opening modal `#timeModal` ("Modify time planner", text "This allows to display only the tasks whose deadline is in a certain temporal proximity.", label "Number of days:", select `time_planner` with options 7, 14, 30, unlimited (first selected by default — the current choice is not preselected), buttons "Cancel" / "Save changes" → POST).
8. Per course card (`upcoming_task_list.html`): header = course name; per task link to the task page, class `disabled` if not open, name, "DEADLINE: **<show_time(soft end)>**" (untranslated), and if registered a progress bar with the grade.
9. No course left → alert-info "You have no upcoming tasks".

## Alternative / error flows
- **Legacy crash (verified)**: line 87 compares the tz-aware soft end date with naive `datetime.now() + timedelta(...)` → `TypeError: can't compare offset-naive and offset-aware datetimes` → HTTP 500 as soon as the user is registered in a course with at least one open task (e.g. nav_alice, nav_tutor). The page only works for users with no open task (nav_eve). The rewrite must implement the intended behaviour (aware comparison).
- Tasks without deadline have soft end = MAX (year 9999): since "unlimited" means now + 100000 days (≈ year 2300) < MAX, they are always "outdated" and **never listed**, by the intended logic — the board only shows tasks with a real deadline.
- Time planner choice is not persisted (lost on reload).

## Data
Reads `course.yaml`s, `courses`, `user_tasks` (succeeded, grade), `submissions`. No writes.

## Permissions & security
Own data only; read-only (in the app the time window is a GET query parameter, `?time_planner=7|14|30`).

## Acceptance tests
- Menu entry "Upcoming Tasks" visible on /courselist, /mycourses as a working link.
- nav_eve (no course) → "You have no upcoming tasks", "No submissions".
- (Intended behaviour) nav_alice with navopen: only `tsoft` (soft deadline 2026-10-20 12:00, not succeeded) is listed with "DEADLINE: <date>"; `t1` (succeeded), `tpast` (closed), `tfuture` (not started), tasks without deadline (soft end MAX) are not listed; time planner 7 days at 2026-10-14 keeps `tsoft`, a planner shorter than the remaining time hides it.
- LTI courses never appear.
- Courses ordered by the earliest soft deadline of their remaining tasks.
