# Student group page (view, join, leave groups)

- **ID**: NAV-16
- **Actors**: student (registered, non-staff)
- **Routes**: GET /group/<courseid>; join (`register_group=<groupObjectId>`) and leave (`unregister_group`) actions on /group/<courseid>, sent as POST
- **Depends on**: NAV-05, NAV-08 (unregister modal), NAV-11 (grade), NAV-21; course admin "audiences & groups" feature (creation of groups/audiences)
- **Legacy code**: `legacy/inginious/frontend/pages/group.py:L17-L98`, `templates/group.html:L1-L182`, `models/group.py`, `models/audience.py`, `user_manager.py:L610-L638,L756-L773`

## Use case
Students see their team for group submissions and, when the teacher allows it
(`groups_student_choice`), pick or leave a group themselves, restricted to groups open to
their audience (class/TP).

## Preconditions
Logged in, registered in the course (staff are refused), course accessible.

## Main flow
1. `Course.get(courseid)` (no try/except: unknown/broken course → **500**).
2. Staff (admin/tutor/superadmin) → 403 Forbidden "You can't access this page as a member of the staff.".
3. Not (open to user and registered) → `course_unavailable.html` without reason → "Error 403 You are not registered to this course." (HTTP 200).
4. `register_group=<id>` posted:
   - if `groups_student_choice` false → error "You are not allowed to change group.";
   - else: the target group must belong to this course and be open to the user (empty `audiences` or sharing an audience with the user); atomic `findAndModify` on `groups` with `{_id: ObjectId(<id>), courseid, $expr: {$lt: [{$size: {$ifNull: ["$students", []]}}, "$size"]}}` → `$push: {students: username}`, and the user is removed from their previous group of this course; if no document matched → error "Couldn't register to the specified group." (current group kept); else log "User %s registered to group %s/%s". (`students` may be unset from a group document when it becomes empty.)
5. `unregister_group` posted:
   - choice disabled → "You are not allowed to change group.";
   - in a group → removed (`save()`), log; **no success message**;
   - not in a group → error "You're not registered in a group.".
6. Page data: last 5 submissions of the course (NAV-21, task names), `mygroup` = `groups.find_one({courseid, students: username})`, user audiences = ids of `audiences {courseid, students: username}`, `groups` = all course groups natsorted by description, `allowed_groups` = groups with empty `audiences` or sharing an audience with the user, `users` = info of all registered users + staff.
7. Render `group.html`:
   - Left column: `course_menu` hooks; "Current grade" (`get_course_cache`, label `N%`); "Last tried exercises"; unregister link if allowed.
   - Breadcrumb: course name link → "Register for a group" (no group) or "Groups".
   - h2 "<course name> - Groups"; error alert (danger) or success alert if `msg` (never used for success in practice).
   - If in a group: card "My group : <description>" with, when choice allowed, a "Quit group" icon button (posts `unregister_group`); members list: realname + `mailto:` link ("Send an email"), or raw username if the user does not exist.
   - Else if the course has no group: info "No set group in this course. If you think this is a mistake, please contact the course administrator."
   - Else if no allowed group: info "Groups have been set up but you're not allowed to register in anyone. Please contact the course administrator."
   - Else if choice allowed: h3 "My group" + warning "You're not registered to a group. Please consider registration in one of the group below to take part in all course activities. If no more group is available, please contact the course administrator."
   - Else: h3 "My group" + warning "You're not yet registered to a group. Please contact the course administrator for more information."
   - If allowed groups: h3 "All groups", one card per allowed group: header = description; when the user has no group, the group has free seats (`size - len(students) > 0`) and choice is allowed → green header with "(available : N)" and a "Join in" icon button (posts `register_group=<id>`); members list or "No registered member." (italic). (Member mailto in this list has a leading space: `mailto: email`.)
   - Unregister modal.

## Alternative / error flows
- Group not allowed for the user's audiences, or belonging to another course → "Couldn't register to the specified group.", nothing changed.
- Invalid group id in `register_group` → "Couldn't register to the specified group.".
- Joining a full group → error, current group kept.

## Data
- `groups {_id: ObjectId, description: str, courseid: str, size: int, students: [str], audiences: [ObjectId]}` (`students` may be absent when empty after a mongoengine save).
- `audiences {_id, description, courseid, students: [str], tutors: [str]}` (read).
- `courses`, `users` (realname, email of members), `user_tasks`, `submissions` (read).

## Permissions & security
Only registered non-staff students of an accessible course use this page. Join/leave are POST requests protected by the app's origin check. The server checks that the group belongs to the course and is open to one of the user's audiences; a failed join keeps the current group.

## Acceptance tests (course navopen: Group A size 2 open, Group B size 1 audience TP1, Group Full size 1 = [nav_dave]; TP1 = [nav_alice])
- nav_alice sees "All groups": Group A (available : 2), Group B (TP1 only) (available : 1), Group Full (Dave Nav, no join link); nav_bob does not see Group B.
- nav_alice joins Group A → card "My group : Group A" with "Alice Nav"; `groups` doc students = ["nav_alice"]; course page link label "Group : Group A".
- Joining Group Full → "Couldn't register to the specified group.", previous group kept.
- `unregister_group` while in a group → removed, no message; while not in a group → "You're not registered in a group.".
- navpwd (`groups_student_choice` false): join/quit → "You are not allowed to change group."; no join links.
- superadmin/nav_tutor → 403 "You can't access this page as a member of the staff.".
- Non-registered nav_alice on /group/navclosed → "Error 403 You are not registered to this course.".
- Joining an audience-restricted group outside one's audience, or a group of another course, is refused.
