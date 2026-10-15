# Site administration: delete a user

- **ID**: SITE-03
- **Actors**: superadmin
- **Routes**: POST /administrator/users?/delete (app form action); legacy: POST /administrator/user_action (`action=delete`)
- **Depends on**: SITE-01
- **Legacy code**: `pages/admin/admin.py:L48-50`, `user_manager.py:L347-364` (`delete_user`),
  `user_manager.py:L673-690` (`course_unregister_user`), `templates/admin/admin_users.html` (`#delete_modal`),
  `static/js/admin.js:L51-84`

## Use case
The superadmin removes an account and all its personal data (submissions, task progress, course
registrations), e.g. on GDPR request or to clean spam accounts.

## Preconditions
- Logged in as superadmin. The target is not the current user.

## Main flow
App behaviour (`app/src/routes/administrator/users/+page.server.ts`, action `delete`,
`lib/server/auth/accounts.ts` `deleteUser`): the target is designated by `username`. Own
account → 403 "You cannot delete your own account here."; unknown user → 404 "Impossible
to delete this user". Otherwise the user document is deleted, then: the submissions of
which the user is the only author are deleted together with their GridFS input and archive
files; the user is removed from the authors of the group submissions shared with
teammates (which are kept); the user's `user_tasks` are deleted; the user is unregistered
from every course (`courses`, `groups`, `audiences`); every session of the user is deleted.
Answer: "User deleted.".

Legacy flow (reference):
1. Click the trash button of a row → modal "Delete <username>" with text "This will delete <username>. Are you sure ?"
2. Click "Remove" → AJAX POST `user_action` with `username=<username>, action=delete`
   (plus empty `realname/email/password`).
3. `delete_user(username)`:
   1. `User.objects(username=username).modify(remove=True)` (find-and-delete);
   2. if a user was removed: `Submission.objects(username=username).delete()` (all submissions whose
      `username` array **contains** the user — i.e. including **group submissions shared with other
      students**), `UserTask.objects(username=username).delete()` (`user_tasks`), and for each
      `courses` document whose `students` contains the user: `course_unregister_user(courseid, username)`
      which pulls the username from `audiences.students`, `groups.students`, `courses.students`.
4. Response `{"message": ""}` → page reloads.

## Alternative / error flows
- Unknown username → `{"error": true, "message": "Impossible to delete this user"}` shown in `#feedback_delete`.
- The current user's row has no delete button, and the action refuses the own username
  (403). Another superadmin can be deleted.
- Closing the modal clears the feedback.

## UI elements
Modal `#delete_modal`: title "Delete <span class=username>", danger alert `#feedback_delete`,
buttons "Cancel" and "Remove".

## Data
- Deletes from `users`, `submissions` (own ones, with their GridFS files), `user_tasks`,
  `sessions`; updates group submissions (`$pull username`), `audiences`, `groups`,
  `courses` (`$pull students`).
- Not changed: usernames in `course.yaml` `admins`/`tutors` and the `superadmins` config.
- Legacy deleted every submission containing the user (including group submissions shared
  with teammates) and left their GridFS files.
- The sessions of the deleted user (`sessions` collection) are removed: after deletion
  `GET /api/v0/authentication` answers `{"authenticated": false}` for them.

## Permissions & security
- Superadmin only (anonymous → sign-in page, others → 403); the POST is protected by the
  origin check of form POSTs; a superadmin cannot delete their own account here.
- Group submissions shared with teammates are kept for the teammates (only the deleted
  user is removed from them).
- The sessions of the deleted user are deleted.

## Acceptance tests
- Delete a student with submissions → user, its `user_tasks`, its submissions removed; removed
  from `courses.students`, `groups.students`, `audiences.students`.
- Delete unknown user → error message "Impossible to delete this user".
- Non-superadmin → 403; own username → 403, nothing deleted.
- The GridFS files of the deleted submissions are removed, the user's sessions are closed and the
  group submissions of teammates are kept.
