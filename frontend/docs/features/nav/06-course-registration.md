# Course registration (self-enrollment, optional password)

- **ID**: NAV-06
- **Actors**: student (logged in)
- **Routes**: GET /register/<courseid>, POST /register/<courseid> (field `register_password`)
- **Depends on**: NAV-05, NAV-07 (ACL), course-model.md (`registration`, `registration_password`)
- **Legacy code**: `legacy/inginious/frontend/pages/course_register.py:L15-L46`, `templates/course_register.html:L1-L38`, `user_manager.py:L640-L671`, `courses.py:L149-L159`, `templates/course.html:L76-L87` (enroll link)

## Use case
A student enrolls in a course so that they can submit, get a course grade and appear in the
course's student list. Teachers can restrict enrollment by period, password and ACL.

## Preconditions
Logged in (anonymous → login form at this URL; after login through that form the GET handler runs).

## Main flow
1. Entry points: /courselist card → /course/<id> → automatic redirect to /register/<id> when not registered, not previewable and registration possible (NAV-05); or "Enroll in the course" link in the left column of a previewable course page (NAV-15).
2. GET: `basic_checks`:
   - course load error (invalid id / not found / unreadable) → 404 "This course doesn't exist.";
   - if already registered (staff count as registered) **or** `not course.is_registration_possible(user)` → 302 to `/course/<id>`;
   - else render the form.
3. Form page (title "Register to course '<name>'", breadcrumb Course list › <course> › Register):
   h2 "Enroll in the course '<name>'", text "This will enroll you in the course <name>", if a password is required an input `register_password` labelled "Password", button "Enroll in the course" (POST to same URL).
4. POST: `course_register_user(course, username_or_None, form.register_password)`:
   - username empty / user not in DB → fail;
   - `not is_registration_possible(user)` → fail;
   - password required and `registration_password != submitted` (exact, case-sensitive string comparison; missing field = None) → fail;
   - already registered → fail;
   - success: `db.courses.update({_id: courseid}, {$push: {students: username}}, upsert: true)`; log "User %s registered to course %s".
5. Success → 302 `/course/<id>`. Failure → form re-rendered with alert-danger "Invalid password." (**same message for every failure reason**: already registered, registration closed, ACL...).

## Alternative / error flows
- GET when registration is closed / ACL refuses / already registered → redirect to the course page (which then shows "This course is closed." or the course).
- POST /register/<id> when already registered or not allowed → "Invalid password." (no redirect).
- Course with invalid config values (e.g. bad date) → 500 (exception not caught).
- LTI courses: registration forced closed → always redirect.
- `$push` (not `$addToSet`): a race could duplicate the username (guarded only by the prior `course_is_user_registered` check).

## Data
- Reads `course.yaml` (accessible, registration, registration_password, ACL), `users` (username, email, bindings), `courses`.
- Writes `courses`: `{_id: <courseid>: str, students: [str]}` — document upserted on first registration.

## Permissions & security
- The registration password is configured by course staff in `course.yaml`; the input field is a masked password field.
- The submitted password is compared in constant time.
- The request is a POST protected by the app's origin check.
- Superadmins/staff cannot "register" (they are always considered registered).

## Acceptance tests
- nav_bob on /register/navpwd: wrong password → "Invalid password.", DB unchanged; `s3cret` → redirect to /course/navpwd, `courses` doc `navpwd.students` contains `nav_bob`.
- nav_alice on /register/navopen (no password): form has no password field; submit → registered, redirected.
- GET /register/navopen when already registered → redirect /course/navopen; POST → "Invalid password.".
- GET /register/navregclosed (registration "2020-01-01 / 2021-01-01") → redirect to /course/navregclosed ("This course is closed.").
- GET /register/navclosed (accessible false) → redirect.
- GET /register/nonexist → 404 "This course doesn't exist.".
- Anonymous GET /register/navopen → login form.
- superadmin GET /register/navopen → redirect to course page.
