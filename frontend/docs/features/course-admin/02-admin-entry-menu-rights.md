# Course administration entry point, admin menu and access rights

- **ID**: CADM-02
- **Actors**: course admin, tutor, superadmin (student/anonymous are refused)
- **Routes**: `GET|POST /admin/<courseid>` (endpoint `courseredirect`); rights check shared by every `/admin/<courseid>/...` page
- **Depends on**: AUTH-05 (auth gate), CORE-01 (layout, left column), CSTU-* / statistics / submissions areas (menu targets)
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/utils.py:L20-L48` (`INGIniousAdminPage.get_course_and_check_rights`), `L229-L242` (`CourseRedirectPage`); `templates/course_admin/menu.html:L1-L41`; `user_manager.py:L775-L809` (`user_is_superadmin`, `has_admin_rights_on_course`, `has_staff_rights_on_course`); `flask/mapping.py:L117-L142`

## Use case
Staff of a course (admins and tutors) open the administration part of a course from the course page
(breadcrumb icon / "Administration" link) and navigate between the admin sub-pages through a fixed left menu.

## Preconditions
- Logged-in user; course `<courseid>` exists and loads (`Course.get`).

## Main flow
1. `GET /admin/<courseid>`: `get_course_and_check_rights(courseid)` with `allow_all_staff=True`.
2. If `session.username in course.get_tutors()` → 302 `/admin/<courseid>/tasks`; **else** (admins and superadmins) → 302 `/admin/<courseid>/settings`.
   (A user who is both tutor and admin is redirected to `/tasks`.) `POST` behaves like `GET`.
3. Every admin page renders `course_admin/menu.html` in the left column (`{% block column %}`), with `current` set to the active entry.

### Rights matrix (verified with users `cadm_admin`, `cadm_tutor`, `cadm_student` on course `cadm1`)
| Page | admin / superadmin | tutor | other |
|---|---|---|---|
| `/admin/<c>` | 302 → settings | 302 → tasks | 403 |
| `/settings` (CADM-03..05) | 200 | 403 | 403 |
| `/tasks` GET (CADM-06..09) | 200 | **200** (read-only use; POST → 403) | 403 |
| `/edit/task/<t>` and `/files` (CADM-10..14) | 200 | 403 | 403 |
| `/danger` (CADM-15/16) | 200 | 403 | 403 |
| `/stats`, `/students`, `/submissions`, `/search_user/...` | 200 | 200 | 403 |

In the rewrite, "other" means a logged-in user who is not staff of the course (403); anonymous visitors are
redirected to the sign-in page, and an unknown or invalid course id gives 404 "Course not found.".

### `get_course_and_check_rights(courseid, taskid=None, allow_all_staff=True)`
- `Course.get(courseid)`; staff check = `username in admins ∪ tutors` or superadmin; admin check = `username in admins` or superadmin.
- If `taskid` is given, also returns `course.get_task(taskid)`.
- The whole body is wrapped in a bare `try/except:` that re-raises **`Forbidden("This course is unreachable")`** —
  so the more specific messages "You don't have staff rights on this course." / "You don't have admin rights on this
  course." are never shown, and a missing course, an invalid course id, a missing/broken task all give the same
  **HTTP 403** "Forbidden — This course is unreachable" page (verified for `/admin/nonexistent`, and `/edit/task/nope/files`).

## UI elements (`menu.html`)
`list-group` with, in this order (each with a Font-Awesome icon, `active` class when current):
1. "Course settings" (`fa-cogs`) → `/admin/<c>/settings` — **only if** `has_admin_rights_on_course`.
2. "Statistics" (`fa-area-chart`) → `/admin/<c>/stats`.
3. "User management" (`fa-user`) → `/admin/<c>/students`.
4. "Tasks" (`fa-tasks`) → `/admin/<c>/tasks` — only for admins (tutors can still reach it by URL / redirect).
5. "Submissions" (`fa-file-code-o`) → `/admin/<c>/submissions`.
6. "Danger zone" (`fa-bomb`, `list-group-item-danger`) → `/admin/<c>/danger` — only for admins.
7. Plugin entries: for each `(link, name)` returned by hook `course_admin_menu(course=course)` → `url_for(link, courseid=...)`, label rendered `| safe`, active when `current == link`.
Then a second list-group with two info links: "How to create a task?" → `https://docs.inginious.org/en/latest/teacher_doc/task_tuto.html`
and "Documentation" → `https://docs.inginious.org/en/latest/teacher_documentation.html`.

Breadcrumb on admin pages: course name (→ `/course/<c>`) › `fa-user-secret` icon with tooltip "Administration" (→ `/admin/<c>`) › current page.

## Data
- Reads `course.yaml` (`admins`, `tutors`) and config `superadmins`. No writes.

## Permissions & security
- Server-side checks per page and per form action (see matrix). Tutors can GET the task list editor (CADM-06) but
  every write is admin-only; the WebDAV credentials box is shown to admins only.
- Denials use real status codes: 403 for a logged-in user without rights, redirect to the sign-in page for anonymous
  visitors, 404 for an unknown or invalid course id (or a task that does not exist).

## Acceptance tests
- Admin → `/admin/c` redirects to `/admin/c/settings`; tutor → `/admin/c/tasks`; user both tutor and admin → `/tasks`; superadmin not in the course → settings.
- Student / non-member → 403; unknown course → 404; anonymous → redirect to the sign-in page.
- Menu for tutor contains Statistics, User management, Submissions only; for admin also Course settings, Tasks, Danger zone.
- A plugin registering `course_admin_menu` adds an entry to the menu (its label is rendered as text).
- Matrix above enforced for GET and POST on every page.
