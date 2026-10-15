# REST API v0: list courses

- **ID**: SITE-08
- **Actors**: API client (logged in)
- **Routes**: GET /api/v0/courses, GET /api/v0/courses/<courseid>
- **Depends on**: SITE-06, SITE-07, COURSE (registration rules, course cache/grade)
- **Legacy code**: `pages/api/courses.py:L13-73`, `user_manager.py:L692-740` (`course_is_open_to_user`),
  `user_manager.py:L385-398` (`get_course_cache`), `courses.py` (`is_registration_possible`, `is_password_needed_for_registration`)

## Use case
A client lists the courses the user is registered to (with tasks and grade) and the courses they could register to.

## Main flow
1. `GET /api/v0/courses` → iterate `Course.get_all()` (all course folders on disk, unordered dict order);
   `GET /api/v0/courses/<courseid>` → only that course.
2. For each course, include it only if `course_is_open_to_user(course, username, lti=False)` **or**
   `course.is_registration_possible(user_info)`.
3. Item format (verified):
   ```json
   {"id": "sitecourse", "name": "SITE test course", "require_password": false, "is_registered": true,
    "tasks": {"code2": "Score task code2", "mcq1": "MCQ one", "code1": "Score task code1"}, "grade": 0}
   ```
   - `name`: course name translated in `session.language`;
   - `require_password`: `course.is_password_needed_for_registration()`;
   - `is_registered`: `course_is_open_to_user(course, username, False)` (true also for staff and superadmins);
   - `tasks` (only if registered): `{taskid: translated task name}` for the tasks of the course
     visible to the user (order = filesystem order);
   - `grade` (only if registered): `user_tasks`-based course cache `["grade"]` (number, may be int `0`).
4. Response 200 with a **JSON list** (the docstring wrongly says a dict keyed by course id).

## Alternative / error flows
- Not logged in → 403 `{"error": "You are not authenticated"}`.
- `/courses/<id>` where the course doesn't exist or can't be loaded → 404 `{"error": "Course not found"}`.
- `/courses/<id>` existing but neither open nor registrable → 200 `[]`.
- Archived/inaccessible courses are skipped.

## Data
Reads course descriptors (`course.yaml`), `courses` collection (`students`), `users`, `user_tasks`
(course cache aggregation). No writes.

## Permissions & security
- Only tasks visible to the user appear in `tasks` (hidden tasks are not listed to students).
- Superadmins see every course as registered.

## Acceptance tests
- Registered student: course appears with `is_registered: true`, `tasks` (id → name) and `grade`.
- Unregistered user, open registration: `is_registered: false`, no `tasks`/`grade`.
- Course with registration closed and user not registered: absent from list; `/courses/<id>` → `[]`.
- Unknown id → 404 `{"error": "Course not found"}`; anonymous → 403.
- `require_password` true when the course has a registration password.
- `?lang=fr` changes translated names.
