# Grading archive and submission archive export

- **ID**: TASK-23
- **Actors**: grading script (produces), tutor/admin (downloads via course admin pages)
- **Routes**: produced during TASK-09; downloaded through course-admin submission download pages (`/admin/<courseid>/download…`, other area) which call `get_submission_archive`
- **Depends on**: TASK-09, COURSE-ADMIN download feature
- **Legacy code**: `legacy/inginious/frontend/submission_manager.py:L61-L63,L647-L778`, container API `scripts/archive.py`, `INGInious.py` (`b64tararchive`)

## Use case
Grading scripts save artefacts (generated files, logs, compiled binaries) in `/archive`; staff
download them with the submissions to inspect or re-grade offline.

## Main flow
1. In the container, anything written in `/archive` (helper `archive -a <file> [-s <subdir>]`, `-r` to remove) is tar-gzipped and base64-encoded into the result (`feedback['archive']`), decoded by the docker agent into bytes.
2. `_job_done_callback`: `submission.archive.put(archive)` (GridFS file, `submissions.archive = ObjectId`) before the result update.
3. Export `get_submission_archive(course, submissions, sub_folders, archive_file=None, simplify=False)` → tgz:
   - path components from `sub_folders`: `taskid`, `username` (one copy per member), `audience` (`<description>_(<id>)` with spaces → `_`, or the joined usernames when not in an audience), `group` (sorted usernames joined with `-`), `submissionid`, `submissiondateid` (ISO `submitted_on`), any other literal string;
   - duplicate paths get `-1`, `-2`… suffixes;
   - per submission: `<base>/submission.test` = YAML dump of the whole mongo document (`custom_yaml.dump(submission.to_mongo().to_dict())`, mtime = `submitted_on`); the grading archive members re-rooted under `<base>/archive/`; uploaded files as `<base>/uploaded_files/<pid><ext>` (or `<base>/<pid><ext>` with `simplify=True`), ext computed with double extensions `.tar.gz`, `.tar.bz2`, `.tar.bz`, `.tar.xz`;
   - on any exception the loop stops and the failing submission id is returned as `error`.
4. Returns `(tmpfile positioned at 0, error)`.

## Alternative / error flows
- Replay (non copy) deletes the old archive (`submission.archive.delete()`) before re-running.
- Large archives count in the 16 MB check only through GridFS (no limit) — the document limit applies to text/feedback.

## UI elements
None on the task page (staff download pages).

## Data
`submissions.archive` (GridFS ObjectId). GridFS `fs.files` without filename.

## Permissions & security
`submission.test` contains the input (incl. e-mails) and `user_ip`; only course staff (tutors included) can export (course admin feature). Archive member names coming from the container are normalised (no absolute paths, no `.`/`..` segments) before being added under the base path; only regular files and directories are kept (links and special members are dropped). The single grading archive of a submission is also downloadable from the task URL (`$archive/<submissionid>`) by course staff only.

## Acceptance tests
- `task_showcase/archive_task`: after grading `submissions.archive` is set; the GridFS file is a tgz containing `report.txt` (student text) and `sub/nested.txt`.
- Export with `["taskid","username","submissionid"]` contains `archive_task/<user>/<id>/submission.test`, `…/archive/report.txt`, `…/archive/sub/nested.txt`.
- `file_upload` export contains `…/uploaded_files/upload.txt`.
