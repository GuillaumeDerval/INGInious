# User search autocomplete (user selection box)

- **ID**: CSTU-03
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /admin/<courseid>/search_user/<request>` (endpoint `searchuserpage`)
- **Depends on**: —; used by CSTU-02 (add student), CSTU-05 (audience edit: add students), course settings (admins/tutors fields, other area)
- **Legacy code**: `pages/course_admin/search_user.py:L14-L30`, `templates/course_admin/user_selection_box.html`, `static/js/studio.js:L757-L782` (`user_selection`), selectize.js

## Use case
When adding a user somewhere, the teacher types part of a username or real name and picks the
user from suggestions instead of remembering exact usernames.

## Preconditions
- Staff rights on `<courseid>` (403 otherwise; in the rewrite anonymous visitors are redirected to the sign-in page).

## Main flow
1. `user_selection_box.html` renders `<input type="text" class="form-control user-selection-box" id=… name=… value="u1,u2">`
   and calls `user_selection($('#id'), '/admin/<courseid>/search_user/', current_users, single)`.
2. selectize options: `delimiter: ','`, `valueField: 'username'`, `labelField: 'realname'`,
   `searchField: ['username','realname']`, `create: false`, `persist: false`, `maxItems: single ? 1 : null`.
   Pre-selected items come from `current_users` (`[{realname, username}]`, realname falls back to username).
   Labels are displayed as `"<realname> (<username>)"`.
3. On typing (non-empty query) → `GET <path><encodeURIComponent(query)>`.
4. Server: `q = re.escape(request)`; query
   `users.find({$or: [{username: /.*q.*/i}, {realname: /.*q.*/i}], activate: {$exists: false}, username: {$ne: ""}}, {username, realname}).limit(10)`.
5. Response: `Content-Type: text/json; charset=utf-8`, body **a list wrapped in a list**:
   `[[{"username": "cstu_bob", "realname": "Bob Student"}, …]]` (empty result `[[]]`). Client uses `res[0]`.
6. The selected usernames are submitted as the input value, comma-separated.

## Alternative / error flows
- Unactivated accounts (`activate` field present) are excluded; any other user of the **whole platform**
  can be returned (not limited to the course).
- No ordering specified (natural order), max 10 results.

## UI elements
Selectize text input; dropdown of `realname (username)`; single mode limits to one item.

## Data
Reads `users.username`, `users.realname`, `users.activate`.

## Permissions & security
- Staff only. The search covers all platform users (needed to add users who are not yet in the course) and
  returns only `username` and `realname`, at most 10 results.
- The query is matched literally (regex metacharacters escaped; the rewrite also truncates it to 100 characters).
- Pre-selected users are passed to the client as JSON data.

## Acceptance tests
- Query `cstu_` returns ≤ 10 users whose username or realname contains it (case-insensitive), as `[[…]]`.
- Users with `activate` set are not returned.
- Regex metacharacters in the query (e.g. `a.c`) are matched literally.
- Student → 403; tutor/admin → 200.
- UI: typing in the "Add student" box shows suggestions `Real Name (username)`; single mode allows one item.
