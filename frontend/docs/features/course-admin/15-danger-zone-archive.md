# Danger zone: archive course data (reset course into an archive copy)

- **ID**: CADM-15
- **Actors**: course admin, superadmin
- **Routes**: `GET /admin/<courseid>/danger`, `POST /admin/<courseid>/danger` with `token`, `courseid`, `wipeall` (endpoint `coursedangerzonepage`)
- **Depends on**: CADM-02; archived-course behaviour on the student side (course list "archive", accessibility forced closed); DB schema reference (`submissions`, `user_tasks`, `groups`, `audiences`, `courses`)
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/danger_zone.py:L19-L134` (`dump_course` L36-L73, POST L90-L124, `page` L127-L134); `templates/course_admin/danger_zone.html:L1-L121`; `courses.py:L75-L76,L161-L164,L281-L287`; `common/filesystems/local.py:L116-L148` (`copy_to`)

## Use case
At the end of a term the admin resets the course (no submissions, no groups/audiences, no registered students) to
reuse it for the next term, while keeping all the old data in a separate, read-only *archive course*.

## Preconditions
- Admin rights; course not already an archive (`archived: true`).

## Main flow
1. `GET` renders the page (title "Danger zone", menu `current='danger'`, `<h2>Danger zone`), card with tabs "Archive data" (`#tab_archive_data`, `fa-archive`) and "Delete course" (`#tab_delete_course`, CADM-16). Each `page()` call stores a fresh form token in the session, placed in hidden inputs `token` of both forms (the rewrite relies on the same-origin check of form POSTs instead).
2. Archive tab: warning card "Archive course data"; if the course is an archive → red "This course is already an archive course. You cannot archive it again." and no form; else text "This will reset and archive all course data (submissions, audiences, groups, user statistics) from the database. The archive will be stored as a new course." / "To confirm your will, please type the course id below :", text input `courseid` (placeholder "course id"), submit `name="wipeall"` "Archive course data" (`btn-warning`, `fa-archive`).
3. `POST`: `token` ≠ `session.token` → "Operation aborted due to invalid token."; `courseid` ≠ URL course id → "Wrong course id."; else `dump_course`:
   1. `archive_id = <courseid>_archive_<UTC now %Y_%m_%d_%H_%M_%S>` (e.g. `cadm1_archive_2026_10_14_05_39_08`).
   2. Copy the **whole course folder** recursively (all tasks and files, `shutil.copy2`, symlinks not followed) to `<tasks_directory>/<archive_id>/`.
   3. Write the archive `course.yaml` = current descriptor + `archived: true` + `archive_date: '<UTC ISO 8601 with microseconds, +00:00>'` (a second `now()`, may differ slightly from the id).
   4. MongoDB: `submissions`, `user_tasks`, `groups`, `audiences` with `courseid=<c>` → `$set courseid=<archive_id>`; the `courses` document `{_id: <c>, students: […]}` is removed and re-created as `{_id: <archive_id>, students: […]}` (if it existed). GridFS files are untouched (still referenced by the moved submissions).
   5. Log "Course <c> archived as <archive_id>."; success message (green) "Course archived as : <archive_id>".
4. The original course keeps its files and `course.yaml` unchanged but now has no data (no students registered).

### Verified
- Before: `cadm1` had 1 submission, 1 user_task, 1 audience, 1 group, `courses` doc with `students: [cadm_student]`.
- After: `cadm1` → 0/0/0/0 and no `courses` doc; `cadm1_archive_2026_10_14_05_39_08` → 1/1/1/1 and `{"_id": "cadm1_archive_…", "students": ["cadm_student"]}`; archive folder contains `course.yaml`, `task1/`, `task2/` (all files); archive `course.yaml` identical to the original except:
  ```yaml
  archived: true
  archive_date: '2026-10-14T05:39:08.943416+00:00'
  ```
- Wrong token → "Operation aborted due to invalid token."; wrong id → "Wrong course id." (both `alert-warning`).

## Alternative / error flows
- Exception (e.g. archiving an archive via crafted POST → `CourseNotArchivable`) → "An error occurred while dumping course from database: <repr(ex)>".
- Archive courses: `get_accessibility()` returns never-accessible (students can't access; staff can still browse/admin), `get_archiving_date()` used by the course list.
- **No backup/restore feature** exists in this version: the config key `backup_directory` (`/inginious/backups` in the reference env) is not used by any frontend code; "archive" replaces the older backup/restore of the danger zone. (The WebDAV server writes `.webdav_backup` temp files, unrelated.)
- The token is regenerated on every page render (including error renders); opening the page in two tabs invalidates the first one.

## Data
- Disk: new folder `<archive_id>/` (full copy).
- MongoDB: `submissions.courseid`, `user_tasks.courseid`, `groups.courseid`, `audiences.courseid` updated; `courses` doc moved.
- Session: `token` field.

## Permissions & security
- Admin only (tutors 403); confirmation by the typed course id; the POST is protected against cross-site request
  forgery (same-origin check).
- Messages are escaped. An existing archive folder is never overwritten: if the archive id already exists the
  archive is refused with an error. Archiving an archive course is refused.

## Acceptance tests
- Archive a course with seeded submissions/user_tasks/groups/audiences/registered students → DB moves exactly as above, folder copied, archive YAML has `archived: true` + ISO `archive_date`, success message with the archive id.
- Archive page of an archive course shows the "already an archive" message and no form; crafted POST → error.
- Wrong typed id → "Wrong course id.", nothing changed; cross-site POST (foreign `Origin`) → 403, nothing changed.
- After archiving, the original course has no registered students and empty statistics; the archive course is not accessible to students.
