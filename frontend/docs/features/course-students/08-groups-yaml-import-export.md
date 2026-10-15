# Groups structure: YAML download / upload

- **ID**: CSTU-08
- **Actors**: course admin, tutor, superadmin
- **Routes**: `GET /admin/<courseid>/students?download_groups`; `POST /admin/<courseid>/students` multipart with `groupfile` + `upload_groups`
- **Depends on**: CSTU-07, CSTU-04 (audience ids)
- **Legacy code**: `pages/course_admin/student_list.py:L45-L53` (download), `L297-L325` (upload, shared with CSTU-07), `templates/course_admin/student_list.html:L211-L241`, `inginious/common/custom_yaml.py`

## Use case
Export the group composition to edit it offline or reuse it next year, and re-import it in one go.

## Preconditions
Staff rights; non-LTI course for upload (LTI ⇒ ignored).

## Main flow
Download:
1. "Download structure" link `?download_groups` →
   `yaml.dump([{"description", "students": [..], "size": int, "audiences": [str(ObjectId)]} for each group (natural order)])`
   (PyYAML default flow style, keys sorted alphabetically by `yaml.dump`).
2. `Content-Type: text/x-yaml`, `Content-Disposition: attachment; filename="groups.yaml"`. Verified:
   ```yaml
   - audiences:
     - 6acf13acd379057911ec0778
     description: G1
     size: 2
     students:
     - cstu_eve
     - cstu_bob
   ```
Upload:
3. Modal `#upload_modal_groups` ("Upload course structure"): file `groupfile`, button `upload_groups` "Upload (will erase current settings)".
4. Server: **delete all groups of the course**, parse YAML (`custom_yaml.load`), each entry without `_id` gets `_id='None'` (new group); an entry that contains `_id` is treated as an existing group id (the rewrite ignores ids in uploaded files: every entry becomes a new group of the URL course; an invalid file leaves the existing groups untouched). Each entry then goes through `update_group` (same validation as CSTU-07: size, registration, audience restriction).
5. Messages as CSTU-07 ("Groups updated." or the rejected-students list; parse error → "An error occurred while parsing the data.").

## Alternative / error flows
- Entry missing `audiences`/`students`/`size`/`description` → parse error message; groups already deleted stay deleted.
- Audience ids in the file that do not exist are stored anyway (no validation); invalid ObjectId strings → error.
- Upload without file → "An error occurred while parsing the data." but `custom_yaml.load(None.read())` raises *after* the delete ⇒ **all groups are deleted**.

## UI elements
"Upload structure" (red) + "Download structure" (green) buttons in the Groups tab header; modal described above.

## Data
`groups` collection (see CSTU-07). Download converts audience ObjectIds to strings; upload converts back to ObjectId.

## Permissions & security
- Tutors can upload (destructive; staff rights, same as CSTU-07).
- Group ids in an uploaded file are ignored (every uploaded group is created as a new group of this course); only the
  groups of the URL course are replaced. LTI course → 403.
- YAML is parsed with a safe loader.

## Acceptance tests
- Download returns the documented YAML (round-trippable) with correct headers.
- Upload of the downloaded file reproduces identical groups (new ids).
- Upload with an oversize group ⇒ group created empty; with unknown student ⇒ listed in error.
- Upload of invalid YAML ⇒ error message; specify whether existing groups are preserved (legacy deletes them first).
