# Manual registration / unregistration of students by staff

- **ID**: CSTU-02
- **Actors**: course admin, superadmin
- **Routes**: `POST /admin/<courseid>/students` with `register_student` or `remove_student`
- **Depends on**: CSTU-01, CSTU-03 (user search box), COURSE registration model
- **Legacy code**: `pages/course_admin/student_list.py:L57-L72` (`POST_AUTH`), `L149-L164` (`post_student_list`), `user_manager.py:L640-L690` (`course_register_user`, `course_unregister_user`), `templates/course_admin/student_list.html:L61-L72`, `templates/course_admin/student_list_table.html:L24-L33,L58-L105`

## Use case
The teacher enrols a student who cannot self-register (closed registration, password, access
control list…) or removes a student who dropped the course, or empties the whole course at the
end of the year.

## Preconditions
- Admin rights on the course (checked server-side). The UI controls are only shown to admins (`has_admin_rights_on_course`).

## Main flow
Register:
1. Admin types in the user-selection box (`name="username"`, single selection, autocomplete CSTU-03) and clicks "Add student" (`<button name="register_student" type="submit">`).
2. Server: `course_register_user(course, username.strip(), password='', force=True)`:
   - returns False (silently) if username empty, user not in `users`, or already registered (staff count as registered);
   - otherwise `courses.update({_id: courseid}, {$push: {students: username}}, upsert=True)`.
3. Page re-rendered (students tab). **No success or error message is ever shown**; exceptions are swallowed (`except: pass`).

Unregister one student:
1. Row button "Unregister" opens modal `#remove_modal` ("Unregister <username>" / "This will remove <username> from the course. Are you sure ?"); JS copies `data-username` → hidden `username`, `data-type="single"` → hidden `type`.
2. Submit `remove_student` → `course_unregister_user(courseid, username)`:
   `audiences: {$pull: {students: username}}` for all audiences of the course containing him,
   same for `groups`, then `courses: {$pull: {students: username}}`.

Unregister all:
1. Header button (students tab, admins) "Unregister all" with `data-type="all"`, `data-username="all students"`.
2. Server (`type == "all"`): `audiences.update_many({courseid}, {$set: {students: []}})`,
   `groups.update_many({courseid}, {$set: {students: []}})`, `courses.update({_id}, {$set: {students: []}})`.
   Audience tutors are kept.

## Alternative / error flows
- Unknown username → nothing happens, no message (verified).
- Registering a staff member → no-op (already "registered").
- `user_tasks` and `submissions` of unregistered students are **kept**; the student simply disappears from lists (and from the default submission filter, CSTU-11).
- The POST handler always also runs `post_audiences` and `post_groups` (CSTU-04/07) on the same form data; for these forms nothing else matches.

## UI elements
- Form 1 (below students table): `username` (selectize, `maxItems: 1`, placeholder "Enter something here to search for a user"), button `register_student` "Add student".
- Form 2 (wrapping the table): hidden `type` (`single`|`all`), hidden `username`, submit `remove_student` ("Remove <username>"), Cancel.

## Data
- `courses` collection: `{_id: <courseid>, students: [<username>…]}` (created on first registration by upsert).
- `audiences.students`, `groups.students` (pull on unregister / reset on "all").
- Logs `User %s registered to course %s` / `unregistered from course`.

## Permissions & security
- Register, unregister and "unregister all" are admin-only (tutors get 403).
- The POSTs are protected against cross-site request forgery.
- Registration bypasses registration password / ACL / closed registration (`force=True`) — intended.

## Acceptance tests
- Admin registers an existing user ⇒ `courses.students` contains it once; page shows it in the student table.
- Registering an unknown user / an already-registered user ⇒ no DB change; the rewrite answers 400 with "Unknown or already registered user." (legacy: page 200, no message).
- Unregister single ⇒ username pulled from `courses.students`, from every audience and group of *this* course only.
- Unregister all ⇒ `courses.students == []`, all audiences/groups of the course have `students == []`, tutors kept.
- Tutor POST of any of these actions ⇒ 403. Student POST ⇒ 403.
- Submissions/user_tasks are untouched by unregistration.
