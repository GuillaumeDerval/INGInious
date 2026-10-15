# REST API v0: read own submissions

- **ID**: SITE-10
- **Actors**: API client (submission owner)
- **Routes**: GET /api/v0/courses/<courseid>/tasks/<taskid>/submissions[?input],
  GET /api/v0/courses/<courseid>/tasks/<taskid>/submissions/<submissionid>[?input]
- **Depends on**: SITE-06, SITE-07, SITE-11, SUBMISSION (storage, feedback rendering)
- **Legacy code**: `pages/api/submissions.py:L16-157` (`_get_submissions`, `APISubmissionSingle`, `APISubmissions.API_GET`),
  `submission_manager.py:L410-421` (`get_submission`), `L524-560` (`get_input_from_submission`, `get_feedback_from_submission`),
  `L587-597` (`user_is_submission_owner`, `get_user_submissions`)

## Use case
After submitting, a client polls the submission until `status` is `done`/`error` and reads grade and
feedback; it can also list its submission history and download the inputs.

## Main flow
App behaviour: as below; the single route only finds a submission of the caller for the
course and task of the URL (404 "Submission not found" otherwise, also for staff), and
`?input` file values are base64-encoded. Legacy details are kept for reference.

1. Course → 404 "Course not found"; `course_is_open_to_user(..., lti=False)` else 403
   "You are not registered to this course"; task → 404 "Task not found".
2. List route: `Submission.objects(username=<me>, taskid, courseid).order_by("-submitted_on")`
   (includes group submissions where the user is a member).
   Single route: `Submission.objects.get(id=submissionid)` then ownership check; also checks
   `submission.taskid/courseid` match the URL (else 404 "Submission not found").
3. For each submission: `get_feedback_from_submission(sub, show_everything = has_staff_rights_on_course)`
   (RST feedback → HTML, hides admin-only parts for students).
4. Item (verified):
   ```json
   {"id": "6acf13d4d379057911ec0795", "submitted_on": "2026-10-14T05:32:04.958000+00:00",
    "status": "done", "grade": 100.0, "result": "success", "feedback": "",
    "problems_feedback": {"q2": ["success", "<p>Correct answer</p>\n"]}}
   ```
   - `submitted_on`: ISO-8601 with microseconds and UTC offset;
   - `status`: `"waiting"`, `"done"` or `"error"`;
   - only when `status == "done"`: `grade` (float), `result` (`success|failed|timeout|overflow|killed|crash`),
     `feedback` (HTML of global feedback), `problems_feedback` (`{pid: [result, html]}` — a 2-element
     list, not a string as the docstring claims; MCQ problems may be absent);
   - with `?input` (any value, presence only): `input` = full stored input dict **including the
     `@username`, `@email`, `@lang`, `@time`, `@attempts`, `@random`, `@state` entries**, e.g.
     `{"q1": "0", "q2": "yes", "@username": "site_alice", "@email": "site_alice@x.org", "@lang": "en",
       "@time": "2026-10-14 05:32:04.958732+00:00", "@attempts": "2", "@random": [], "@state": ""}`.
5. 200 + JSON list (single route: list with one element).

## Alternative / error flows
- Submission belonging to another user (even when the caller is course staff or superadmin) →
  404 `{"error": "Submission not found"}` (legacy: `get_submission(..., as_username)` returns `None`
  and the page crashes with an HTTP 500 HTML page).
- Invalid ObjectId (`zzz`) or nonexistent id → 404 `{"error": "Submission not found"}`.
- Id of an own submission but with a different task in the URL → 404 "Submission not found".
- `?input` on a submission containing a **file** problem → **HTTP 500**: the base64 conversion loop
  iterates over the dict keys (strings) instead of the values, so `{"filename","value"}` dicts with
  `bytes` stay unencoded and `json.dumps` fails (verified). Intended behaviour: `value` base64-encoded.
- `status` `"error"` submissions have no grade/result fields.

## Data
Reads `submissions` (+ GridFS `input` file when `?input`), course/task descriptors. No writes.

## Permissions & security
- Owner-only: list and single routes only return submissions whose authors include the
  caller (staff can't use the API to read students' submissions).
- Anonymous and LTI sessions get 403.
- `?input` returns the stored e-mail of the user (own data only).

## Acceptance tests
- List returns own submissions newest first with the documented fields; `waiting` items have only id/submitted_on/status.
- `?input` returns inputs incl. `@` metadata; file inputs base64-encoded (legacy 500).
- Other user's submission id → 404 `{"error": "Submission not found"}` (legacy 500).
- Wrong task in URL → 404; invalid id → 404; outsider → 403; anonymous → 403.
