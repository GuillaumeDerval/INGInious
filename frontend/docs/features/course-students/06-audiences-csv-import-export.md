# Audiences structure: CSV download and CSV upload (bulk creation)

- **ID**: CSTU-06
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /admin/<courseid>/students?preferred_field=username|email` (download); `POST /admin/<courseid>/students` multipart with `audiencefile` + `upload_audiences_creation`
- **Depends on**: CSTU-04, CSTU-02 (implicit registration), CSTU-07 (groups reference audience ids)
- **Legacy code**: `pages/course_admin/student_list.py:L23-L43` (download), `L178-L263` (upload), `L265-L270`, `templates/course_admin/student_list.html:L80-L148`

## Use case
At the start of term the teacher imports the whole audience repartition (students and tutors per
audience) from a spreadsheet, or exports the current repartition to edit it offline.

## Preconditions
Staff rights.

## Main flow
Download:
1. Button "Download structure" opens modal `#download_audiences_structure` (GET form, `action="#"`): radio
   `preferred_field` ∈ {`username`, `email`} (none pre-checked), submit `download_audiences_structure` "Download".
2. Server (only if `preferred_field` ∈ {username, email}): for each audience (natural order), for each student then each tutor,
   write a CSV row `[value, preferred_field, "student"|"tutor", description]` where value is the username or the
   user's `email` (`User.objects.get(username)` — raises 500 if a listed user no longer exists).
3. Response `Content-Type: text/csv`, `Content-Disposition: attachment; filename="audiences.csv"`, **no header row**, CRLF.
   Verified:
   ```
   cstu_eve@x.org,email,student,Group A
   cstu_tutor@x.org,email,tutor,Group A
   ```
Upload:
4. Button "Upload audiences" opens modal `#upload_audiences_creation`: file input `audiencefile`, submit
   `upload_audiences_creation` "Upload (will erase current repartition)"; note "Please refer to documentation for file format".
5. Server: read whole file as UTF-8 CSV (csv.reader, default dialect).
   a. If any line has ≠ 4 columns → red "File wrongly formatted.", nothing changed.
   b. Otherwise **delete all audiences of the course first**, then for each line `user_id, field, role, description` (stripped):
      - `field` ∉ {username, email} → message "Field was not recognized: <field>", skip line;
      - `role` ∉ {student, tutor} → "Unknown role: <role>", skip;
      - `users.find_one({field: user_id})` none → "User was not found: <user_id>", skip;
      - accumulate students/tutors per description.
   c. Create audiences: if at least one audience has students, one audience per description **having students**
      (tutors attached if same description); audiences that only have tutors are **dropped**. If no student at all,
      tutor-only audiences are created.
   d. `courses.students = list(set(old registered students) ∪ imported students)` (**implicit enrolment, order lost**).
   e. Insert audiences (new ObjectIds — the "keep existing id" branch never triggers since everything was deleted).
6. Tab Audiences re-rendered. On success **no message** is shown; on line errors only the **last** error message is shown (red),
   but valid lines were applied and old audiences are gone.

## Alternative / error flows
- No file / undecodable file → red "An error occurred while parsing the data.".
- All lines invalid → all audiences deleted, none created (verified).
- Audience ids change at every upload ⇒ `groups.audiences` restrictions become dangling (verified) — groups lose their restriction semantics.
- Duplicate lines produce duplicate usernames in `students`.

## UI elements
Two modals described above; messages in the Audiences tab alert.

## Data
- Writes `audiences` (delete_many + inserts), `courses.students` ($set).
- Reads `users` by `username` or `email`.

## Permissions & security
- Upload (destructive) is admin-only; download is available to staff.
- CSV text cells starting with a formula character (`=`, `+`, `-`, `@`, tab, carriage return) are neutralised (prefixed with `'`) in the download.
- The uploaded file is subject to the server's request body size limit (`BODY_SIZE_LIMIT` of the Node adapter, 512 KB
  by default).

## Acceptance tests
- Download with `preferred_field=username` and `email` produce the rows above (student rows before tutor rows per audience, audiences naturally sorted, no header).
- `preferred_field` absent/invalid ⇒ normal HTML page.
- Upload valid file (students by username and by email, a tutor, a tutor-only audience) ⇒ audiences recreated as specified (tutor-only audience dropped when others have students), new students enrolled.
- Upload file with a 3-column line ⇒ "File wrongly formatted.", nothing changed.
- Upload with unknown user ⇒ last error shown, other lines applied, previous audiences deleted.
- Decide (and test) whether the rewrite keeps ids of audiences with the same description (recommended, fixes group restrictions).
