# Error pages (404, 403, 500, course unavailable, task unavailable)

- **ID**: CORE-02
- **Actors**: anonymous | student | tutor | course admin | superadmin | LTI user | API client
- **Routes**: any route raising `NotFound`/`Forbidden`/unhandled exception; `/course/<courseid>`, `/course/<courseid>/<taskid>`, `/group/<courseid>`, `/administrator/*`
- **Depends on**: CORE-01 (layout), CORE-04 (sessions)
- **Legacy code**: `legacy/inginious/frontend/app.py:195-211` (error handlers), templates `notfound.html`, `forbidden.html`, `internalerror.html`, `course_unavailable.html`, `task_unavailable.html`; `pages/course.py:16-23` (`handle_course_unavailable`), `pages/tasks.py:44-65,150-166,400-427`, `pages/group.py:31-35`, `pages/utils.py:154-182` (`INGIniousAdministratorPage`), `user_manager.py:692-739` (`course_is_open_to_user` reasons)

## Use case
When a user follows a wrong link, lacks rights, hits a closed course/task, or the server fails,
INGInious shows a page in the normal layout (sidebar + footer) with a maintenance logo and a
short message, instead of a raw server error.

## Preconditions
- None.

## Main flow
1. **404** — handler `flask_not_found` (`app.py:196-198`) renders `notfound.html` with status 404:
   title "Error 404 | INGInious", image `static/images/logo_maintenance.png` (centered), yellow alert
   `<b>Error 404</b> {message}` where `message = e.description`:
   - unknown URL: werkzeug default "The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again." (verified on `/doesnotexist`);
   - `/course/<unknown>`: "Course not found." (`pages/course.py:38`, verified);
   - `/course/tutorial/<unknown task>`: werkzeug default text (`raise NotFound()` without description, verified);
   - `/pages/<unknown>`: "File doesn't exist." (verified);
   - others: "This course doesn't exist." (`course_register.py:22`), "Submission doesn't exist.", "User unavailable.", "Invalid task id", "This audience doesn't exist.", "Auth method not found.", "Keyset not found", scoreboard "Invalid configuration"/"Unknown task id X".
2. **403** — handler `flask_forbidden` (`app.py:201-203`) renders `forbidden.html` with status 403: title "Forbidden | INGInious",
   same logo, yellow alert `<b>Forbidden</b> {message}`. Examples (verified): `/admin/<unknown or not-staff>/settings` -> "This course is unreachable";
   `/marketplace` as non-superadmin -> "You don't have superadmin rights on this course."; `/register` while logged in or with registration disabled -> "You're not allow to register.".
   Others: "You don't have staff rights on this course.", "You don't have admin rights on this course.", "You can't access this page as a member of the staff.", "User unavailable or deletion is forbidden.", "No LTI data available.", "Invalid LTI secret", "Couldn't validate LTI request", "Course unavailable.", "You're not allowed to do that", "Invalid ObjectId.", "List not valid.".
3. **Superadmin-only pages** (`/administrator/users`, `/administrator/user_action`) deny differently (`pages/utils.py:159-182`): they *render* `forbidden.html`
   **with HTTP 200** (not 403): GET message "Forbidden" (alert reads "Forbidden Forbidden"); POST message "You have not sufficient right to see this part." (verified as a student).
   Anonymous GET shows the sign-in form instead.
4. **500** — handler `flask_internalerror` registered for `InternalServerError` (`app.py:209-211`) renders `internalerror.html` with status 500:
   title "Internal error | INGInious", red alert "<b>Internal error</b> Something bad happened. The error has been logged, please contact your administrator if the error persists."
   followed by `<br/>` + `e.description`; for unhandled exceptions this is werkzeug's default "The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application."
   (verified with `/submission/zzz`, an invalid ObjectId -> `mongoengine.ValidationError`). The traceback is logged (`inginious.frontend.app - ERROR - Exception on ...`). The session cookie is still set.
   If rendering the error page itself fails (e.g. maintenance mode, CORE-03), the WSGI server returns a bare "Internal Server Error" page.
5. **Course unavailable** — `handle_course_unavailable` (`pages/course.py:16-23`) when `course_is_open_to_user(..., lti=False, return_reason=True)` is falsy:
   - reason `unregistered_not_previewable` and `course.is_registration_possible(user)` -> **302 redirect** to `/register/<courseid>` (verified with `navopen`);
   - otherwise renders `course_unavailable.html` with **HTTP 200** (verified): title "Course unavailable | INGInious", breadcrumb [course list icon] > "Course unavailable",
     logo, yellow alert `<b>Error 403</b>` + one of:
     - `closed` or `unregistered_not_previewable`: "This course is closed." (verified with `navclosed`, `navfuture`);
     - `lti_only` or `lti_not_registered`: "This course must be accessed on an external platform. Read the course description or contact the teaching team for more information.";
     - anything else / no reason (e.g. from `/group/<courseid>`, which calls it without `reason`, `pages/group.py:35`): "You are not registered to this course.".
   Reasons are computed in order (`user_manager.py:718-739`): staff -> open; course accessibility not open -> `closed`; not registered and no preview -> `unregistered_not_previewable`;
   LTI session on non-LTI course (or vice versa) -> `lti_only`; non-LTI session on an LTI course with grade send-back -> `lti_not_registered`.
6. **Task unavailable** — `task_unavailable.html` rendered with **HTTP 200** when `task_is_visible_by_user` is false (`pages/tasks.py:62-63,164-165,414-415`):
   title "Task unavailable | INGInious", logo, yellow alert "<b>Error 403</b> Task unavailable". Unknown task id -> 404 instead.
7. **405** — wrong HTTP method on an existing route returns werkzeug's plain (non-templated) 405 page with `Allow:` header (verified `PUT /courselist` -> `Allow: POST, OPTIONS, GET, HEAD`).
   `INGIniousPage` subclasses that do not implement GET/POST raise `MethodNotAllowed` (405) too; `INGIniousAuthPage` default `GET_AUTH`/`POST_AUTH` raise `NotAcceptable` (406, werkzeug page).
8. JSON APIs (`/api/v0/...`) use their own error JSON bodies (documented with the API features); 404 still returns status 404.

## Alternative / error flows
- Error pages are rendered inside the full layout, so the sidebar reflects the login state.
- Error pages never change the HTTP status for course/task unavailability (always 200) — the rewrite should keep 200 for parity
  or switch to 403 consistently; acceptance tests below pin legacy behaviour and flag the choice.

## UI elements
- `<img src="/static/images/logo_maintenance.png" style="margin:auto; display:block;">` above a centered `alert alert-warning` (404/403/unavailable) or `alert alert-danger` (500).
- All messages are translated through gettext.

## Data
- Reads course descriptors (`course.yaml`: accessibility, registration, preview, LTI flags), `users`/`user_tasks`/registration info to compute reasons. No writes except the session save on every response.

## Permissions & security
- Error pages show no traceback and no internal exception text: unexpected errors are logged server-side and the page only shows the generic "Internal error" text; only messages of expected errors (`error(status, message)`) are displayed, as escaped text.
- Denials use real status codes: anonymous users are redirected to the sign-in page, authenticated users without rights (superadmin pages included) get 403.

## Acceptance tests
- `GET /doesnotexist` -> 404, title "Error 404 | INGInious", body contains "Error 404" and the werkzeug default sentence, and `/static/images/logo_maintenance.png`.
- `GET /course/nonexistent` (logged in) -> 404 with "Course not found.".
- `GET /pages/foo` -> 404 with "File doesn't exist.".
- Logged in student: `GET /admin/tutorial/settings` -> 403 "Forbidden" page; `GET /marketplace` -> 403 "You don't have superadmin rights on this course.".
- Logged in user: `GET /register` -> 403 "You're not allow to register.".
- Student: `GET /administrator/users` -> 403 "Forbidden" page; a POST to a superadmin page -> 403.
- An unexpected server exception -> 500, title "Internal error | INGInious", contains "Something bad happened"; no traceback nor exception text in the body.
- Student on a closed course (accessibility false) -> 200 `course_unavailable` with "This course is closed."; on a future-opening course same text.
- Student, unregistered, course without preview but with open registration -> 302 to `/register/<courseid>`.
- Non-LTI session on an LTI course with grade send-back -> "This course must be accessed on an external platform...".
- Student registered to a course, task hidden/not yet visible -> 200 "Task unavailable" page with "Error 403".
- `PUT /courselist` -> 405 with `Allow` header.
