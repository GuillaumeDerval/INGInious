# LTI courses seen from the normal web application

- **ID**: LTI-13
- **Actors**: student, tutor, course admin (normal, non-LTI session)
- **Routes**: GET /courselist, GET|POST /mycourses, GET /course/<courseid>, GET|POST /course/<courseid>/<taskid>, GET /admin/<courseid>/students, upcoming-tasks plugin page
- **Depends on**: LTI-01, course list / my courses / course page (COURSE area)
- **Legacy code**: `legacy/inginious/frontend/user_manager.py:692-739` (`course_is_open_to_user`),
  `legacy/inginious/frontend/pages/course.py:15-23,61`, `pages/group.py:33`,
  `pages/api/tasks.py:70`, `pages/api/submissions.py:28`, `pages/mycourses.py:44-51`,
  `templates/courselist.html:43-66`, `templates/mycourses.html:104,115-147`,
  `templates/course_unavailable.html:20-26`, `templates/course_admin/student_list.html:45,209`,
  `pages/course_admin/student_list.py:273`, `plugins/upcoming_tasks/__init__.py:99-105`

## Use case
An LTI course is primarily used from the LMS, but it still appears in INGInious. If grades
are sent back to the LMS, students must not use it directly in INGInious (their grade
would not reach the LMS); otherwise the course remains usable from INGInious too.

## Preconditions
- Course with `is_lti: true`.

## Main flow
1. **Course list** (`/courselist`): LTI course title links to `lti_url` in a new tab
   (`target=_blank`) when set, else plain text (no link to the INGInious course page);
   footer line "External platform" with an external-link icon.
2. **My courses** (`/mycourses`): LTI courses get class `list-group-item-info` and
   `is_lti`, label "LTI course -", and a filter button "LTI"; pinning an LTI course
   returns JSON `{courseid, is_lti: true, lti_url, name, path, description}`.
3. **Access rule** `course_is_open_to_user(course, username, lti)`:
   - staff (admin/tutor/superadmin) → always open;
   - course not accessible → "closed"; not registered and no preview →
     "unregistered_not_previewable";
   - `lti` truthy and course not LTI → "lti_only";
   - `lti is False` (normal pages: course page, task page, group page, API tasks/submissions)
     and course is LTI: open if `lti_send_back_grade` is false, else
     **"lti_not_registered"**;
   - `lti is None` (e.g. task static files, task visibility in some callers) → the two
     LTI-specific checks are skipped (the closed/registration checks still apply).
4. Unavailable → `course_unavailable.html`: "Error 403" + for `lti_only` /
   `lti_not_registered`: "This course must be accessed on an external platform. Read the
   course description or contact the teaching team for more information." (verified on
   `/course/lti_test` and `/course/lti_test/mcq1` as a registered student).
5. Registration: LTI courses force registration closed, so students only get registered
   through an LTI launch (LTI-05) or by staff.
6. **Course admin**: Students page hides the *Groups* tab for LTI courses and ignores
   group POSTs (`post_groups` returns early).
7. **Upcoming tasks plugin**: LTI courses are removed from the list.

## Alternative / error flows
- Passback off: registered students can use the course normally in INGInious (and their
  submissions are not tagged).
- Staff always see LTI courses normally.

## UI elements
As listed (links, badges, filter button, 403 message).

## Data
Reads `course.yaml` (`is_lti`, `lti_url`, `lti_send_back_grade`), `courses.students`.

## Permissions & security
- `lti_url` is set by course admins; only `http(s)` URLs are rendered as links.

## Acceptance tests
- Course list shows LTI course linking to `lti_url` with "External platform".
- Registered student, LTI course with passback → course page and task page show the 403
  "external platform" message; without passback → normal access.
- Staff always access.
- Students page of an LTI course has no Groups tab.
- My courses "LTI" filter shows only LTI courses.
