# Submission lifecycle hooks, LTI grade passback hook and crash recovery

- **ID**: TASK-25
- **Actors**: plugins, LTI platforms, system
- **Routes**: none (cross-cutting in the submission flow)
- **Depends on**: TASK-08, TASK-09, PLUGINS, LTI features
- **Legacy code**: `legacy/inginious/frontend/submission_manager.py:L39-L53,L97-L102,L122-L127,L465`, `pages/tasks.py:L344-L347,L370`, `templates/task.html:L174-L176`, `tasks.py:L172-L176`, `lti/` score publishers

## Use case
Extension points around the submission lifecycle used by plugins (scoreboard, contests, demo…) and
by LTI to send grades back to the LMS; recovery of jobs lost on restart.

## Main flow
| Hook / mechanism | When | Arguments → effect |
|---|---|---|
| `new_submission` | before insertion | `(submission=obj dict, inputdata)` — may add fields to the submission / input |
| `submission_done` | after completion update | `(submission, archive, newsub)` |
| `feedback_title` (recursive) | building check/reload JSON | `(task, submission, title)` → returns `{"title": …}` |
| `feedback_text` (recursive) | idem | `(task, submission, text)` → `{"text": …}` |
| `feedback_script` | idem | not supported: the page never executes server-provided scripts |
| `task_menu` | task page render | `(course, task)` → HTML entries in the left column |
| `task_context` | context render | `(task, default)` → first value replaces the context |
| `course_accessibility` | course open checks | used by plugins like contests |
| LTI | submit in an LTI session with `lti_send_back_grade` | `submission.lti_version` + outcome fields set at insertion (`tag_submission`), at completion `lti_score_publisher.add(submission)` queues the grade passback (LTI 1.1 outcome service / LTI 1.3 AGS) |
| Restart recovery | `WebAppSubmissionManager.__init__` | all `status:"waiting"` → `{status:"error", grade:0.0, text:"Internal error. Server restarted"}`, `jobid` unset (no `user_tasks` update, no try counted) |

## Data
LTI fields on submissions: `lti_version` ("1.1"/"1.3"), `outcome_service_url`, `outcome_result_id`, `outcome_consumer_key` (1.1), `message_launch_id` (1.3).

## Permissions & security
Hooks run server-side with full privileges; no hook output is executed as a script in the browser.

## Acceptance tests
- Starting the (new) frontend with waiting submissions in DB turns them into the restart error (if the rewrite keeps this behaviour; note the shared backend may still finish them — the legacy then overwrites the error with the real result through the callback only if the same process sent the job).
- A plugin registering `feedback_title` can change the title returned by `check`.
- LTI: covered by the LTI feature files.
