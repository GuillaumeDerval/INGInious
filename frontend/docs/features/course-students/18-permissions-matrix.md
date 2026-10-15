# Tutor vs admin permissions on people & results administration (matrix and protections)

- **ID**: CSTU-18
- **Actors**: course admin, tutor, superadmin, student
- **Routes**: all routes of CSTU-01…17, `GET /admin/<courseid>` (redirect)
- **Depends on**: CSTU-01…17
- **Legacy code**: `pages/course_admin/utils.py:L20-L48` (`get_course_and_check_rights`), `L229-L242` (`CourseRedirectPage`), `user_manager.py:L785-L810` (`has_admin_rights_on_course`, `has_staff_rights_on_course`), `templates/course_admin/menu.html`

## Use case
Course admins (`course.yaml: admins`) fully manage the course; tutors (`course.yaml: tutors`) assist:
they follow students and look at submissions. Superadmins (config `superadmins`) have admin rights everywhere.

## Rights model
- `staff` = admins ∪ tutors ∪ superadmins; `admin` = admins ∪ superadmins.
- `get_course_and_check_rights(courseid, taskid=None, allow_all_staff=True)`: staff (or admin if `allow_all_staff=False`) else 403; every exception (unknown course/task…) is turned into 403 "This course is unreachable".
- Rewrite guards (`requireCourseStaff` / `requireCourseAdmin`, called by every load function, form action and endpoint of
  `/admin/<courseid>/...`): logged-in staff (or admin) else 403; anonymous → redirect to the sign-in page; LTI sessions → 403;
  unknown or invalid course id → 404 "Course not found.".
- `GET /admin/<courseid>`: tutors → 302 `/admin/<id>/tasks`; others (admins) → 302 `/admin/<id>/settings` (the task list GET is allowed to staff even though the menu shows "Tasks" to admins only; its POST is admin-only — other area).

## Matrix (server-side rules)
| Action | Admin | Tutor | Notes |
|---|---|---|---|
| View students/staff lists, CSV (CSTU-01) | yes | yes | |
| Register / unregister / unregister all (CSTU-02) | yes | no (403) | controls hidden for tutors |
| User search (CSTU-03) | yes | yes | all platform users, 10 results max |
| Create audience, CSV export (CSTU-04) | yes | yes | |
| Edit/delete audience (CSTU-05) | yes | yes | this course's audiences only; adding a student who is not registered yet (implicit registration) is admin-only |
| Audience CSV upload (CSTU-06) | yes | no (403) | destructive |
| Groups edit / YAML upload (CSTU-07/08) | yes | yes | this course's groups only; non-LTI courses only (403 otherwise) |
| Student info + reset state (CSTU-09/10) | yes | yes | |
| Submissions list / CSV / download (CSTU-11/12/13) | yes | yes | |
| Bulk replay (CSTU-14) | yes | no (403) | |
| Single AJAX replay (CSTU-14) | yes | no (403) | this course's submissions only |
| Submission page replay / replay-debug | yes | no (403) | |
| Submission page replay-copy | yes | yes | |
| View submission page (CSTU-15) | yes | yes | submission's own course only |
| Task-page AJAX load/check/download of submissions | yes | yes | submission of the URL course/task only |
| Statistics (CSTU-16/17) | yes | yes | |
| Student (not staff) on any `/admin/...` route | 403 | | anonymous: redirect to sign-in; unknown course: 404 |

## Protections (summary)
1. Audiences are read, updated and deleted only within the URL course (CSTU-05).
2. Groups are updated and deleted only within the URL course: a group id of another course in the editor JSON is
   rejected, and group ids in an uploaded YAML file are ignored (all uploaded groups are new) (CSTU-07/08).
3. Submissions are read through the task-page AJAX only when they belong to the URL course and task (CSTU-15).
4. Replay is admin-only and scoped to the URL course (CSTU-14).
5. Registration, unregistration and audience upload on POST `/admin/<c>/students` are admin-only (CSTU-02/06).
6. Every CSV export (student list, audiences, audience structure, student info, progress, submissions) neutralises text cells starting with a formula character (`=`, `+`, `-`, `@`, tab, carriage return) by prefixing them with `'`; numbers are written as is.
7. Downloaded archives contain sanitised member names only and no link members (CSTU-13).
8. Every state-changing request is a POST protected against cross-site request forgery.
9. User search returns only usernames and real names, 10 at a time, to course staff; the query is matched literally (CSTU-03).
10. Bad dates give an "Invalid dates" message, `page=abc` falls back to the first page, an unknown or malformed
    submission id gives 404, and resetting the state of a never-viewed task gives a 404 message (no 500).

## Legacy functional bugs to NOT reproduce (keep intended behaviour)
- Submissions CSV export → 500 (CSTU-12).
- Archive download fails for submissions without grader archive (MCQ, crashes) (CSTU-13).
- In-place replay → 500 + archive loss for submissions with tags/problem feedback (CSTU-14).
- Statistics tasks table/chart/global/tag stats always empty (CSTU-17).
- Audience CSV upload regenerates audience ids, breaking group restrictions (CSTU-06).
- Group error message HTML escaped (CSTU-07); oversize groups silently emptied.

## Acceptance tests
- Parametrised test over every route/action of the matrix × {superadmin, admin, tutor, registered student, other-course tutor, anonymous} asserting the recommended outcome.
- Tests for each protection above (foreign ids rejected, CSV cells escaped, tar members sanitised, cross-site POST refused).
