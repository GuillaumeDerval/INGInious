# Danger zone: delete course

- **ID**: CADM-16
- **Actors**: course admin, superadmin
- **Routes**: `POST /admin/<courseid>/danger` with `token`, `courseid`, `deleteall` (endpoint `coursedangerzonepage`)
- **Depends on**: CADM-15 (page, token), CADM-02
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/danger_zone.py:L23-L34` (`wipe_course`), `L75-L83` (`delete_course`), `L112-L122`; `templates/course_admin/danger_zone.html:L78-L118`; `courses.py:L321-L325` (`Course.delete`)

## Use case
An admin permanently removes a course: its folder (all tasks and files) and all its student data.

## Main flow
1. Tab "Delete course": danger card "Delete course", text "This will **permanently** remove the course and all its data (including tasks and archive courses) from INGInious." / "To confirm your will, please type the course id below :", text `courseid` (placeholder "course id"), button "Delete course" opening modal `#delete_modal` ("Delete course": "This will **permanently** remove the course and all its data (including tasks and archive courses) from INGInious. Are you really sure ?", buttons "Cancel" and submit `name="deleteall"` "Delete course"). Pressing Enter in the text field opens the modal instead of submitting (hidden submit button with `onclick` showing the modal).
2. POST: token check ("Operation aborted due to invalid token."), typed id check ("Wrong course id."), then `delete_course`:
   1. `wipe_course(courseid)`: for every submission of the course delete GridFS `input` and `archive`; `courses.updateOne({_id: c}, {students: []})` (the document is **kept**, emptied); `audiences`, `groups`, `user_tasks`, `submissions` with `courseid=c` deleted; log "Course <c> wiped.".
   2. `course.delete()`: invalidate the cache, `rmtree(<tasks_directory>/<courseid>/)`; log "Course <c> files erased.".
3. Success → **302 to `/`** (index, which then redirects logged-in users to the course list). Exception → page with "An error occurred while deleting the course data: <repr(ex)>".

### Verified (course `cadm2` created via UI, seeded with 2 submissions + GridFS files, 2 user_tasks, 1 audience, 1 group, registered student, one task folder)
- After deletion via the UI: folder `cadm2/` gone; `submissions`, `user_tasks`, `audiences`, `groups` for `cadm2` = 0; GridFS files deleted; `courses` doc remains as `{"_id": "cadm2", "students": []}`; browser ended on `/courselist`.

## Alternative / error flows
- **Archive courses are NOT deleted** despite the text "(including tasks and archive courses)": archives are separate course folders/ids and are untouched.
- Other references are not cleaned: `users.pinned_courses` entries, `users.ltibindings` keyed by course, LTI tables (`lti_launch`, grade queues), sessions, `courses` doc.
- If the folder removal fails after the DB wipe, data is already gone (no transaction).

## Data
- MongoDB: GridFS `fs.files`/`fs.chunks` (submission input/archive), `submissions`, `user_tasks`, `audiences`, `groups` deleted; `courses` doc students emptied.
- Disk: course folder removed recursively.

## Permissions & security
- Course admins and superadmins can delete the whole course including tasks; confirmation by the typed course id;
  the POST is protected against cross-site request forgery (same-origin check).

## Acceptance tests
- Delete a seeded course → all listed collections empty for that id, GridFS files removed, folder removed, `courses` doc emptied (legacy parity) or removed (document choice), redirect to `/`.
- Wrong typed id → "Wrong course id.", nothing deleted; cross-site POST (foreign `Origin`) → 403, nothing deleted.
- Archive courses of the deleted course still exist.
- Tutor → 403.
