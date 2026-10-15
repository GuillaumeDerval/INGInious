# Plugin "git_repo": archive every graded submission in a local git repository

- **ID**: SITE-19
- **Actors**: system (on submission completion); operator (reads the repository)
- **Routes**: none
- **Depends on**: SITE-12, SUBMISSION (hook `submission_done`)
- **Legacy code**: `plugins/git_repo/__init__.py:L1-111`, `submission_manager.py:L97` (hook call)

## Use case
Keep an auditable, versioned copy of all submissions (inputs, results, grading output files) in a
git repository on the server.

## Preconditions
```yaml
plugins:
  - plugin_module: inginious.frontend.plugins.git_repo
    repo_directory: ./repo_submissions     # default "./repo_submissions" (relative to the frontend CWD)
```
Requires the `git` binary. Legacy also required the Python `sh` module and a git identity
configured for the process user; the app runs git with its own identity
(`INGInious <inginious@localhost>`).

## Main flow
App behaviour (`app/src/lib/server/plugins/bundled/inginious.frontend.plugins.git_repo.ts`):
the flow below, with the hook bound to `submission_done`, the input read from GridFS,
`result.yaml` = `{result, text, problems}` from the stored submission fields, saves
serialised in a promise queue, and git run without a shell (`execFile`).

1. `init`: create `repo_directory` if missing and `git init` it (`--work-tree=<repo> --git-dir=<repo>/.git`),
   register hook `submission_done`, start a daemon thread consuming a queue (log "SubmissionGitSaver started").
2. On each finished submission (hook): enqueue `(submission, result, grade, problems, tests, custom, archive)`.
3. Thread `save`:
   - directory `<repo>/<courseid>/<taskid>/<user1-user2...>` (usernames joined with `-`) is **emptied
     and recreated** (only the latest submission per user/group and task is kept in the tree; history in git);
   - files: `submitted_on` (str of datetime), `input.yaml` (custom YAML dump of `submission["input"]`),
     `result.yaml` (`{result: result[0], text: result[1], problems: problems}`), and `output/` = extracted
     tar.gz archive returned by the grader (if any);
   - `git add --all .` then `git commit -m "<courseid>/<taskid> - <submission _id> - <user1-user2> - success|failed"`.

## Alternative / error flows — **the legacy plugin is broken** (not reproduced by the app)
- The hook is called as `call_hook("submission_done", submission=..., archive=..., newsub=...)` but the
  callback signature is `add(self, submission, archive, _)` → `TypeError: SubmissionGitSaver.add() got
  an unexpected keyword argument 'newsub'`, swallowed by the plugin manager (verified in logs of a
  dedicated frontend): **nothing is ever committed**.
- Even if fixed: `submission["result"]` is a string in the current model (not a tuple), so `result[0]`/`result[1]`
  would be the first two characters; `submission["input"]` is a GridFS reference, not the input dict.
- Exceptions while saving are logged ("Exception in JobSaver: ...") and the next saves continue.

## Data
Filesystem only (`repo_directory`). No DB writes.

## Permissions & security
- The grader-produced archive is extracted inside `output/` only: members with `..` segments or
  absolute paths are skipped, only regular files and folders are written (symbolic and hard
  link members are ignored), and existing symbolic links cannot be followed outside the
  target folder.
- The submission folder `<courseid>/<taskid>/<users>` is joined with the same path
  confinement (it cannot leave `repo_directory`).
- git is run without a shell, with fixed arguments.

## Acceptance tests
- After a graded submission, repository contains the 3 files + `output/`, one commit with the documented message; directory replaced on resubmission.
- Archive members escaping the directory and link members are not written.
- Legacy parity note: the legacy plugin produced no commits.
