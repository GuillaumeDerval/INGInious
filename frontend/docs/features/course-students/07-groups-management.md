# Groups management (interactive editor)

- **ID**: CSTU-07
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /admin/<courseid>/students` (tab Groups), `POST /admin/<courseid>/students` with `groups` (JSON) and/or `delete` (group ids)
- **Depends on**: CSTU-01, CSTU-04 (audience restriction), CSTU-08 (YAML import/export), TASK group submissions (dispenser `group_submission`), student group self-registration (`groups_student_choice`, course settings / course page — other area)
- **Legacy code**: `pages/course_admin/student_list.py:L272-L385` (`post_groups`, `get_user_lists`, `update_group`), `templates/course_admin/student_list.html:L209-L461`, `static/js/groups.js`, Sortable.js, `user_manager.py:L625-L638`

## Use case
For group tasks, the teacher creates groups with a maximum size, optionally restricted to some
audiences, and drags students into them (or creates empty groups that students fill themselves
when `groups_student_choice` is enabled).

## Preconditions
Staff rights; course not LTI (`course.is_lti()` ⇒ tab hidden and `post_groups` returns immediately).

## Main flow
1. Tab "Groups": header buttons "Upload structure" (modal, CSTU-08) and "Download structure" (`?download_groups`, CSTU-08).
2. First card "Ungrouped students" (`ul#group_0`): registered students not in any group, sorted by `"0"+realname` (or `"1"+username` when unknown user); each `li.group-entry[data-username]` shows `realname (username)`. "+" opens `#student_modal` (text input `new_student`, "Add student") which appends `"<username> (will be registered)"` to the ungrouped list.
3. One card per group (natural sort by description): text `description`, number `size` ("Max group size :"), trash link (`group_delete`), "Restrict to audiences" select `audience_list_<n>` (audiences not yet attached) + "Add audience" button, list of attached audiences (`li.audience` with hidden `audiences` input, trash removes), "Students" list `ul.students` (Sortable, shared group "students" ⇒ drag & drop between groups).
4. A hidden template card (id = n+1, value "New group", size 2) is cloned by "New group" (`group_add()`), which also appends hidden `_id=None`.
5. "Clean groups" moves every student back to ungrouped; "Delete all groups" calls `group_delete` on each (adds hidden `delete=<id>` inputs for persisted groups).
6. Size auto-adjust: when a list changes or the size input changes, if `#students > size` or size is NaN, size := count (fade animation).
7. "Update" (`name="update"`, `onclick=groups_prepare_submit()`) adds hidden `groups` =
   `JSON.stringify([{_id: "<id>"|"None", description, size: int, students: [usernames], audiences: [audience ids]}…])` (ungrouped card excluded) and submits.
8. Server:
   - for each `delete` value: `Group.objects(id, courseid).first()`; missing → red "group with id <id> not found."; else delete; msg "Groups updated.".
   - for each group in JSON: `_id == 'None'` ⇒ insert `{description, size, students, audiences, courseid}` first; then
     `update_group`: if `len(students) <= size`, each student is accepted iff registered (non-staff list) **and**
     (group has no audience restriction or the student belongs to one of the audiences); accepted students are first
     pulled from any other group of the course; rejected ones are collected. If `len(students) > size`, **all students are dropped silently**.
     Finally `groups.update({_id}, {$set: {description, audiences: [ObjectId], size, students: accepted}})`.
   - errors ⇒ red "Changes couldn't be applied for following students :<ul><li>u</li>…</ul>" — legacy autoescapes it, so the HTML tags are shown literally (verified); else green "Groups updated.".
   - Groups tab active.

## Alternative / error flows
- Students added through the modal "(will be registered)" are **not** registered: they are rejected (listed in the error). The label is misleading.
- Staff cannot be put in groups (not in the student list).
- Invalid JSON / missing keys → red "An error occurred while parsing the data.".
- Group with only rejected students is still saved (empty).

## UI elements
As above. Element ids are reused (`#description`, `#size`, `#_id` duplicated per card) — the new UI should use proper ids.

## Data
- `groups` collection: `{_id: ObjectId, courseid: str, description: str, size: int, students: [username], audiences: [ObjectId]}` (audience ids stored as ObjectId).
- A student belongs to at most one group per course (enforced by the pull).
- Group submissions: `submissions.username` = all group members (verified `["cstu_eve","cstu_bob"]`).

## Permissions & security
- Every group update and deletion is scoped to the URL course: a group id of another course is rejected.
- Tutors may edit groups (staff rights).
- The POSTs are protected against cross-site request forgery.

## Acceptance tests
- Ungrouped list = registered students not in any group, sorted by realname.
- POST new group (size 2, 2 registered students, audience restriction satisfied) ⇒ inserted with ObjectId audiences, "Groups updated.".
- POST group with 3 students and size 1 ⇒ saved with `students: []` and (legacy) no error — decide on explicit error in rewrite.
- POST group with unregistered / non-audience student ⇒ student rejected and listed in the error message.
- Moving a student into group X removes him from group Y of the same course.
- `delete=<id>` removes the group; foreign group id in `delete` ⇒ "group with id … not found."; foreign `_id` in JSON ⇒ must be rejected.
- LTI course: tab hidden, group POSTs → 403.
