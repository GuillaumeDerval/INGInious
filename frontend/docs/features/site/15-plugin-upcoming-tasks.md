# Plugin "upcoming_tasks": cross-course list of tasks with upcoming deadlines (summary)

- **ID**: SITE-15
- **Actors**: logged-in student
- **Routes**: GET /coming_tasks?time_planner=&page= (app); legacy: GET/POST /coming_tasks, GET/POST /plugins/coming_tasks/static/<path>
- **Depends on**: SITE-12, COURSE (accessibility), task dispensers
- **Legacy code**: `plugins/upcoming_tasks/__init__.py:L1-127`, templates `plugins/upcoming_tasks/templates/{main_menu,coming_tasks,upcoming_task_list}.html`

> Detailed behaviour (filters, ordering, UI) is documented by the agent covering the student
> dashboard area; this file records only the plugin wiring.

## Use case
A student sees in one page all open tasks of all their courses ordered by deadline, filtered on a
time window (7, 14, 30 days or unlimited).

## Main flow
App behaviour: `GET /coming_tasks` (404 when the plugin is disabled) with the read-only
filter `?time_planner=7|14|30` (anything else = unlimited) and pagination `?page=`; the
legacy static route is not provided. Legacy wiring (reference):
1. Hook `main_menu` returns the HTML block "Upcoming Tasks" (rocket icon) linking to `/coming_tasks`
   (shown on course list, my courses, admin users pages — **escaped** as text due to the `main_menu`
   rendering bug, see `docs/reference/plugin-hooks.md`).
2. `GET /coming_tasks` → page with `time_planner="unlimited"`; `POST /coming_tasks` with form
   `time_planner` ∈ {"7","14","30"} (anything else → unlimited = 100000 days).
3. `/plugins/coming_tasks/static/<path>` serves files from the plugin's `static/` folder
   (`send_from_directory`, no auth; folder absent in this version → 404).

## Permissions & security
`/coming_tasks` requires a signed-in user (anonymous → sign-in page) and refuses LTI sessions
(403). The page only lists the user's own courses.

## Acceptance tests
- Menu entry present on pages calling `main_menu`; `/coming_tasks` requires login; time planner values 7/14/30/unlimited; plugin disabled → 404.
