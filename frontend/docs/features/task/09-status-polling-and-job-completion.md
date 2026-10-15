# Waiting for the result (status polling) and job completion

- **ID**: TASK-09
- **Actors**: student/staff (browser polling), backend (job result)
- **Routes**: `POST /course/<courseid>/<taskid>` with `@action=check&submissionid=<id>` (form-urlencoded, `jQuery.post`, every 1 s)
- **Depends on**: TASK-08, TASK-13 (evaluation mode), TASK-19 (feedback), TASK-20 (tags), TASK-21 (debug), TASK-12 (ssh)
- **Legacy code**: `legacy/inginious/frontend/pages/tasks.py:L230-L257,L275-L390`, `submission_manager.py:L50-L102,L540-L568,L818-L825`, `user_manager.py:L520-L552` (`update_user_stats`), `client/client.py:L215-L246`, `static/js/task.js:L91-L183,L332-L398,L440-L460,L524-L566,L584-L640`

## Use case
After submitting (or when opening a page with a waiting submission) the browser polls until the
grading is finished, then shows the global feedback, per-problem feedback, grade, tags, updates
the history list, the status/grade cells and the evaluated submission.

## Preconditions
A submission id of this task that the user owns (or any submission of the course for its staff).

## Main flow
### A. Job completion (server side, asynchronous)
1. Backend sends `BackendJobDone(job_id, result=(result_str, text), grade, problems, tests, custom, state, archive, stdout, stderr)`; the client first calls `ssh_callback(None…)` (no-op once), then `_job_done_callback`.
2. If `archive` (bytes, tgz) → stored in GridFS, `submissions.archive = <id>` (TASK-23).
3. `findAndModify` the submission with `$set`: `status = "done"` if result ∈ {success, failed} else `"error"`; `result`, `grade`, `text`, `tests`, `problems`, `custom`, `state`, `stdout`, `stderr`; `$unset`: `jobid`, `ssh_host`, `ssh_port`, `ssh_user`, `ssh_password`.
4. For **each** username of the submission → `update_user_stats(username, task, submission, result, grade, state, newsub=True, dispenser)`:
   - `user_saw_task` upsert;
   - `user_tasks` `findAndModify $inc {tried: 1, "tokens.amount": 1}` (new=True);
   - if `evaluation_mode == "last"` or (`"best"` and `old.grade <= grade`) → set `succeeded = (result == "success")`, `grade`, `state`, `submissionid` and save. (Ties in best mode: the newer submission wins.)
5. `DocumentTooLarge` (feedback > 16 MB) → submission set to `status:"error"`, `text:"Maximum submission size exceeded. Check feedback, stdout, stderr and state."`, `grade:0.0` (**user_tasks not updated**).
6. Hook `submission_done(submission, archive, newsub)`; LTI: if `submission.lti_version` → `lti_score_publisher.add(submission)` (grade sent back to the LMS).
7. At frontend start-up every `waiting` submission is set to `{status:"error", grade:0.0, text:"Internal error. Server restarted"}` and `jobid` unset (`WebAppSubmissionManager.__init__`).

### B. Polling (`@action=check`)
1. `get_submission(id, as_username = username unless staff)`; `None` (not accessible) or invalid/unknown id → `{"status":"error","title":"Error","text":"Internal error"}`.
2. Status `done`/`error`: `get_feedback_from_submission(sub, show_everything=is_staff)` (RST → HTML for `text` and every `problems[pid][1]`, TASK-19); `user_task` of the first member found; `replace = (user_task.submissionid == submission.id)`; JSON via `submission_to_json(task, sub, debug=is_admin, reloading=False, replace, tags)`.
3. Status `waiting`: `submission_to_json` returns
   - SSH info if `ssh_host` present (TASK-12): `{"status":"waiting","text":"<b>SSH server active</b>","ssh_host","ssh_port","ssh_user","ssh_password"}`;
   - else queue info `client.get_job_queue_info(jobid)` → `(nb_before, approx_wait)`: text
     - `nb_before == -1` and wait ≤ 0: "<b>INGInious is currently grading your answers.</b> (almost done)"
     - `-1`: "<b>INGInious is currently grading your answers.</b> (Approx. wait time: {s} seconds)"
     - `0`: "<b>You are next in the waiting queue!</b>"
     - `1`: "<b>There is one task in front of you in the waiting queue.</b>"
     - else "<b>There are {n} tasks in front of you in the waiting queue.</b>"
     → `{"status":"waiting","text":…}`;
   - no queue info yet → the generic JSON below with `status:"waiting"` and title "<b>Your submission has been sent...</b>".
4. Generic JSON (`submission_to_json`):
   ```json
   {"status": "done|error|waiting", "result": "success|failed|timeout|overflow|killed|crash|error…",
    "id": "<id>", "submitted_on": "<ISO with tz>", "grade": "<str(float)> e.g. '37.5'",
    "replace": true|false, "text": "<html>", "problems": {"<pid>": ["<result>", "<html>"]},
    "title": "<html>", "tests": {"<tagid>": true, "*auto-tag-…": "…"},
    "debug": {...admins only...}}
   ```
   Titles: failed → "There are some errors in your answer. Your score is {grade}%."; success → "Your answer passed the tests! Your score is {grade}%."; timeout → "Your submission timed out. Your score is {grade}%."; overflow → "Your submission made an overflow. Your score is {grade}%."; killed → "Your submission was killed."; anything else (crash, error) → "An internal error occurred. Please retry later. If the error persists, send an email to the course administrator."; then always appended " [Submission #<id> - <b><time datetime='<iso>'><iso></time></b>]". Plugin hooks `feedback_title` and `feedback_text` (recursive) may rewrite title/text. `tests` filtering: TASK-20. `debug`: TASK-21.
5. Client (`waitForSubmission`): `waiting` → show SSH box or loading card with text + kill button; poll again after 1000 ms. Otherwise if `status`, `result`, `grade` present: `updateMainTags`, `displayDebugInfo` (admins), result card: failed/error/crash → `danger`, success → `success`, timeout/overflow/killed → `warning` (`displayTaskStudentAlertWithProblems`: card header = title, body = text, then `load_feedback_<type>(pid, problems[pid])` for each problem of the page, then code colouring, MathJax typeset, `<time>` elements reformatted with the browser locale `dtf`); `updateSubmission(id, result, grade, tests)` (history item class success/danger, text "<date> - <grade>%", tag badge); unblur; if `replace` → `displayEvaluatedSubmission(id, fade)` else refresh the current evaluated one.
   Any other answer (error JSON) → danger card, history item set to error "0.0%", status "Failed". AJAX failure → same (JS bug: references an undefined `data`).
6. `displayEvaluatedSubmission`: replaces `#my_submission` with a link `<a id="my_submission" class="submission list-group-item … list-group-item-info" data-submission-id>` + the history item text; status cell "Succeeded"/"Failed" (English, untranslated) from the history item class; grade parsed from the item text.

## Alternative / error flows
- Results produced by the docker agent: `success`, `failed`, `timeout`, `overflow`, `crash`, `killed`; backend/client failures: `("crash","Backend unavailable, retry later")`, `("crash","Environment not available.")`, `("crash","SSH callback not set.")`; container with no feedback: `("crash","No feedback was given !")`.
- `status` is `done` only for success/failed; all other results ⇒ `status:"error"` (still counted as a try, grade usually 0).
- `grade` is **not clamped** (container API `set_grade` = `float(grade)`, docker agent copies it; default 100.0 for success / 0.0 otherwise when not set); MCQ grades may have many decimals (66.66666666666667). Killed/timeout/overflow jobs keep the previous `@state` as state.
- `user_task.submissionid` is None while the submission is done → "Internal error" JSON (should not happen).

## UI elements
Result card (`getAlertCode`): `<div class="card border-<type> mb-3" role="card">` + header `bg-<type> text-white` with dismiss button (`data-dismiss="card"` handled by a delegated click that removes the card); per-problem cards without title use a left coloured column with ✓ / × / ?.

## Data
- Reads `submissions`, `user_tasks`; writes `submissions` (completion) and `user_tasks` (`tried`, `tokens.amount`, `grade`, `succeeded`, `state`, `submissionid`).
- Example completed docker submission (`code_python`, admin): `status:'done', result:'failed', grade:25, text:'1/4 tests passed.', problems:{code:['failed','* ``count_to(0)``: OK\n…']}, tests:{skill_loop:…, misc_off_by_one:…, '*auto-tag-<hash>':'auto tag: 1 tests passed'}, custom:{passed:1}, state:'1', stdout:'test 0 True\n…', stderr:'this goes to stderr\n', archive:ObjectId`.

## Permissions & security
- Access: `username in submission.username`, or staff of the submission's course; the submission must belong to the course and task of the URL.
- Feedback HTML from grading scripts is sanitized before display; no server-provided script is executed in the browser.
- Hidden-until content is revealed to staff only (`show_everything=is_staff`).
- `debug` (whole submission document, strings cut at 1000 chars) only for course admins.

## Acceptance tests
- `outcomes` with mode `success|failed|partial|timeout|overflow|crash` produce respectively: done/success/100, done/failed/0, done/failed/37.5, error/timeout, error/overflow, error/crash ("No feedback was given !" or the container message), each with the exact title strings above.
- During grading, `check` returns `{"status":"waiting","text":…}` with one of the queue messages.
- Best mode: submitting 25% then 100% then 50% leaves `user_tasks.grade=100`, `submissionid`=the 100% one, `replace` false for the 50% one; `tried=3`, `tokens.amount=3`.
- Polling someone else's submission as a student → `{"status":"error","title":"Error","text":"Internal error"}`.
- Restarting the frontend with a waiting submission turns it into `error` "Internal error. Server restarted".
- A feedback larger than 16 MB → "Maximum submission size exceeded…".
