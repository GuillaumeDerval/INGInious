# Course creation (superadmin, "Create new course")

- **ID**: CADM-01
- **Actors**: superadmin
- **Routes**: `POST /mycourses` with form field `new_courseid` (endpoint `mycoursespage`)
- **Depends on**: NAV-02 (my courses page, where the form lives), AUTH-05 (auth gate), CADM-17 (YAML writing)
- **Legacy code**: `legacy/inginious/frontend/pages/mycourses.py:L20-L32` (POST), `L91-L96`; `templates/mycourses.html:L167-L189` (form + alerts); `courses.py:L43-L47,L292-L296` (`Course.__init__`, `save`); `common/filesystems/__init__.py:L50-L57` (`_checkpath`), `common/filesystems/local.py:L36-L59`

## Use case
A platform superadmin creates an empty course folder so that course administrators can later be
named and the course configured (CADM-03) and filled with tasks (CADM-06/07/10).

## Preconditions
- Logged in as a user listed in config `superadmins`.

## Main flow
1. `/mycourses` shows, below the course list and only for superadmins (`user_manager.user_is_superadmin()`), a `<hr/>` then an inline form (`method=post`, no action → `/mycourses`):
   text input `name="new_courseid"` id `new_courseid` placeholder "New course id"; submit button "Create new course".
2. `POST /mycourses` `new_courseid=<id>`.
3. Server: `Course(courseid, {"name": courseid, "accessible": False}).save()` inside `try/except: success=False`.
   - The `Course` constructor computes `get_fs_provider().from_subfolder(courseid)` (`_checkpath` rejects ids starting with `/`, containing `..`, or with leading/trailing whitespace) and parses the content.
   - `save()` writes `<tasks_directory>/<courseid>/course.yaml` (directories created with `makedirs`).
4. The page is re-rendered (HTTP 200, no redirect) with a dismissible alert:
   - success → green "Course created."
   - exception → red "Failed to create the course."
5. Written file (plain dict → keys **sorted alphabetically** by the YAML dumper):
   ```yaml
   accessible: false
   name: cadm1
   ```
   No admins, tutors, dispenser, etc. The new course is hidden from students (`accessible: false`) and has no admin
   except superadmins, who reach `/admin/<courseid>` to configure it. No MongoDB write at all (the `courses`
   collection document is only created on first student registration).

## Alternative / error flows
- **Id validation**: `new_courseid` is validated with the same regex as `id_checker` (`[a-z0-9\-\._]+`); the empty
  string and ids such as `cadm bad`, `cadm_é`, `cadm2/sub`, `cadm../x`, ` cadmx`, `/cadmabs` are rejected with an error
  and nothing is written (courses whose id does not match `id_checker` could never be loaded by `Course.get`).
- **Existing id**: creating a course whose folder already exists is refused ("course already exists"); the existing
  `course.yaml` is left untouched.
- Non-superadmin posting `new_courseid` → 403, nothing created.
- The POST handler also handles `pinning_courseid` (NAV-03); `new_courseid` takes precedence when both are present.

## UI elements
- Form only visible to superadmins. Success / failure alerts are `alert-success` / `alert-danger alert-dismissable`
  with a close button. No client-side validation.

## Data
- Disk: creates `<tasks_directory>/<courseid>/` and writes `course.yaml` (`{accessible: false, name: <id>}`).
- Logs `inginious.course` INFO "Course <prefix> created in the factory." when the folder did not exist.
- MongoDB: nothing.

## Permissions & security
- Superadmin only (checked server-side).
- The POST is protected against cross-site request forgery (same-origin check on every form POST; the session
  cookie is `SameSite=Lax` by default).
- The course id is validated before any filesystem access; the created folder is always a direct child of the
  tasks directory. An existing course is never overwritten.

## Acceptance tests
- Superadmin creates `cadmX` → file `cadmX/course.yaml` equals `accessible: false\nname: cadmX\n`; message "Course created."; course reachable at `/admin/cadmX` (redirects to settings).
- New course is not shown to students in the course list (hidden) and has no admins.
- Invalid ids (`a b`, `é`, `a/b`, `../x`, ``, ` x`) → error message, nothing written on disk.
- Existing id → error, existing `course.yaml` untouched.
- Non-superadmin POST with `new_courseid` → 403, no folder created; form not displayed for them.
