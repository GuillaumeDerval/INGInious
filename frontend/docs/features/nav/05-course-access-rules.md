# Course accessibility, archived/LTI courses and the "course unavailable" page

- **ID**: NAV-05
- **Actors**: anonymous, student, tutor, course admin, superadmin, LTI user
- **Routes**: applies to GET/POST /course/<courseid> (and task pages, group page, lists)
- **Depends on**: course-model.md §3, §7; NAV-06 (redirect to registration); NAV-15 (preview)
- **Legacy code**: `legacy/inginious/frontend/courses.py:L145-L171,L281-L287`, `accessible_time.py:L1-L144`, `user_manager.py:L692-L754,L785-L810`, `pages/course.py:L16-L23,L58-L62`, `templates/course_unavailable.html:L1-L30`

## Use case
Teachers control when a course is visible (`accessible` dates, hidden courses, archives,
LTI-only courses). Students reaching a course they cannot access are either sent to the
enrollment page or shown an explanation.

## Preconditions
Course exists and loads.

## Main flow (GET /course/<id> for a logged-in user)
1. `reason = course_is_open_to_user(course, username, lti=False, return_reason=True)` (see course-model.md §7):
   staff/superadmin → open; `accessible` not open (or `archived`) → `"closed"`; not registered and no preview → `"unregistered_not_previewable"`; LTI course with `lti_send_back_grade` → `"lti_not_registered"`; else open.
2. If open → course page (NAV-09).
3. If `reason == "unregistered_not_previewable"` and `course.is_registration_possible(user_info)` → **302 redirect to `/register/<id>`** (NAV-06).
4. Otherwise render `course_unavailable.html` with **HTTP 200** (despite the text "Error 403"):
   - logo `static/images/logo_maintenance.png`;
   - alert-warning: "**Error 403** " + message:
     - `closed` or `unregistered_not_previewable` → "This course is closed."
     - `lti_only` or `lti_not_registered` → "This course must be accessed on an external platform. Read the course description or contact the teaching team for more information."
     - other/None (used by the group page) → "You are not registered to this course."
   - breadcrumb: course list icon → "Course unavailable".

## Accessibility semantics
- `accessible: true`/absent → always; `false` → never ("hidden course", listed as such for staff in /mycourses, warning on its course page for staff: "This course is currently invisible for students. You can change this by modifying the \"accessibility\" option in the configuration of the course.").
- Date strings → open between start and hard end inclusive (AccessibleTime; naive dates in server local tz).
- `archived: true` → always closed for non-staff whatever `accessible` says.
- Plugins may override with hook `course_accessibility`.
- LTI courses: `accessible` forced true, registration forced closed, unregister forced off, groups student choice forced off; such a course is reachable outside LTI only if registered via LTI and `lti_send_back_grade` is false.
- Note: an unregistered student of an LTI course sees "This course is closed." (reason `unregistered_not_previewable`, checked before the LTI rule).

## Alternative / error flows
- Unknown or unloadable course → 404 "Course not found." (the `get_course` helper catches every exception).
- Anonymous user on a non-previewable course → login page (auth.html) at the same URL (`INGIniousAuthPage`).
- LTI session (session.is_lti) on /course → user disconnected and login page (CoursePage is not an LTI page).

## Data
Reads `course.yaml`, `courses` (registration), session username.

## Permissions & security
- Staff bypass every date rule. Tutors (not only admins) can see hidden/archived courses.
- The app returns the unavailable page with HTTP 403 (legacy used 200; the texts are unchanged).

## Acceptance tests
- nav_alice (not registered) GET /course/navclosed → 403 page "This course is closed."; same for navfuture (2030 dates), navregclosed (registration period over), navacl (ACL refuses alice), navbind, navarchive, navlti.
- nav_alice GET /course/navpwd (registration open with password) → redirect to /register/navpwd; /course/navdeny → redirect to /register/navdeny.
- superadmin GET /course/navclosed → course page with the "currently invisible for students" warning; navarchive → course page.
- nav_tutor GET /course/navopen → course page with "Course administration" link.
- GET /course/nonexist and /course/navbroken (invalid date in `accessible`) → 404 "Course not found.".
- AccessibleTime unit tests: `true`, `false`, `None`, `""`, `"2014-07-16"`, `"/ 2014-07-16"`, `"2014-07-16 /"`, `"A / B"`, `"A / S / B"` with S > B (soft clamped to B), invalid `"notadate"` raises; `is_open` boundaries inclusive.
