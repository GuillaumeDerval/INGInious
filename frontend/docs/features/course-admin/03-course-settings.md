# Course settings: base, accessibility and registration

- **ID**: CADM-03
- **Actors**: course admin, superadmin
- **Routes**: `GET /admin/<courseid>/settings`, `POST /admin/<courseid>/settings` (endpoint `coursesettingspage`)
- **Depends on**: CADM-02 (rights), CSTU-03 (user search autocomplete used by admins/tutors fields), CADM-04 (LTI part of the same form), CADM-05 (tags part of the same form), CADM-17 (YAML writing); reference `docs/reference/course-model.md`
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/settings.py:L21-L196`; `templates/course_admin/settings.html:L1-L519`; `templates/course_admin/user_selection_box.html`; `static/js/studio.js:L757-L782` (`user_selection`); `accessible_time.py:L11-L120`; `courses.py:L43-L106,L289-L296`

## Use case
A course administrator edits the course descriptor (`course.yaml`) through a form: name, staff, description,
group policy, visibility dates, registration policy and access-control list. One single form/POST also carries
the LTI (CADM-04) and tags (CADM-05) settings.

## Preconditions
- Admin rights on the course (`allow_all_staff=False`); tutors get 403.

## Main flow
1. `GET` renders `course_admin/settings.html` (title "<course name> - Settings") with the menu (`current='settings'`), breadcrumb "Course settings", `<h2>Course settings</h2>` and form `id="edit_course_form" method="post" action="/admin/<c>/settings"`.
2. The form is a Bootstrap card with tabs: **Base** (`#base`), **Accessibility** (`#accessibility`), **LTI 1.1** (`#tab_lti11`, class `lti`), **LTI 1.3** (`#tab_lti13`, class `lti`), **Tags** (`#tags_tab`). One submit button "Save changes" (`fa-download`, full width) below the card.
3. `POST`: the server starts from a deep copy of the current descriptor (`course.get_descriptor()`, an `OrderedDict` preserving the file key order; unknown keys are therefore preserved) and overwrites the keys below. **All listed form fields are mandatory**: a missing field → `KeyError` → HTTP 500 (the UI always sends them).
4. If no error: `Course(courseid, content).save()`, reload, render with green "Settings saved.". Otherwise render each error in a red `alert-danger` (and see the partial-save bug below).

### Fields, processing and validation (Base + Accessibility tabs)
| Form field | UI control | Stored key / processing | Validation / message |
|---|---|---|---|
| `name` | text `#name`, value = `course.get_name(session.language)` (translated name!) | `name` = raw value | `""` → "Invalid name" |
| `description` | textarea `#description` (CodeMirror rst, 10 lines), value = raw `description` | `description` = raw string (`\r\n` normalised by the YAML dumper, trailing spaces of each line removed) | none |
| `admins` | `user_selection_box` (selectize, comma-separated usernames, autocomplete via CSTU-03) | `admins` = `[s.strip() for s in value.split(',')]` or `[]` if blank | non-superadmin whose own username is not in the list → "You cannot remove yourself from the administrators of this course". **Usernames are not checked for existence.** |
| `tutors` | same | `tutors` = same split (`[]` if blank) | none |
| `groups_student_choice` | radios "Staff only" (`false`) / "Staff and students" (`true`); row hidden when LTI is checked (`no-lti`) | bool `== "true"` | none |
| `allow_preview` | radios "Allowed (read-only for non-registered users)" (`true`) / "Not allowed" (`false`) | bool | none |
| `accessible` | radios "Course hidden from students" (`false`), "Always accessible" (`true`), "Custom:" (`custom`) + datetimepickers `accessible_start`, `accessible_end` | `true`→`True`, `custom` → `"<start>/<end>"` (raw strings, either may be empty), anything else → `False` | `AccessibleTime(value)` fails → "Invalid accessibility dates" (see bug: actually HTTP 500) |
| `registration` | radios "Closed" (`false`), "Always open" (`true`), "Custom:" + `registration_start`, `registration_end` | same encoding | "Invalid registration dates" (same bug) |
| `allow_unregister` | radios "Yes" (`true`) / "No" (`false`), label "Allow auto-unregistration" | bool | none |
| `registration_password` | text, placeholder "Password needed for registration. Leave blank if you don't want to set a password." | `""` → `None` (YAML `null`), else the string as typed | none |
| `registration_ac` | radios "No access control (everyone can register)" (`None`), "Check by username" (`username`), "Check by authentication binding" (`binding`), "Check by email" (`email`) | `"None"` → `None` | not in the 4 values → "Invalid ACL value" (but then HTTP 500, see bug) |
| `registration_ac_accept` | radios "Accept" (`true`) / "Deny" (`false`); row `.ac_accept` hidden by JS when "No access control" is checked | bool | none |
| `registration_ac_list` | textarea, placeholder "Only used if access control is activated. Separate users by new lines." | `[line.strip() for line in value.splitlines()]` (empty lines are kept as `""` entries; `*` is a wildcard, see course-model §4) | none |

Date pickers: Tempus Dominus `datetimepicker({locale: session.language, sideBySide: true, format: 'YYYY-MM-DD HH:mm:ssZ', timeZone: session.timezone})`; displayed initial values come from `AccessibleTime.get_std_start_date()/get_std_end_date()` (ISO). A value chosen in the UI is posted e.g. `2025-01-01 10:00:00+00:00`. An empty bound gives `"2025-01-01 10:00:00+00:00/"`.

Radio pre-selection: "hidden" if `is_never_accessible()`, "always" if `is_always_accessible()`, otherwise "custom" (accessibility read with `get_accessibility(False)` i.e. without plugin override; `allow_unregister(False)` likewise).

Client-side JS (inline): `updateLTI()` — if `#lti` checked, hide `.no-lti` rows (group attribution, accessibility, registration, unregister, password, ACL…) and show `.lti` tabs/rows; else the reverse. `hideAcType()` hides `.ac_accept` when `#registration_ac` (value `None`) is checked. Hidden fields are still submitted.

### Example of written `course.yaml` (verified, UI save on a freshly created course)
```yaml
accessible: 2025-01-01 10:00:00+00:00/2027-12-31 23:00:00+00:00
name: CADM Course One
description: |-
    A *test* course

    Second paragraph
admins:
- cadm_admin
tutors:
- cadm_tutor
groups_student_choice: true
allow_unregister: false
allow_preview: true
registration: 2025-01-01 10:00:00+00:00/
registration_password: secret
registration_ac: username
registration_ac_accept: true
registration_ac_list:
- cadm_*
- bob
is_lti: false
lti_url: ''
lti_keys: {}
lti_config: {}
lti_secrets: {}
lti_send_back_grade: false
tags:
    ...
```
Key order = existing keys first in their original order (here `accessible`, `name` from creation), then new keys in
the order assigned by the handler: `name, description, admins, tutors, groups_student_choice, accessible, allow_unregister,
allow_preview, registration, registration_password, registration_ac, registration_ac_accept, registration_ac_list,
is_lti, lti_url, lti_keys, lti_config, lti_secrets, lti_send_back_grade, tags`. Every save writes **all** these keys
(including LTI keys and `tags: {}` even when unused).

## Alternative / error flows (all verified)
- **Partial save despite errors (major bug)**: `define_tags()` (CADM-05) calls `Course(...).save()` with the whole
  `course_content` *before* the error check. Therefore when the tags are valid, the file is written even if other
  errors were reported: e.g. empty name → page shows "Invalid name" but `name: ''` is saved; a non-superadmin
  admin removing himself gets "You cannot remove yourself…" but the new admin list is saved anyway.
  Errors on LTI fields likewise do not prevent saving.
  The rewrite validates everything first and writes nothing on error.
- Invalid dates (`accessible=custom`, `accessible_start=garbage`) or invalid `registration_ac` → the save inside
  `define_tags` constructs a `Course`, which raises "Course has an invalid YAML spec" → **HTTP 500** (nothing written).
  Expected rewrite behaviour: messages "Invalid accessibility dates" / "Invalid registration dates" / "Invalid ACL value".
- Accepted date formats: ISO 8601 (`datetime.fromisoformat`) or `%d/%m/%Y %H:%M:%S`, `%d/%m/%Y %H:%M`, `%d/%m/%Y %H`, `%d/%m/%Y`; naive dates are interpreted in the server's local timezone.
- Missing form field (crafted POST) → 500.
- Re-rendering after error shows the **old** course values (the page is rendered from the unmodified `course` object), so user input is lost.
- When LTI mode is on, `Course` forces at load time: accessible=always, registration closed, no password, no ACL, `groups_student_choice=False`, `allow_unregister=False` (values in the file are kept but ignored and the form shows the forced values, so the next save writes the forced values).

## UI elements
- Success: `alert-success` "Settings saved."; errors: one `alert-danger` per message, above the form.
- `user_selection_box.html`: `<input class="form-control user-selection-box" name=admins|tutors value="u1,u2">` + inline script building `current_users_<name>` = `[{"realname": ..., "username": ...}]` (realname falls back to username when the user doesn't exist) and calling `user_selection($('#id'), '/admin/<c>/search_user/', current_users, single=false)`; selectize options show "Realname (username)".

## Data
- Reads/writes `<tasks_directory>/<courseid>/course.yaml` only. No MongoDB access (except user lookup for realnames).
- Course cache: `fetch_or_cache` is keyed on file mtime, so the next request reloads the file.

## Permissions & security
- Admin or superadmin only. The POST is protected against cross-site request forgery.
- A non-superadmin admin cannot remove himself from the administrators (the whole save is refused).
- `registration_password` is stored in `course.yaml` (data-format parity) and shown to admins in the form.
- Unknown usernames can be added as admins/tutors; no notification.
- All values are escaped when rendered.

## Acceptance tests
- GET as admin shows all fields pre-filled from `course.yaml` (radios for hidden/always/custom, dates in ISO format).
- POST full valid form → exact YAML above (types: booleans, `null` password, lists), "Settings saved.".
- Empty name → "Invalid name" and file unchanged (rewrite; legacy saves).
- Non-superadmin removing himself from admins → error and file unchanged; superadmin may remove everybody.
- Custom accessibility with bad date → "Invalid accessibility dates", file unchanged (legacy: 500).
- `registration_ac=foo` → "Invalid ACL value".
- ACL list "a\n\nb" → `['a', '', 'b']` (legacy parity) — or document deliberate cleanup.
- Toggling the LTI checkbox hides/shows `.no-lti` / `.lti` elements; choosing "No access control" hides the Accept/Deny row.
- Tutor/student POST → 403.
