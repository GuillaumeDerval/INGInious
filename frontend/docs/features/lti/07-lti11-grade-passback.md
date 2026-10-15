# LTI 1.1 grade passback (LIS Basic Outcomes)

- **ID**: LTI-07
- **Actors**: system (background thread), LMS outcome service
- **Routes**: none inbound; outbound POST to `lis_outcome_service_url`
- **Depends on**: LTI-02 (outcome params), LTI-05 (submission tagging), submission grading (SUBMISSION area)
- **Legacy code**: `legacy/inginious/frontend/lti/__init__.py:17-94` (`LTIScorePublisher`),
  `legacy/inginious/frontend/lti/v1_1/__init__.py:15-42` (`LTIOutcomeManager`),
  `legacy/inginious/frontend/models/lti1_1.py:25-35` (`LISOutcome`),
  `legacy/inginious/frontend/submission_manager.py:96-127`,
  `legacy/inginious/frontend/app.py:169-172`, library `lti.OutcomeRequest`

## Use case
When "Send back grades" is enabled on an LTI course, each graded LTI submission updates
the student's grade in the LMS gradebook, reliably even if the LMS is temporarily down
(persistent queue with retries).

## Preconditions
- `course.lti_send_back_grade()` true at submission time, LTI 1.1 session with
  `outcome_service_url`, `outcome_result_id`, `consumer_key`.
- The consumer key still exists in `course.lti_keys()` when sending.

## Main flow
Behaviour of the app (`app/src/lib/server/lti/outcomes.ts`): same queue collection,
document shape and policy as legacy, with MongoDB as the queue. When a tagged submission
is done, every username of the submission is upserted into `lis_outcome_queue` with
`nb_attempt = 0`, then the queues are processed: for each entry the user-task grade is
read, `clip(grade/100, 0, 1)` is sent as a `replaceResult` request signed with the
consumer secret (OAuth body hash, HMAC-SHA1), and the entry is deleted on
`imsx_codeMajor == "success"`; otherwise `nb_attempt` is incremented and a new pass runs
~0.5 s later, the entry being dropped after 6 attempts. A failure while reading the grade
is a failed attempt; pending entries are processed when the server starts; every HTTP
call has a 10 s timeout.

Legacy mechanics (reference):
1. At submission creation the submission is tagged (`lti_version: "1.1"`,
   `outcome_service_url`, `outcome_result_id`, `outcome_consumer_key`) — LTI-05.
2. When the job result is stored (`_job_done_callback`, after `update_user_stats` and the
   `submission_done` hook; also for crashed/error submissions), if the submission has
   `lti_version` the matching publisher's `add(submission)` is called:
   - for **each** username of the submission (group members included), upsert into
     `lis_outcome_queue` the document identified by
     `{username, courseid, taskid, outcome_service_url, outcome_result_id,
     outcome_consumer_key}` with `nb_attempt = 0` (`modify(upsert=True, new=False)`);
   - only if the document did not exist before is it pushed to the in-memory queue
     (an already pending entry just gets its counter reset).
3. Publisher thread (one per frontend **process**, daemon, started at app creation; on
   start it loads *every* document of `lis_outcome_queue` into its queue), loop:
   1. `sleep(0.5)`, blocking `queue.get()`;
   2. `grade = user_manager.get_task_cache(username, courseid, taskid)["grade"]` — the
      cached grade of the user task (best or last submission per evaluation mode), in
      0–100;
   3. `process`: score = `clip(grade/100, 0, 1)`; secret =
      `Course.get(courseid).lti_keys()[outcome_consumer_key]`; send
      `OutcomeRequest.post_replace_result(score)` (XML and OAuth header in
      `docs/reference/lti.md` §2); success iff response `imsx_codeMajor == "success"`;
   4. success → delete the queue document, log DEBUG "Successfully sent grade to TC: …";
   5. failure (exception, HTTP error, unparsable XML, codeMajor ≠ success) → if
      `nb_attempt < 5`: `nb_attempt += 1`, save, re-queue at the end (DEBUG "An error
      occurred while sending a grade to the TC. Retrying..."); else delete and log ERROR
      "… Maximum number of retries reached.".
   So at most **6 attempts**, ~0.5 s apart when the queue is otherwise empty (verified:
   6 POSTs within ~2.5 s to a failing endpoint, then the entry is dropped).

## Alternative / error flows
- Legacy: an exception while reading the grade (e.g. no `user_tasks` document) stopped
  the publisher thread until the process restarted. App: counted as a failed attempt.
- Consumer key removed from the course → counted as a failed attempt.
- Legacy: with several frontend processes each one loaded all pending documents at start
  (possible duplicate sends), and entries added by one process were only processed by
  that process.
- Group submission: the queue documents of all group members carry the *submitter's*
  `outcome_result_id`, so the LMS grade of the submitter is overwritten successively by
  each member's grade (the last processed wins).
- Grade passback is attempted even for submissions that ended in error ("Environment not
  available.") — the grade sent is the user-task grade.
- Staff **replays** of a tagged submission (`replay_job`, same `_job_done_callback`) also
  enqueue a passback for the submission's users.

## UI elements
None (no feedback to the user about passback status).

## Data
- `lis_outcome_queue` documents:
  `{_id: ObjectId, courseid: str, taskid: str, username: str, nb_attempt: int,
  outcome_consumer_key: str, outcome_result_id: str, outcome_service_url: str}`.
- Reads `user_tasks.grade`, `course.yaml` `lti_keys`.
- Outbound HTTP (live capture):
  ```
  POST http://lti-mock:8000/outcome
  Content-type: application/xml
  Authorization: OAuth oauth_nonce="57339571041100469381791956257", oauth_timestamp="1791956257", oauth_version="1.0",
    oauth_signature_method="HMAC-SHA1", oauth_consumer_key="ltikey", oauth_body_hash="e0EDpzXCv4S8Khf%2Fhd2D28NYjLM%3D",
    oauth_signature="ckY%2BLeQ2%2FT04SW9Dv2mPvlIqiZs%3D"
  <?xml version='1.0' encoding='utf-8'?>
  <imsx_POXEnvelopeRequest xmlns="http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0">…<sourcedId>sourcedid-1</sourcedId>…<textString>0.0</textString>…
  ```

## Permissions & security
- The outcome URL is supplied by the LMS in the signed launch; INGInious POSTs to it
  server-side, with a 10 s timeout on every HTTP call.
- The `sourcedId` is XML-escaped in the request body; the score is clipped to [0, 1].
- The consumer secret is used to sign the outbound request.
- A failing LMS receives at most 6 requests per graded submission.

## Acceptance tests
- With passback on, a graded LTI 1.1 submission produces exactly one replaceResult POST
  with `textString = user_task.grade/100` (e.g. wrong answer → `0.0`, right → `1.0`),
  body hash and HMAC-SHA1 header verifiable with the consumer secret; the queue document
  is removed after `codeMajor=success`.
- Failing endpoint (HTTP 500 / codeMajor failure) → 6 attempts then removal; `nb_attempt`
  incremented in Mongo between attempts.
- Pending queue documents present at startup are processed.
- Evaluation mode "best": after a 100% then a 0% submission, the score sent the second
  time is still `1.0`.
- A missing user task is a failed attempt and does not stop the processing of the other
  entries; group members are queued with the submitter's outcome identifiers (legacy
  behaviour, kept).
- Passback off → no queue document, no HTTP call.
