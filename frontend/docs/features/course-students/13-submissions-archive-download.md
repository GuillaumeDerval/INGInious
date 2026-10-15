# Submissions archive download (bulk and single)

- **ID**: CSTU-13
- **Actors**: course admin, tutor, superadmin
- **Routes**: `POST /admin/<courseid>/submissions` with `download` (+ `displayed_selection`, `download_type`, `eval_dl`, `simplify`); `GET /admin/<courseid>/submissions?download_submission=<submissionid>`
- **Depends on**: CSTU-11, CSTU-04 (audience folder names), CSTU-15 ("Download full submission" button)
- **Legacy code**: `pages/course_admin/submissions.py:L45-L60,L93-L107`, `submission_manager.py:L647-L778` (`get_submission_archive`), `templates/course_admin/submissions.html:L221-L258`, `inginious/common/custom_yaml.py`

## Use case
Teachers download the selected submissions (metadata, the files uploaded by the students and the
grader-produced archive) as one `.tgz`, organised by task/user or by audience, e.g. for plagiarism
checks or manual grading.

## Preconditions
Staff rights.

## Main flow (bulk)
1. Header button opens modal `#download_modal` (form `POST submissions#alerts`, hidden `displayed_selection`):
   radio `download_type` ∈ `taskid/username`, `taskid/audience`, `username/taskid`, `audience/taskid` (none pre-checked);
   checkbox `eval_dl` "Only evaluation submissions"; checkbox `simplify` "Simplified file tree"; buttons Cancel / `download` "Download".
2. Server: `best_only = "eval_dl" in form`; params from `displayed_selection`; all matching submissions (no paging), evaluation-only if `best_only` or `eval` in params.
3. `download_type` invalid/absent ⇒ `taskid/username`. `sub_folders = download_type.split('/')`, plus `"submissiondateid"` **unless** (`eval_dl` or `eval`) **and** `simplify`.
4. Archive layout (`get_submission_archive`): for each submission, one or more base paths built from `sub_folders`:
   - `taskid` → task id;
   - `username` → one path **per member** (group submissions duplicated);
   - `audience` → per member: each audience of the member (`"<description> (<audienceid>)"` with spaces → `_`, e.g. `Group_A_(6acf…07b4)`); members in no audience → `"-".join(sorted(usernames))`;
   - `submissiondateid` → `submitted_on.isoformat()` (e.g. `2026-10-14T05:31:16.070000+00:00`);
   - (also supported internally: `group` → sorted usernames joined by `-`, `submissionid` → id, any other literal).
   Duplicate base paths get suffixes `-1`, `-2`, ….
5. Content of each base path:
   - `submission.test`: YAML (`custom_yaml.dump`) of the raw Mongo document (`_id`, `archive` (GridFS id), `courseid`, `custom`, `grade`, `input` (**GridFS id only, not the answers**), `problems`, `response_type`, `result`, `state`, `status`, `stderr`, `stdout`, `submitted_on`, `taskid`, `tests`, `text`, `user_ip`, `username`, …); mtime = submitted_on.
   - `archive/…`: every member of the grader archive (`submissions.archive`, a tgz in GridFS) re-rooted under `archive/` (member metadata — owner `worker`, modes, directories — preserved).
   - uploaded files: for every input value that is a dict with `filename`: `uploaded_files/<problemid><ext>` (or `<problemid><ext>` directly when `simplify`, unless that equals `submission.test`); ext = last extension, or `.tar.gz`/`.tar.bz2`/`.tar.bz`/`.tar.xz`.
6. Response `application/x-gzip`, `Content-Disposition: attachment; filename="submissions.tgz"`.
   Verified listing (`taskid/username`):
   ```
   answer/cstu_dan/2026-10-14T05:31:16.070000+00:00/submission.test
   answer/cstu_dan/2026-10-14T05:31:16.070000+00:00/archive/
   answer/cstu_dan/2026-10-14T05:31:16.070000+00:00/archive/answer.txt
   answer/cstu_dan/2026-10-14T05:31:16.070000+00:00/uploaded_files/upload.txt
   ```
   and with `eval_dl`+`simplify`: `answer/cstu_dan/{submission.test,archive/,archive/answer.txt,upload.txt}`.

## Main flow (single)
- Row button / submission page button → `GET ?download_submission=<id>`; looks up `{_id, courseid, status ∈ [done, error]}` (else **404** "The submission doesn't exist."); archive with `sub_folders = []` ⇒ files at the root (`submission.test`, `archive/…`, `uploaded_files/…`). Logged "Downloading submission …".

## Alternative / error flows
- On the first submission that fails, processing stops; bulk ⇒ page re-rendered with yellow alert
  "The following submission could not be prepared for download: <id>"; single ⇒ the normal submissions page is rendered (no message).
- **Legacy bug (verified)**: any submission without grader archive (MCQ tasks, crashed jobs) fails, because
  `'archive' in submission` is always true for mongoengine and `tarfile.open` on an empty GridFS proxy raises
  "nothing to open". Selections containing MCQ submissions therefore cannot be downloaded. The rewrite must skip missing archives.
- Waiting submissions are included in bulk downloads (not in single).

## Data
Reads `submissions`, GridFS `fs.files`/`fs.chunks` (input BSON and archive), `audiences`.

## Permissions & security
- Single download is scoped to `courseid` (foreign id ⇒ 404, verified).
- Member names of the grader archive are sanitised when copied under `<base>/archive/` (no `..`, no absolute
  paths) and every member that is not a regular file or a directory (symlinks, hardlinks, devices…) is dropped.
  Task ids, usernames and audience descriptions used as directory names are sanitised too (no separators, no `.`/`..`).
- Uploaded filenames are not used (only the problem id + extension).
- The `.tgz` is streamed to the client while it is being built.

## Acceptance tests
- For each of the four `download_type` values, the tgz contains the documented paths (group submission duplicated per member; audience-less student uses joined usernames).
- `eval_dl` + `simplify` ⇒ no date folder and uploaded files at the base path; `simplify` alone ⇒ date folder kept, files not in `uploaded_files/`.
- `submission.test` parses as YAML and contains the documented keys.
- Selection including an MCQ submission (no archive) downloads successfully in the rewrite (legacy: error alert).
- Single download of a submission of another course ⇒ 404; waiting submission ⇒ 404.
- Archive member `../evil` in grader archive ⇒ stored as `archive/evil`; a symlink member ⇒ dropped.
