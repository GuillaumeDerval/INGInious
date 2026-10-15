# Course marketplace: list and import a public course

- **ID**: NAV-18
- **Actors**: superadmin
- **Routes**: GET /marketplace; POST /marketplace (fields `courseid`, `new_courseid`)
- **Depends on**: NAV-19 (detail page shares `import_course`), course-model.md, course admin (redirect target)
- **Legacy code**: `legacy/inginious/frontend/pages/marketplace.py:L26-L101`, `marketplace_courses.py:L16-L96`, `templates/marketplace.html:L1-L101`, `inginious/__init__.py:L18` (`MARKETPLACE_URL`), `templates/layout.html` (menu "Marketplace" in the superadmin "Administration" block)

## Use case
A superadmin bootstraps a course by cloning a publicly shared INGInious course repository
(git) listed in the official marketplace.

## Preconditions
Superadmin; outbound HTTPS to `https://marketplace.inginious.org/marketplace.json` and to the git hosting of the course; `git` binary in the frontend container.

## Main flow
1. GET (non-superadmin → 403 "You don't have superadmin rights on this course."):
   `requests.get(MARKETPLACE_URL)` → JSON list of course objects:
   ```json
   {"id": "demo-tasks", "link": "https://github.com/UCL-INGI/INGInious-demo-tasks",
    "languages": "English / French", "license": "GPL 3.0", "maintainers": "...", "authors": "...",
    "default_language": "en",
    "name": {"en": "...", "fr": "..."}, "short_desc": {"en": "..."}, "description": {"en": "<rst>"}}
   ```
   Parsed into `MarketplaceCourse` objects keyed by `id` (if any entry lacks a key → log "Could not load marketplace" and empty dict). Localised getters: `get_name/get_short_desc(lang)` → value for `lang`, else `default_language`, else first value; `get_description(lang)` → rst `ParsableText` (fallback bug: last resort uses the first *key* of `short_desc`).
2. Render: left column "How to use" + warning "This page list all the course that are publicly avalaible. When you click import, it will create a new course on your INGInious instance. You will be admin of this new course and it will contain all the tasks and the structure of the imported course" (typos are in the source) + "My courses" link; h2 "Marketplace"; one card per course (insertion order of the JSON): title link to `/marketplace/<id>`, short description (sanitized HTML), footer link "Import course" (`fa-download`) opening modal `#exportModal` and setting hidden `#courseid` via inline `onclick="$('#courseid').val('<id>')"`. Empty → "No public courses available".
3. Modal "Import this course": text "This will create a new course with the ID bellow. This new course will contain the tasks and structure of the selected course", input `new_courseid` (placeholder "Course ID"), hidden `courseid`, button "Create course" → POST /marketplace.
4. POST (non-superadmin → 403 "You're not allowed to do that"): if `new_courseid` in form:
   `course = get_marketplace_course(courseid)` (re-downloads the JSON; unknown → CourseNotFoundException) then `import_course(course, new_courseid, username)`:
   1. `id_checker(new_courseid)` else `ImportCourseException("Course with invalid name: <id>")`;
   2. if `<id>/course.yaml` or `<id>/course.json` exists → "Course with id <id> already exists.";
   3. `git clone <link> <tasks_dir>/<id>` (sh.git) else "Couldn't clone course into your instance";
   4. read the cloned `course.yaml` if loadable (else `{}`);
   5. write a new `course.yaml`: `{description: old.description or "", admins: [<importer>], accessible: false, tags: old.tags or {}, name: "<old name> - <id>" or "<id>", [task_dispenser: "toc", dispenser_data: {config: {}, toc: old.toc} if old has a legacy "toc" key]}` — all other keys of the original course are dropped; failure → "An error occur while editing the course description";
   6. log (course logger) "Course %s cloned from the marketplace.".
   Success → 302 `/admin/<new_courseid>`. Errors are shown as dismissable alert-danger boxes on the marketplace page; any non-import exception (e.g. missing `courseid`, unknown marketplace id) → "User returned an invalid form.".

## Alternative / error flows
- Marketplace unreachable or invalid JSON → empty list on GET (10 s timeout); an import then fails with "User returned an invalid form.".
- The app removes the cloned `.git` directory from the course folder.
- Repositories whose tasks are in a sub-folder (e.g. demo-tasks has `tutorial/`) produce a course with no task at its root.
- Imported tasks keep their legacy task.yaml settings → invisible until the admin migrates them (NAV-14).

## Data
- Writes a course folder (git clone) and its `course.yaml`. No MongoDB write.
- Config: `MARKETPLACE_URL` constant (not configurable).

## Permissions & security
- Superadmin only (checked on GET and POST).
- Content from the remote JSON (`short_desc`, description on NAV-19) is escaped / sanitized before display; `link` must be an `https` URL before it is passed to `git clone` (run without a shell, with `--` before the URL).
- The course id is passed to the import modal as data, not interpolated into inline JS.
- The import is a POST protected by the app's origin check.

## Acceptance tests
- nav_alice GET /marketplace → 403.
- superadmin GET → cards for the 11 marketplace courses (e.g. "Introduction to computer systems", "Demo tasks"), each with "Import course".
- POST `courseid=demo-tasks&new_courseid=bad id` → "Course with invalid name: bad id"; `new_courseid=navopen` → "Course with id navopen already exists."; `courseid=zzz&new_courseid=navmkt0` → "User returned an invalid form.".
- Import `demo-tasks` as `navmarket` (via NAV-19) → folder cloned, `course.yaml` = `{accessible: false, admins: [superadmin], description: '', name: navmarket, tags: {}}`, redirect.
- Rewrite tests must mock the marketplace HTTP and git (no network in CI).
