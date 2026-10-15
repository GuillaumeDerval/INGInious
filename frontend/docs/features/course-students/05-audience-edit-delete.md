# Edit / delete an audience

- **ID**: CSTU-05
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /admin/<courseid>/edit/audience/<audienceid>` (endpoint `courseditaudience`), `POST` same URL (update or delete)
- **Depends on**: CSTU-04, CSTU-03, CSTU-02 (implicit registration)
- **Legacy code**: `pages/course_admin/audience_edit.py:L18-L107`, `templates/course_admin/audience_edit.html`, `static/js/audiences.js`, Sortable.js

## Use case
A teacher renames an audience, chooses which tutors are responsible for it and which students it
contains (possibly enrolling them at the same time), or deletes it.

## Preconditions
Staff rights on `<courseid>`; `audienceid` must be a valid ObjectId of an existing audience of this course.

## Main flow
GET:
1. `Audience.objects(id=audienceid).first()`; none → **404** "This audience doesn't exist." (invalid ObjectId → 500).
2. Page title "Edit <description>", h2 "Edit audience <description>", breadcrumb course › admin › students › "Edit audience …".
3. Form `#audience_form` (POST):
   - hidden `_id` = audience id;
   - "Audience description" text `description` + button `name="delete" value="<id>"` "Delete audience";
   - "Tutor list": `<ul id="tutors_">` of current tutors (`username (realname)` + hidden input `tutors`), trash icon removes;
     select `#tutor_list_` with course staff (`course.get_staff()`, tutors **and admins**) not yet in the audience; "Add tutor" button;
   - "Student list" card: `<ul id="group_0">` of current students that are registered (`username in users_info`), each
     `realname (username)` with a remove link; "+" opens modal `#student_modal` containing a **multi** user-selection box
     `registered_students` (CSTU-03) and "Add student" button (`audiences_student_add()` splits the comma list and appends `li.group-entry[data-username]`, label is the bare username);
   - "Update" button `name="update"` with `onclick=audiences_prepare_submit()`.
4. `audiences_prepare_submit()` appends hidden input `audiences` =
   `JSON.stringify([{_id, description, students: [data-username of every .group-entry], tutors: [value of every .tutor input]}])`.
POST update (no `delete` field):
5. `audiences_dict = json.loads(form["audiences"])`; for each username in `[0].students`:
   unknown user → red message "User not found : <username>" and stop (nothing saved);
   not registered → `course_register_user(course, username, force=True)` (**implicit enrolment**).
6. `audiences.update({_id: audiences_dict[0]._id}, {$set: {students, tutors, description: str(description)}})`;
   green "Audience updated."; page re-rendered.
POST delete (`delete` present, possibly several values):
7. For each id: `Audience.objects(id).first()`; missing → red "Audience with id <id> not found."; else delete
   and green "Audience updated.". If the current `audienceid` was deleted → **302 to `/admin/<courseid>/students?audiences=`**.

## Alternative / error flows
- Missing `audiences` field on update → 400 (KeyError on form → BadRequest).
- Malformed JSON → 500.
- Tutors are not validated (any string accepted).
- Students not registered but existing are silently enrolled in the *URL* course.
- Deleting an audience does **not** remove its id from `groups.audiences` (dangling references, CSTU-07).

## UI elements
As above; messages in `.alert-danger` / `.alert-success` dismissable boxes. Students list is Sortable (drag only cosmetic).

## Data
- `audiences` update/delete; `courses.students` push for implicit registration.
- Uses `course.get_staff()` for the tutor select, `get_course_registered_users(course, False)` for students.

## Permissions & security
- Every read, update and delete is scoped to the URL course (`courseid`) and uses the audience id of the URL;
  an audience of another course is reported as not found.
- Tutors (not only admins) may edit/delete audiences. Implicit registration of students who are not registered yet
  is admin-only: a tutor adding such a student gets "<username> is not registered to this course." and nothing is
  saved. Audience tutors are restricted to the course staff (other usernames are dropped).
- The POSTs are protected against cross-site request forgery.

## Acceptance tests
- GET existing audience ⇒ 200 with description, tutors, students; unknown id ⇒ 404; id of another course ⇒ 404.
- POST update (as admin) with students [a,b] (a registered, b existing unregistered) ⇒ audience updated, b added to `courses.students`, "Audience updated."; the same POST by a tutor ⇒ error, nothing saved.
- POST update with unknown user ⇒ "User not found : x", audience unchanged.
- POST `delete=<id>` from its own page ⇒ 302 to `/admin/<c>/students?audiences=`, document removed.
- POST with a foreign `_id` or `delete` id in the form ⇒ that id is ignored (only the audience of the URL, looked up within the URL course, is updated/deleted); URL id of another course ⇒ 404.
- Tutor select lists admins and tutors not yet in the audience.
