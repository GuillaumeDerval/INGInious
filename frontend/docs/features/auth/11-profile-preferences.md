# Profile preferences (name, username completion, password, language, timezone, indentation)

- **ID**: AUTH-11
- **Actors**: any logged-in (non-LTI) user
- **Routes**: GET `/preferences` (302 → `/preferences/profile`), GET/POST `/preferences/profile`
- **Depends on**: AUTH-05 (gate), AUTH-09 (ToS), AUTH-10 (language), AUTH-14 (users created by external auth have no username/password)
- **Legacy code**: `legacy/inginious/frontend/pages/preferences/profile.py:L19-L153`, `legacy/inginious/frontend/pages/preferences/utils.py:L12-L21`, `legacy/inginious/frontend/app.py:L107-L113` (`INDENTATION_TYPES`), templates `templates/preferences/profile.html`, `templates/preferences/menu.html`, `templates/layout.html:L224-L231`

## Use case
A user edits their display name, interface language, timezone (used to display dates), code-editor
indentation and password. Users created through an external provider (empty username) must choose
a username here before doing anything else, and may set a local password.

## Preconditions
- Logged in. Users with empty `session.username` or un-accepted ToS are always redirected here by the gate (the profile page itself is exempt).

## Main flow
1. `GET /preferences` → 302 `/preferences/profile` (a POST to `/preferences` → 500: `POST_AUTH` takes an unexpected `courseid` argument).
2. `GET /preferences/profile` → `users.findOne({email: session.email})` (by **email**), renders form pre-filled **from the session**: `username` (disabled if non-empty), `realname`, `email` (always disabled — e-mail is not editable), `language` select, `timezone` select (all `zoneinfo.available_timezones()` sorted, enhanced with selectize), `code_indentation` select, and if `allow_registration`: `oldpasswd`, `passwd`, `passwd2`; if ToS defined: `term_policy_check`.
3. User submits (button `name="save"` "Save my profile"). Processing order (`save_profile`), each failing step returns immediately with a red alert; changes of later steps are not saved, but the **username change of step a is already committed**:
   - a. **Username completion** — only if the stored `username` is empty and `username` is posted: must match `^[-_|~0-9A-Z]{4,}$` (case-insensitive) else "Invalid username format."; must not exist (`users.findOne({username})`) else "Username already taken"; then `users.findOneAndUpdate({email: user.email}, {$set:{username}})` (none → "Incorrect email.") and `session.username = username`. A non-empty username can never be changed.
   - b. **Password** — only when `allow_registration` is true:
     - `1 <= len(passwd) <= 5` → "Password too short."
     - `len(passwd) > 0` and `passwd != passwd2` → "Passwords don't match !"
     - `len(passwd) >= 6`: if the user has a password → `auth_user(session.username, oldpasswd, do_connect=False)`; failure → "Incorrect old password."; if the user has **no** password (external-auth account) → no old password required. New hash `argon2id-…` queued.
     - empty `passwd` → no change.
   - c. **Language** — if different from stored: value if in available languages else `"en"`.
   - d. **Code indentation** — if different: value if in `{"2","3","4","tabs"}` else `"4"`.
   - e. **Real name** — if different: non-empty required else "Name is too short." (no max length, no trimming).
   - f. **Timezone** — if different: must be in `zoneinfo.available_timezones()` else "Incorrect timezone.".
   - g. If anything queued: `users.update({username: session.username}, {$set: {...}})`; session updated for `language`, `code_indentation`, `realname`, `timezone`.
   - h. Message "Profile updated." (green). If ToS defined: `users.update({username}, {$set:{tos_accepted: "term_policy_check" in form}})` and `session.tos_signed` = the same value (AUTH-09).
4. Page re-rendered (200) with the alert; the form shows the (updated) session values.

## Alternative / error flows
- POST without `save` → page re-rendered, nothing changed.
- POST missing any of `passwd`, `passwd2`, `language`, `code_indentation`, `realname`, `timezone` → 400 (KeyError). (`oldpasswd` only needed when a password change is attempted.)
- A passwordless user can set the username *and* a new password in the same submit (legacy answered 500 there, `User.objects.get(username=<old empty username>)` → DoesNotExist, after saving the username).
- `allow_registration: false` → password fields hidden and password changes ignored.
- Unchanged values are not written (a user without stored `timezone` keeps it absent if the server default is posted).

## UI elements
- Left column: preferences menu (`menu.html`): "My profile" (`fa-user`), "Authentication bindings" (`fa-id-card-o`), "Delete my account" (`fa-user-times`, red, only if `allow_deletion`), plus plugin entries from hook `prefs_menu` (`(endpoint, html_name)` pairs).
- Breadcrumb: gears icon → `/preferences`, active "My profile".
- Warnings (yellow) when `not session.username`: "Please set a new username"; when ToS not signed: "Please accept the Terms of Service and Data Privacy".
- Labels: "Username :", "Complete name :", "Email address :", "Language :", "Timezone :", "Code indentation :", "Old password :", "New password (min. 6 characters) :", "Confirm new password :".
- Indentation option labels (translated): "2 spaces", "3 spaces", "4 spaces", "tabs".
- Effects elsewhere: `layout.html` sets JS globals `user_indentation_type = INDENTATION_TYPES[session.code_indentation]` (`{"indent":4,"indentWithTabs":true,"text":"tabs"}` …) used by CodeMirror, and `dtf = new Intl.DateTimeFormat([moment.locale(language),"en"], {dateStyle:"short", timeStyle:"medium", timeZone: session.timezone})` used to render dates client side; course admin date pickers and statistics use `session.timezone` too.

## Data
- `users` fields written: `username` (only from empty), `password` (`argon2id-…`), `language`, `code_indentation` (`"2"|"3"|"4"|"tabs"`), `realname`, `timezone` (IANA name), `tos_accepted`.
- `sessions` fields updated: `username`, `language`, `code_indentation`, `realname`, `timezone`, `tos_signed`.
- `INDENTATION_TYPES = {"2":{text:"2 spaces",indent:2,indentWithTabs:false}, "3":{…3…}, "4":{…4…}, "tabs":{text:"tabs",indent:4,indentWithTabs:true}}`.
- Default timezone of a user/session = server local zone (`tzlocal.get_localzone_name()`, `Etc/UTC` in Docker). Rewrite must keep the same default semantics (or use a config default) because the field is often absent in DB.
- Config: `allow_registration`, `allow_deletion`, `terms_page`, `privacy_page`.

## Permissions & security
- The account is found by the session e-mail **and** username, on both load and save, and updated by its `_id` in a single write.
- Accounts without a password (external sign-up) can set one without an old password (by design); accounts with a password must give the old one.
- A password change closes the user's other sessions and removes any pending reset token.
- Profile POSTs are protected by the origin check (CORE-04).
- Realname not length-limited; it is rendered escaped in templates.
- No e-mail change feature (users cannot update their e-mail).

## Acceptance tests
- `GET /preferences` → 302 `/preferences/profile`.
- Each validation error with exact message: empty realname → "Name is too short."; `timezone=Mars/Base` → "Incorrect timezone."; `passwd=12345` → "Password too short."; mismatch → "Passwords don't match !"; wrong old password → "Incorrect old password.".
- Valid change of language `fr`, timezone `Europe/Brussels`, indentation `tabs`, realname, password (with correct old) → "Profil mis à jour." (French), DB updated (`password` new argon2id), pages show `moment.locale("fr")`, `timeZone: "Europe/Brussels"`, `user_indentation_type` tabs; login with new password works.
- `language=xx` → stored `en`; `code_indentation=zz` → stored `4`.
- User with empty username (external account): every protected GET redirects to profile; `username=ab` → "Invalid username format."; `username=auth_alice` (taken) → "Username already taken"; valid → username stored, input then disabled and further `username` posts ignored.
- Passwordless user can set a password without `oldpasswd` (a single submit with username+password also works, no 500).
- `allow_registration:false` → no password fields; posted `passwd` ignored.
