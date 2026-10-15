# Create a new (empty) course from My courses

- **ID**: NAV-04
- **Actors**: superadmin
- **Routes**: POST /mycourses with form field `new_courseid`
- **Depends on**: NAV-02, course-model.md
- **Legacy code**: `legacy/inginious/frontend/pages/mycourses.py:L26-L32`, `templates/mycourses.html:L167-L189`, `courses.py:L43-L106,L292-L296`, `common/filesystems/__init__.py:L50-L56`

## Use case
A superadmin creates a new course skeleton, then configures it in course administration.

## Preconditions
Logged in as a superadmin (`superadmins` config list). For other users the form is not rendered and the request is refused server-side (HTTP 403).

## Main flow
1. Form (bottom of /mycourses, after `<hr/>`): text input `new_courseid` (placeholder "New course id", sr-only label "Course"), submit button "Create new course" (`btn-primary btn-block`). Standard POST to the same URL.
2. Server: `Course(new_courseid, {"name": new_courseid, "accessible": False}).save()` → writes `<tasks_directory>/<new_courseid>/course.yaml` containing:
   ```yaml
   accessible: false
   name: <new_courseid>
   ```
3. Success → page re-rendered with alert-success "Course created." (dismissable); failure (exception) → alert-danger "Failed to create the course.".
4. The new course appears in the list as "Hidden course - Administrator". No redirect.

## Alternative / error flows (legacy behaviour, mostly bugs)
- Ids are validated (see Permissions & security); invalid ids (empty, containing `/`, `..`, spaces, ...) report an error and nothing is written.
- **No existence check**: posting an existing id **overwrites** its `course.yaml` with `{accessible: false, name: <id>}`, destroying its whole configuration (admins, dispenser data, ...) and reporting "Course created.".
- `admins` is not set: the creator is not added (superadmins have access anyway).

## Data
- Writes `course.yaml` on disk (custom_yaml dump). No MongoDB write.

## Permissions & security
- Only superadmins can create a course (server-side check, HTTP 403 otherwise).
- The request is a POST protected by the app's origin check.
- The app validates the id with `id_checker` (`^[a-z0-9\-._]+$`, case-insensitive) and refuses existing courses (shows an error) — the legacy overwrite is a data-loss bug, not a feature to keep.

## Acceptance tests
- superadmin posts `new_courseid=navnew` → "Course created.", file `infra/tasks/navnew/course.yaml` = `{accessible: false, name: navnew}`, course listed as hidden with role Administrator.
- Non-superadmin posting `new_courseid=x` → HTTP 403, nothing written.
- `new_courseid=../x` → "Failed to create the course.", nothing written.
- (Rewrite, intended fix) `new_courseid=navopen` (existing) → error, file unchanged; `new_courseid=` or `bad id` → error.
