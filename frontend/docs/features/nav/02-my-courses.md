# My courses page (enrolled courses, search and filters)

- **ID**: NAV-02
- **Actors**: student, tutor, course admin, superadmin
- **Routes**: GET /mycourses; POST /mycourses (pin toggle → NAV-03, course creation → NAV-04; any other POST re-renders the page)
- **Depends on**: AUTH-04, AUTH-05, NAV-03, NAV-04, NAV-05, NAV-21 (last tried exercises), NAV-20 (main_menu hook)
- **Legacy code**: `legacy/inginious/frontend/pages/mycourses.py:L13-L96`, `templates/mycourses.html:L1-L201`, `static/js/mycourses.js:L78-L120` (filters/search), `user_manager.py:L692-L754`

## Use case
A logged-in user wants a personal dashboard: the courses they are enrolled in or staff of,
their pinned favourites, their last attempted tasks, and quick client-side search/filters
(archived, LTI, hidden, pinned). Superadmins also create new courses from here. It is the
landing page after sign-in (`/signin` redirects here).

## Preconditions
Logged in (`INGIniousAuthPage`); anonymous users get the login form (auth.html) at this URL.

## Main flow
1. `open_courses` = courses where `course_is_open_to_user(course, username, lti=False)` **and** `course_is_user_registered(course, username)`:
   - staff/superadmin: every loadable course (including hidden, future, archived, LTI) — a superadmin sees **all** courses of the instance;
   - student: registered courses that are currently accessible (registered students of a closed/archived course do not see it here).
2. Sorted by translated name.
3. `pinned_courses` = the user's `users.pinned_courses` entries that are in `open_courses` (order of the DB array).
4. Last submissions widget (NAV-21) restricted to `open_courses`: `get_user_last_submissions(5, {"courseid__in": [...]})`, each entry enriched with the Task object; entries whose task cannot be loaded are dropped.
5. `registerable_courses` (not registered and `is_registration_possible`) is computed and passed to the template but **never displayed** (dead code; the empty-state link points to `#register`).
6. Render:
   - Left column: h3 "My courses"; warning "This page lists all the courses you are currently enrolled in. You can find new courses on the course list page."; h3 "Last tried exercises" + list (format: `<b>Course name</b>: Task name`, colour by status, see NAV-21; "No submissions" disabled item when empty); `main_menu` hook entries (escaped, same legacy bug as NAV-01).
   - Content: h2 "My pinned courses" + pinned cards (`#pinned_list`, each `#pinned-<courseid>` card with a yellow star button and a link to `/course/<id>`), alert "You have no pinned courses. Go to the full course list to pin some." (`#no_pin_message`, hidden when there are pins).
   - h2 "My courses"; hidden alerts `.pin_alert` ("Something went wrong when pinning/unpinning your course. If the issue persists please contact an administrator.") and `.max_pin_alert` ("You are not allowed to have more than 6 pinned courses.").
   - Search input `#course_search` (placeholder "Search a course by its name", not translated).
   - Filter buttons (not translated): `#is_archive` "Archive", `#is_lti` "LTI", `#is_hidden` "Hidden", `#is_pinned` "Pinned", each `btn-light` with `data-value="null"`.
   - `#course_list`: one `<a class="course_item list-group-item" data-course-id=<id> href=/course/<id>>` per course with:
     - contextual class: `list-group-item-info` if LTI, else `-dark` if archived, else `-warning` if not open to non-staff (hidden);
     - marker classes `is_lti`, `is_archive`, `is_hidden` (not `is_open_to_non_staff`; note archived courses are also `is_hidden`), `is_pinned`;
     - star pin button (`fa-star text-warning` if pinned, `fa-star-o` otherwise) — see NAV-03;
     - course name;
     - right side italic: "LTI course - " | "Archive - <show_time(archive_date)>" | "Hidden course - ", followed by role "Administrator" (user in admins **or superadmin**), "Tutor", or "Student".
   - Empty list: link "You are not registered to any course" (`href="#register"`).
   - Superadmin only: NAV-04 creation form and its success/failure alert.

## Client-side behaviour (mycourses.js)
- Clicking a filter cycles its state `btn-light` (null, ignored) → `btn-success` ("true": item must have the class) → `btn-danger` ("false": item must not have the class) → back to light.
- `search_course()` runs on click of a filter and on click/keyup of the search box: an item is visible iff every non-null filter is satisfied AND `.course_name` text (lower-cased) contains the search string (lower-cased, substring).
- Filters/search are purely client-side and not persisted.

## Alternative / error flows
- LTI session (session.is_lti) on this non-LTI page → user disconnected and login page rendered (generic INGIniousAuthPage rule).
- Unknown POST fields → page re-rendered (no message).

## Data
- Reads all `course.yaml`; `courses` (registration: `{_id, students}`); `users.pinned_courses`; `submissions` (aggregation, NAV-21).
- No writes on GET.

## Permissions & security
- Auth required. Everything shown is the user's own data.
- Course names are escaped in the list.

## Acceptance tests
- nav_alice (registered to navopen, navcombi): list = exactly those two (plus courses she is staff of); roles "Student".
- nav_tutor (tutor of navopen, not registered elsewhere): navopen listed with role "Tutor".
- superadmin: every course listed, including `navclosed` and `navfuture` ("Hidden course - Administrator", warning colour), `navarchive` ("Archive - 1/1/26, 12:00:00 AM Administrator", dark), `navlti` ("LTI course - Administrator", info colour); the "Create new course" form is shown.
- A student registered in `navclosed` does not see it in /mycourses.
- Filters: clicking "Pinned" once shows only pinned items, twice only unpinned items, three times all. Same for Archive/LTI/Hidden.
- Search "zzz" hides every item; search "open" (case-insensitive) keeps "NAV Open course".
- Empty state for nav_eve (no course): "You are not registered to any course", "No submissions", "You have no pinned courses...".
- Last tried exercises show "<course>: <task>" for the 5 most recent (course,task) pairs (NAV-21).
