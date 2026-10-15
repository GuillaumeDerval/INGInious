# Unregister from a course

- **ID**: NAV-08
- **Actors**: student
- **Routes**: POST /course/<courseid> with form field `unregister` (any value)
- **Depends on**: NAV-09 (course page), NAV-16 (group page also includes the modal)
- **Legacy code**: `legacy/inginious/frontend/pages/course.py:L42-L51`, `templates/unregister_modal.html:L1-L25`, `templates/course.html:L68-L72`, `templates/group.html:L44-L50`, `user_manager.py:L673-L690`, `courses.py:L254-L257`

## Use case
A student who enrolled by mistake (or dropped the course) leaves it; their submissions are kept.

## Preconditions
Logged in, registered student; `course.allow_unregister()` true (`allow_unregister` key, default true; forced false for LTI; plugin hook `course_allow_unregister` may override).

## Main flow
1. Left column of the course page (registered non-staff only) and of the group page: link "Unregister from this course" (`fa-user-times`) opening Bootstrap modal `#unregister_modal`.
2. Modal: title "Unregister from <course name>", body "**This will keep your submissions saved but will remove you from your group.**" / "Are you sure ?", buttons "Cancel" (dismiss) and red submit "Unregister" (`name="unregister"`), form `POST /course/<id>`.
3. Server: if `"unregister" in form and course.allow_unregister()`:
   - `audiences.update({courseid, students: username}, {$pull: {students: username}})` (all matching audiences);
   - `groups.update({courseid, students: username}, {$pull: {students: username}})`;
   - `courses.update({_id: courseid}, {$pull: {students: username}})`;
   - log "User %s unregistered from course %s";
   - 302 redirect to `/mycourses`.
4. Otherwise the POST just renders the course page (same as GET).

## Alternative / error flows
- `allow_unregister: false` → link hidden; a POST `unregister` is refused (HTTP 403 "You are not allowed to do that."), no change.
- Not registered / staff user posting `unregister` → refused (HTTP 403), no change.
- Anonymous visitor of a previewable course posting `unregister` → refused (HTTP 403), no change.
- `user_tasks` and `submissions` are kept; re-registering restores grades.

## Data
Writes `audiences.students`, `groups.students`, `courses.students` (`$pull`).

## Permissions & security
- Only the logged-in user can unregister themselves, and only as a registered non-staff member of a course that allows it. The request is a POST protected by the app's origin check.

## Acceptance tests
- nav_alice (registered to navopen, member of Group A and audience TP1) clicks "Unregister from this course", confirms → redirected to /mycourses; navopen no longer listed; DB: `courses.navopen.students` without nav_alice, `audiences` TP1 `students: []`, Group A without nav_alice; her `user_tasks` still exist (5 docs).
- Modal texts exactly as above; Cancel closes it without request.
- nav_bob registered to navpwd (`allow_unregister: false`): no unregister link; POST `unregister=` → HTTP 403, still registered.
- LTI course: link never shown.
