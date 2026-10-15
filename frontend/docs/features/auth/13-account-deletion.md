# Account self-deletion

- **ID**: AUTH-13
- **Actors**: any logged-in user
- **Routes**: GET/POST `/preferences/delete`
- **Depends on**: AUTH-05, AUTH-11 (menu)
- **Legacy code**: `legacy/inginious/frontend/pages/preferences/delete.py:L12-L50`, `legacy/inginious/frontend/user_manager.py:L347-L364` (`delete_user`), `L673-L690` (`course_unregister_user`), template `templates/preferences/delete.html`, `templates/preferences/menu.html:L11-L15`

## Use case
A user (GDPR "right to erasure") deletes their account and all their data, confirming by typing
their e-mail address.

## Preconditions
- `allow_deletion: true` (default true). Logged in.

## Main flow
1. `GET /preferences/delete` → form: label "To confirm, type your email address :", text input `delete_email`, red button "Delete my account" that opens modal `#delete_modal` ("This will also delete all your data ! Are you really sure ?", buttons "Cancel" / submit `name="delete"` "Delete my account").
2. POST `delete=&delete_email=<email>` → `delete_user(session.username, delete_email)`:
   1. `users.findOneAndDelete({username, email: delete_email})` (exact match); none → red "The specified email is incorrect.".
   2. `submissions.deleteMany({username: <username>})` — matches every submission whose `username` **array contains** the user, i.e. **group submissions are deleted for all group members** (verified). GridFS files referenced by `input`/`archive` are not removed (queryset delete).
   3. `user_tasks.deleteMany({username})`.
   4. For every `courses` doc with `students` containing the user: `course_unregister_user` → `$pull` from `audiences.students`, `groups.students`, `courses.students` for that course.
   5. `disconnect_user()` (`session.loggedin=false`).
3. 302 → `/` (index).

## Alternative / error flows
- `allow_deletion: false` → 403 "User unavailable or deletion is forbidden." (GET) / "User unavailable or deletion forbidden." (POST); menu entry hidden.
- POST without `delete` → page re-rendered, nothing deleted.
- Wrong e-mail → error message, nothing deleted.
- Not removed: course staff lists (`course.yaml` admins/tutors on disk), `audiences`/`groups` where the user is a **tutor**, LTI bindings in other collections, contest/scoreboard plugin data, `fs.files`/`fs.chunks` of submissions.

## UI elements
- Title/breadcrumb "Delete my account" (`fa-user-times`), preferences menu.
- Bootstrap modal confirmation (client-side only; the server needs `delete` + matching e-mail).

## Data
- Deletes: `users` doc; `submissions` where `username` contains user; `user_tasks` with `username`.
- Updates: `courses.students`, `audiences.students`, `groups.students` (`$pull`).
- Config: `allow_deletion`.

## Permissions & security
- Group submissions shared with other students are kept for them (the user is only `$pull`ed from their `username` list); the user's own submissions are deleted with their GridFS files.
- The account is the one of the current session (by `_id`), and the typed e-mail must match it exactly.
- All sessions of the user are closed on deletion.
- The deletion POST is protected by the origin check (CORE-04) and requires the typed e-mail confirmation.

## Acceptance tests
- Wrong e-mail → "The specified email is incorrect.", user still present.
- Correct e-mail → 302 `/`; `users` doc gone; `user_tasks` of the user gone; user pulled from `courses.students`, `audiences.students`, `groups.students` of course `authdel`; (deleting `auth_bob`) a submission `{username:['auth_bob','auth_alice']}` is kept as `{username:['auth_alice']}`, `{username:['auth_alice']}` stays and `{username:['auth_bob']}` is deleted; every session of the user is closed.
- `allow_deletion:false` → 403 on GET and POST, no menu link.
