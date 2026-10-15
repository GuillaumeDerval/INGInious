# Submission history, evaluated submission and reloading an old submission

- **ID**: TASK-10
- **Actors**: student (own submissions), tutor/admin (any submission of the course)
- **Routes**: `GET /course/<courseid>/<taskid>` (history list); `POST /course/<courseid>/<taskid>` with `@action=load_submission_input&submissionid=<id>`
- **Depends on**: TASK-01, TASK-09, TASK-13, TASK-20
- **Legacy code**: `legacy/inginious/frontend/pages/tasks.py:L122-L132,L259-L267,L275-L372`, `submission_manager.py:L410-L421,L587-L597`, `templates/task.html:L177-L237`, `static/js/task.js:L23-L32,L91-L193,L642-L746`

## Use case
Students review what they submitted before, reload the answers of an old submission into the
form (to fix and resubmit) and see its feedback again; they see which submission counts for the grade.

## Preconditions
Registered user (the history column is only rendered when `course_is_user_registered`; staff are considered registered).

## Main flow
1. **History list** (server render): `Submission.objects(username=<me>, taskid, courseid).order_by("-submitted_on")` — includes group submissions where the user is a member. Each `<li class="submission list-group-item list-group-item-action <cls>" data-submission-id="<id>">`:
   - class: `list-group-item-success` if `status == done` and `result == success`; `list-group-item-warning` if waiting; else `list-group-item-danger`;
   - optional tag badge `<span class="badge alert-info" id="tag_counter" title="<names of tags true>">N</span>` (only if the page has visible tags and N > 0);
   - `<span id="txt">` = `show_time(submitted_on)` + ` - <grade>% ` when `grade` exists (always, default 0.0).
   - Empty: `<li class="list-group-item list-group-item-action disabled submission-empty">No submission</li>`.
2. **Evaluated submission** box "For evaluation": label "Last submission" / "Best submission" and `#my_submission`: link `<date> - <grade>%` to `user_task.submissionid` or "No submission".
3. **Click** on a history item or on `#my_submission` (`clickOnSubmission`, ignored while loading): `loadOldSubmissionInput(id)` + `waitForSubmission(id)` (so the result card of that submission is displayed, TASK-09); closes the mobile sidebar.
4. `loadOldSubmissionInput(id)`: blur form, reset alerts, spinner card; POST `load_submission_input`.
5. Server: the submission must belong to the course and task of the URL and be owned by the user (any submission of the course for staff), else 404 JSON error; then `get_feedback_from_submission`; `submission_to_json(task, sub, is_admin, reloading=True)`: same JSON as TASK-09 but `status` forced to `"ok"`, `replace: false`, plus `"input"`: the full stored input dict (with `@`-metadata) where every file value is replaced by `""`. No queue/waiting branch when reloading (except the SSH branch if `ssh_host` is set).
6. Client: on `status == ok` and `input` → `updateMainTags(data)`, unblur, `load_input(id, input)` → `load_input_<type>(id, pid, input)` for each problem (code editors, text inputs, radios/checkboxes, file download link/PDF preview, match). Else "Internal error" danger card.
7. Page load with a waiting submission (`data-wait-submission`) automatically reloads its input and starts polling.

## Alternative / error flows
- Invalid / foreign submission id → 404 JSON error.
- Submission deleted by the stored-submissions limit (TASK-15): its `<li>` is removed client-side from `remove` ids.
- Submission of another task → 404 JSON error.

## UI elements
History list (scrollable `#submissions_restrictsize`), evaluated submission link, click-to-reload behaviour, loading spinner card, error card "Internal error".

## Data
- Response example (`load_submission_input`, verified):
```json
{"status":"ok","result":"crash","id":"6acf1563d379057911ec0838","submitted_on":"2026-10-14T05:38:43.757000+00:00",
 "grade":"0.0","replace":false,"text":"<p>Environment not available.</p>\n","problems":{},
 "title":"An internal error occurred. … [Submission #6acf… - <b><time datetime='…'>…</time></b>]",
 "input":{"upload":{"filename":"my report.txt","value":""},"@username":"task_carol","@email":"task_carol@x.org",
          "@lang":"en","@time":"2026-10-14 05:38:43.757776+00:00","@attempts":"2","@random":[],"@state":""},
 "tests":{}}
```

## Permissions & security
- Only the submission's owner(s) and the staff of its course can load it, through a task page of the same course and task.

## Acceptance tests
- After 3 submissions the history shows 3 items newest first with correct colours and "<date> - <grade>%".
- Clicking an older item restores its answers into all problem widgets and shows its result card.
- `#my_submission` shows the evaluated submission (best/last, TASK-13) and is replaced (fade) when a new submission becomes the evaluated one.
- Student loading a foreign id gets an error; tutor of course A loading a submission of course B gets an error.
- File submissions: reload shows the download button, not the file content.
