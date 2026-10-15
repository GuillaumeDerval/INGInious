# Public course list

- **ID**: NAV-01
- **Actors**: anonymous, student, tutor, course admin, superadmin
- **Routes**: GET /courselist, POST /courselist (same output as GET)
- **Depends on**: AUTH-04 (sessions), AUTH-05 (sign-in button), NAV-05 (accessibility), NAV-07 (ACL, for the "Auto-registration" badge), NAV-20 (main_menu hook entry)
- **Legacy code**: `legacy/inginious/frontend/pages/courselist.py:L13-L34`, `templates/courselist.html:L1-L93`, `courses.py:L145-L159`

## Use case
Anyone (even not logged in) wants to discover the courses currently open on the instance and
reach a course page (or its external LMS for LTI courses) to enroll.

## Preconditions
None (page is not protected: `INGIniousPage`, not `INGIniousAuthPage`).

## Main flow
1. Load every course (`Course.get_all()`; unloadable courses silently skipped).
2. Keep courses with `course.is_open_to_non_staff()` = `get_accessibility().is_open()` — i.e. `accessible` currently open, not archived (plugin hook `course_accessibility` may override). **Hidden/closed/future/archived courses are not listed, even for their admins or superadmins.**
3. Sort by translated course name (`get_name(session.language)`, Python string order, case-sensitive: uppercase before lowercase, `[` after letters).
4. Render one card per course:
   - Title: link to `/course/<id>`; for LTI courses, the name links to `lti_url` in a new tab (`target="_blank"`) when `lti_url` is set, otherwise plain text (no link).
   - Body (`.card-text.card-trunc`): rendered rst description (`| safe`).
   - Footer badges (small, muted), in this order:
     - `fa-external-link` "External platform" if LTI.
     - `fa-user` "Auto-registration" if `course.is_registration_possible(user_info)` (accessible open AND registration open AND ACL accepts the user; anonymous → ACL courses never show it, non-ACL courses do). Shown even if the user is already registered.
     - `fa-key` "Password needed" if `registration_password` is not null (shown even when registration is closed).
     - `&nbsp;` when no badge.
   - Responsive wrapping divs every 2/3/4/5 cards (sm/md/lg/xl).
5. Left column:
   - anonymous: sign-in button block (`signin_button.html`: "Please register or sign in to see the complete list of courses and be able to submit answers to problems." + "Sign in").
   - logged-in: header "Public courses", warning "This page lists all the courses that are available now. If you are a course administrator, go to your 'My courses' page to see all of them.", link "My courses" (`/mycourses`), then the `main_menu` plugin hook entries.
6. Breadcrumb: single active item "Course list" (fa-th-list).

## Alternative / error flows
- No open course → empty card deck (no message).
- POST behaves exactly like GET (no form handled).
- **Legacy bug**: `main_menu` hook entries are output with `{{ entry }}` (autoescaped): the upcoming-tasks link is displayed as raw HTML text (`<div class="list-group mt-3"> <a ...>Upcoming Tasks</a> </div>`). The rewrite must render it as a real link.

## UI elements
Page title "Course list"; h2 "Course list"; Bootstrap cards (`.card-deck`). Description is fully rendered rst (can be long; CSS `card-trunc` truncates visually).

## Data
- Reads `course.yaml` of all courses (name, description, accessible, archived, registration, registration_password, registration_ac*, is_lti, lti_url).
- Reads `users` document of the session user (`get_user_info`) for the ACL check (username, email, bindings).
- No writes.

## Permissions & security
- Public page. Lists course names/descriptions of all accessible courses to anonymous visitors.
- Course descriptions are rendered rst; the resulting HTML is sanitized before display.
- `lti_url` is only used as a link target if it is an `http(s)` URL.

## Acceptance tests
- Anonymous GET /courselist → 200, sign-in block, lists `navopen`, `navpwd`, `navacl`, `navlti`, `navpreview`, `navregclosed`; does **not** list `navclosed` (accessible false), `navfuture` (future dates), `navarchive` (archived), nor a broken course (`navbroken`).
- Superadmin sees exactly the same list (closed courses not shown).
- Order is by translated name.
- `navpwd` card shows "Auto-registration" and "Password needed"; `navregclosed` shows neither; `navlti` shows "External platform", its title links to `https://lms.example.org/course/1` with `target=_blank`.
- `navacl` (email allow-list `*@ok.org`): badge "Auto-registration" shown for nav_carol (nav_carol@ok.org), hidden for nav_alice and for anonymous; `navdeny` (username deny-list `nav_bob`, `nav_c*`): hidden for nav_bob and nav_carol, shown for nav_alice.
- Logged-in user: left column with "Public courses" warning, "My courses" link and the "Upcoming Tasks" link rendered as a link.
- Course description rst rendered (bold, bullet list) in card.
