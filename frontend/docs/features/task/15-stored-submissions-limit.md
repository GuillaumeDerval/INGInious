# Limit on the number of stored submissions

- **ID**: TASK-15
- **Actors**: course admin (configures), student (affected)
- **Routes**: applied during `POST /course/<courseid>/<taskid>` `@action=submit`
- **Depends on**: TASK-08, TASK-10, TASK-13
- **Legacy code**: `legacy/inginious/frontend/submission_manager.py:L137-L147,L491-L522`, `task_dispensers/util.py:L84-L106`, `static/js/task.js:L116-L125,L309-L313`

## Use case
Keep the database small: only the last N submissions of each student for a task are kept
(the evaluated one is always kept).

## Preconditions
`course.yaml → dispenser_data.config.<taskid>.no_stored_submissions = N` (int ≥ 0; 0 = unlimited, default).

## Main flow
1. Right after inserting the new (waiting) submission, `_delete_exceeding_submissions(username, course, task, dispenser)`:
   1. `N <= 0` → nothing.
   2. List the user's submissions for the task (`username` contains the **submitting** user only), newest first.
   3. `to_keep` = {`user_tasks.submissionid` (evaluated)} ∪ {all `waiting` ones (incl. the new one)}; then fill with the most recent until `len(to_keep) == N`.
   4. Delete the others (`Submission.objects(id__in=…).delete()`) — **the GridFS input/archive files are not deleted** (mongoengine `FileField` is not cascaded): orphan `fs.files`/`fs.chunks` remain.
2. The deleted ids are returned in the submit response `remove` and the browser removes the matching `<li>` from the history.

## Alternative / error flows
- Group submissions: only the submitter's list is pruned (the query uses `username=<submitter>`; group submissions of the submitter are included since `username` is an array).
- Because the evaluated submission is always kept, with N=1 the list may contain 2 submissions (evaluated + new).

## UI elements
History items disappear after submitting.

## Data
`submissions` documents deleted; legacy left their GridFS files orphaned, the app deletes the input and archive files too.

## Permissions & security
Data loss is intended; admins should know that old submissions (and their feedback) are not recoverable.

## Acceptance tests
- `task_showcase/stored_two` (N = 2): submit Yes (100), No, No → after the 3rd submit the response `remove` contains the 2nd submission id (the evaluated 100% and the newest are kept); DB has exactly 2 submissions for the user.
- Default tasks keep everything.
- (Rewrite) decide whether to also delete GridFS files (legacy leaves them).
