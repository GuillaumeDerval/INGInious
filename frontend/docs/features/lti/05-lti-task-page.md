# LTI task page (display, auto-registration, submission)

- **ID**: LTI-05
- **Actors**: LTI user (logged in through LTI-04)
- **Routes**: GET|POST /lti/task?session_id=…, GET|POST /lti1.3/task?session_id=…
- **Depends on**: LTI-03, LTI-04, task page & submission features (TASK area), LTI-07 / LTI-12 (grade tagging), LTI-06 (assets)
- **Legacy code**: `legacy/inginious/frontend/pages/lti/v1_1/__init__.py:91-106` (`LTI11TaskPage`),
  `legacy/inginious/frontend/pages/lti/v1_3/__init__.py:24-51` (`LTI13TaskPage`),
  `legacy/inginious/frontend/pages/tasks.py:44-200` (`BaseTaskPage.GET/POST` with `is_LTI=True`),
  `legacy/inginious/frontend/user_manager.py:554-600,640-671,692-739`,
  `legacy/inginious/frontend/submission_manager.py:104-127`,
  `templates/task.html:27,127,152,274,349-353`

## Use case
Inside the LMS iframe, the student sees the single task the LMS activity points to,
submits answers and gets feedback exactly as on the normal task page, but without the
INGInious navigation. The submission is tagged so that its grade can be pushed back to
the LMS.

## Preconditions
- LTI session with `session.lti.task = [courseid, taskid]` and `session.loggedin` (else
  the user is sent to the binding step — see LTI-04 alternative flow).
- LTI 1.3 only: `course.lti_secrets()[session.lti.platform_instance_id] == session.lti.course_secret`.

## Main flow
Behaviour of the app (`app/src/lib/server/lti/pages.ts`, guard `requireLtiTask`, then the
normal task page domain); legacy differences are noted at the end of the section.
1. No LTI data in the session → 403 "No LTI data available.".
2. Course of `session.lti.task` not found → 404.
3. LTI 1.3 sessions, on every LTI page and action (task page, actions, assets, best
   submission): the course must have a deployment secret for
   `session.lti.platform_instance_id` equal to `session.lti.course_secret`; otherwise
   (including no secret configured) → 403 "Invalid LTI secret".
4. Not logged in → 302 to the LTI login step (LTI-04).
5. Course not LTI → 403 "This course must be accessed on an external platform…" (a non-LTI
   course **cannot** be used through LTI, and nobody is registered into it).
6. **Auto-registration**: if the user is not registered to the course, they are registered
   (forced, although LTI courses have registration closed).
7. GET → normal task page data of `session.lti.task`: task not found → 404; task not
   visible to the user → "Task unavailable". Rendered as the student view (no deadline
   row, no staff administration box, no "Submitting as" box, no navigation buttons); form
   `action = /lti[1.3]/task?session_id=<token>` (the LTI path of the session). The sidebar
   still shows Information (author, status, grade, attempts, submission limit), "For
   evaluation" and "Submission history". Task context links/images rewritten to
   `/lti/asset/…?session_id=` (LTI-06).
8. POST (JSON actions `submit`, `check`, `kill`, `load`) → identical to the normal task
   page, with the LTI flag in the open/submit checks.
9. **Submission tagging**: if `course.lti_send_back_grade()`, the new submission document
   gets `lti_version = session.lti.version` and:
   - 1.1: `outcome_service_url`, `outcome_result_id`, `outcome_consumer_key`
     (= `session.lti.consumer_key`);
   - 1.3: `message_launch_id`.
10. When the job finishes, tagged submissions are queued for grade passback (LTI-07 /
    LTI-12).

Legacy differences (functional): legacy rendered the course-unavailable page with HTTP 200
(and, for the `lti_only` case, the message "You are not registered to this course."),
always posted the task form to `/lti/task` (also for LTI 1.3), and logged "<key> is None,
but grade needs to be sent back to LTI platform! Ignoring." when an outcome value was
missing.

## Alternative / error flows
- Not logged in → the login/binding step (LTI-04).
- Tutors/admins launching through LTI see the student view (no admin box), but staff
  rights still apply to visibility checks.
- Group tasks: the submission is made for the whole group (normal behaviour); every
  member's grade is pushed back using the **submitter's** LTI outcome identifiers
  (LTI-07).

## UI elements
Same as the normal task page minus the elements listed in step 7; LTI layout (LTI-03).

## Data
- Reads `sessions.lti`, `course.yaml`, task files, `user_tasks`, `submissions`.
- Writes `courses` (`{_id: courseid, students: [...]}` push on auto-registration),
  `user_tasks` (random inputs, seen), `submissions` with LTI tags, e.g. (live):
  ```js
  { courseid: 'lti_test', taskid: 'mcq1', username: ['lti_student'], status: 'done', grade: 0,
    lti_version: '1.1', outcome_service_url: 'http://lti-mock:8000/outcome',
    outcome_result_id: 'sourcedid-1', outcome_consumer_key: 'ltikey', ... }
  { courseid: 'lti_test', taskid: 'mcq2', grade: 100, lti_version: '1.3',
    message_launch_id: 'lti1p3-launch-6137c291-25cc-41fb-a6ce-b0898450e4db', ... }
  ```

## Permissions & security
- The deployment secret of an LTI 1.3 session is checked (constant-time comparison) on
  every request of that session to the task page, its actions, the assets and the best
  submission endpoint.
- The task pages trust `session.lti.task` (set by a signed launch).
- Users are registered on first view to LTI courses only; an LTI session never registers a
  user to a non-LTI course.
- Submissions are protected like on the normal task page.

## Acceptance tests
- Bound LTI user: GET `/lti/task?session_id` renders the task named in the launch with
  LTI layout and form action `/lti/task?session_id=…`; user is added to
  `courses.students`.
- Non-LTI course reached through an LTI session → 403 and the user is not added to
  `courses.students`.
- Hidden task → "Task unavailable".
- Submitting through the LTI page with passback on stores `lti_version` +
  version-specific fields; with passback off stores none of them.
- LTI 1.3 with wrong/missing secret → 403 "Invalid LTI secret" on `/lti1.3/task`, on
  `/lti/task` and for submissions of that session.
- Not logged in → login/binding step (LTI-04).
