# Site administration: create a user

- **ID**: SITE-02
- **Actors**: superadmin
- **Routes**: POST /administrator/users?/add (app form action); legacy: POST /administrator/user_action (`action=add_user`)
- **Depends on**: SITE-01
- **Legacy code**: `pages/admin/admin.py:L37-70` (`AdministrationUserActionPage`, branch L57-65),
  `user_manager.py:L366-379` (`create_user`), `user_manager.py:L833-843` (`hash_password`),
  `templates/admin/admin_users.html` (`#add_modal`), `static/js/admin.js:L51-84` (`action_handler`)

## Use case
The superadmin creates a local (password) account for someone without going through public
registration/e-mail activation (e.g. when registration is disabled).

## Preconditions
- Logged in as superadmin.

## Main flow
App behaviour (`app/src/routes/administrator/users/+page.server.ts`, action `add`,
`lib/server/site/users.ts` `createUser`): the "Add user" form posts `username`, `realname`,
`email`, `password` to the `add` action. The account policy shared with self-registration
is applied (username of 4+ characters among letters, digits and `-_|~`, non-empty real
name, valid e-mail, which is normalised, password of 6+ characters); an existing user with
the same username or e-mail gives "User could not be created."; otherwise an activated
account is inserted with an argon2id password hash and the action answers "User created.".
Errors are returned as a failed form action (HTTP 400) with the message, and no user is
created.

Legacy flow (reference):
1. On `/administrator/users`, click "Add user" → modal "Add user" with fields:
   "Username (min. 4 alphanumerical characters) :" (`input[name=usrname]`), "Complete name :"
   (`realname`), "Email address :" (`email`), "Password (min. 6 characters) :" (`password`, type password).
2. Click "Add" → `action_handler('add_user')` sends an AJAX `POST user_action` (relative URL →
   `/administrator/user_action`) with form fields `username, realname, email, password, action=add_user`.
3. Server: `create_user({username, realname, email, password})`:
   - if a user exists with the same `username` **or** the same `email` → returns message
     "User could not be created.";
   - else inserts a `User` with `password = "argon2id-" + argon2.hash(password)`.
4. Response JSON `{"message": ""}` (HTTP 200) → JS redirects to `users` (page 1).

## Alternative / error flows
- Duplicate username or email → failed action (400) "User could not be created." shown in
  the form (legacy: `{"error": true, "message": …}` with HTTP 200).
- Invalid username, real name, e-mail or password → failed action (400) with "Invalid
  username format." / "Name is too short." / "Invalid email format." / "Password too
  short."; no user is created.
- Missing fields → 400 "Invalid form data." (legacy: HTTP 500).
- Closing the modal (`hide.bs.modal`) clears the feedback.

## UI elements
`img/admin-users-add.png`. Modal title "Add user", buttons "Cancel" / "Add". Error alert `#feedback_add`.

## Data
Insert into `users` (mongoengine `User`, `models/user.py`), exact stored document (verified):
```
{ _id: ObjectId, username: str, realname: str, email: str,
  password: "argon2id-$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>",
  language: "en", code_indentation: "4", bindings: {}, ltibindings: {},
  tos_accepted: false, timezone: "<server local tz, e.g. Etc/UTC>", pinned_courses: [] }
```
No `activate` field (account immediately usable), no `apikey` (generated lazily, see SITE-22).
Reads `users` with query `{$or: [{username}, {email}]}`. No e-mail is sent.

## Permissions & security
- Superadmin only: anonymous users are redirected to the sign-in page, other users get
  403; the check is made by the action itself.
- The POST is protected by the origin check of form POSTs.
- Usernames follow the username rule, so they are safe in URLs such as `/admin/<course>/student/<username>`.
- The password policy (min. 6 characters) is enforced.

## Acceptance tests
- Create `site_x1`/valid data → "User created.", user exists with argon2id hash, can log in.
- Same username or same email again → failure "User could not be created.".
- Non-superadmin POST → 403, no user created.
- Invalid username, e-mail or too-short password → failure (400) with the message, no user created.
- Missing fields → 400.
