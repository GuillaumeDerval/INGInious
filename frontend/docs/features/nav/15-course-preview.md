# Course preview for non-registered and anonymous users

- **ID**: NAV-15
- **Actors**: anonymous, logged-in non-registered user
- **Routes**: GET/POST /course/<courseid> (and task pages /course/<cid>/<tid>, see task feature)
- **Depends on**: NAV-05, NAV-06, NAV-09, NAV-10
- **Legacy code**: `legacy/inginious/frontend/pages/course.py:L29-L31`, `pages/utils.py:L93-L147` (`preview_allowed` hook in `INGIniousAuthPage`), `user_manager.py:L717-L718`, `templates/course.html:L74-L87`

## Use case
A teacher lets prospective students browse the course content (task list and statements)
before enrolling, or even without an account.

## Preconditions
`allow_preview: true` and the course accessible (`accessible` open, not archived).

## Main flow
1. `CoursePage.preview_allowed(courseid)` = `course.get_accessibility().is_open() and course.allow_preview()`. When true, `INGIniousAuthPage` lets **anonymous** requests reach `GET_AUTH`/`POST_AUTH` (session.username = None).
2. `course_is_open_to_user` returns true for non-registered users when `allow_preview` (no redirect to /register even if registration is possible).
3. Page differences vs. a registered student:
   - no "Current grade" / "Last tried exercises" blocks, no progress bars in task items (template `registered` false);
   - left column: anonymous → sign-in block; logged-in and `is_registration_possible` → "Enroll in the course" block (h3, warning "Please enroll in the course to be able to submit answers to problems.", link to /register/<id>); logged-in and registration impossible → empty column;
   - breadcrumb icon → /courselist.
   - task list: same visibility rules (`after_start`), computed for username None (combinatory test: draw seeded with "None#i#title").
4. Task pages are viewable (statement shown) with "Please enroll in the course to submit." instead of the submit button.

## Alternative / error flows
- Preview on but course closed → normal closed handling (anonymous: login page; logged-in: "This course is closed.").
- Anonymous POST to a previewable course page is refused (e.g. `unregister` → HTTP 403, no change).

## Data
Reads only.

## Permissions & security
- Preview exposes task statements publicly (intended).
- Anonymous visitors are handled explicitly (no per-user queries are run for them).

## Acceptance tests
- Anonymous GET /course/navpreview → 200, task list "V1", "V2" with weight badges and no progress bar, sign-in block.
- Anonymous GET /course/navpreview/t1 → statement visible, "Please enroll in the course to submit.".
- Anonymous GET /course/navopen (no preview) → login form.
- nav_alice (not registered) GET /course/navpreview (registration false) → course page, no enroll block; GET /course/navpreviewreg (registration true) → "Enroll in the course" block linking to /register/navpreviewreg (no automatic redirect).
