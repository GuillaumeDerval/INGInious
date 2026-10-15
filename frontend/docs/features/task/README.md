# Area TASK — task page, problem types, submission lifecycle

| ID | Feature |
|---|---|
| TASK-01 | [Task page display](01-task-page.md) |
| TASK-02 | [Problem `code`](02-problem-code.md) |
| TASK-03 | [Problem `code_single_line`](03-problem-code-single-line.md) |
| TASK-04 | [Problem `file` + input download](04-problem-file.md) |
| TASK-05 | [Problem `multiple_choice`](05-problem-multiple-choice.md) |
| TASK-06 | [Problem `match`](06-problem-match.md) |
| TASK-07 | [MCQ grading (mcq agent)](07-mcq-grading.md) |
| TASK-08 | [Submit](08-submit.md) |
| TASK-09 | [Status polling and job completion](09-status-polling-and-job-completion.md) |
| TASK-10 | [History, evaluated submission, reload](10-submission-history-and-reload.md) |
| TASK-11 | [Kill a running submission](11-kill-submission.md) |
| TASK-12 | [SSH debug](12-ssh-debug.md) |
| TASK-13 | [Evaluation mode best/last](13-evaluation-mode.md) |
| TASK-14 | [Submission limits (tokens)](14-submission-limits.md) |
| TASK-15 | [Stored submissions limit](15-stored-submissions-limit.md) |
| TASK-16 | [Group submissions](16-group-submissions.md) |
| TASK-17 | [Random inputs](17-random-inputs.md) |
| TASK-18 | [Accessibility / deadlines](18-task-accessibility-and-deadlines.md) |
| TASK-19 | [RST rendering of statements and feedback](19-feedback-rendering-rst.md) |
| TASK-20 | [Tags on the task page](20-tags-on-task-page.md) |
| TASK-21 | [Debug information, stdout/stderr](21-debug-information.md) |
| TASK-22 | [Public task files](22-public-task-files.md) |
| TASK-23 | [Grading archive / submission export](23-grading-archive.md) |
| TASK-24 | [Replay](24-replay-submission.md) |
| TASK-25 | [Hooks, LTI passback hook, restart recovery](25-submission-hooks-lti-and-recovery.md) |

Reference: [`docs/reference/task-model.md`](../../reference/task-model.md) (every `task.yaml` key).

## Test fixtures (reused by the rewrite's test-suite)

Courses on disk: `infra/tasks/task_showcase/` and `infra/tasks/task_preview/` (previewable).

| Task (`task_showcase`) | Env | Purpose / correct answer |
|---|---|---|
| `mcq_single` | mcq | single MCQ, limit 3, shuffle, success/error messages, choice feedback — index `0` (Brussels) |
| `mcq_multiple` | mcq | multiple, unshuffle — `["0","1"]` |
| `mcq_centralize` | mcq | 3 problems centralized, partial grades — `q1=0, q2=[0,1], q3=4` |
| `match_answer` | mcq | match — `answer=42`, `city=Paris` |
| `legacy_env` | mcq (legacy `environment:`) | `legacy_q=0` |
| `code_python` | docker/default | code + tags/custom/state/stdout — `count_to(n)` returning `[1..n]` |
| `single_line` | docker | single-line + optional fields — `word=hello`, `number=7` |
| `file_upload` | docker | file `.txt/.py` ≤ 1 KiB (legacy: ≤ 991 bytes), first line `INGInious` |
| `random_inputs` | docker | `input_random: 2` — `int(r0*100)+int(r1*100)` |
| `random_regen` | docker | regenerate each load — `int(r0*1000)` |
| `rich_feedback` | docker | every RST construct in the feedback, problem feedback |
| `outcomes` | docker (time 2 s, 64 MiB) | mode `success/failed/partial/timeout/overflow/crash/sleep` |
| `archive_task` | docker | `/archive/report.txt`, `/archive/sub/nested.txt` |
| `limited_amount` / `limited_period` | mcq | limit 2 total / 1 per hour — `q=0` |
| `eval_last` | mcq | evaluation_mode last |
| `stored_two` | mcq | no_stored_submissions 2 |
| `group_task` | mcq | group_submission |
| `task_info` | mcq | author, contact_url, public files (`public/hello.txt`, `public/sub/data.json`, `public/pixel.svg`, `$common/public/common.txt`), JS `input` |
| `soft_deadline`, `closed_task`, `future_task`, `never_task` | mcq | accessibility variants |

Course tags: `skill_loop` (skill, visible), `skill_hidden` (skill, hidden), `misc_off_by_one`
(misconception, visible), `cat_basics` (category). Users (password `superadmin`):
`task_alice`, `task_bob` (both registered, group "Team A"), `task_carol` (registered, no group),
`task_dave` (not registered), `task_tutor` (tutor of `task_showcase`); `superadmin` is admin.
DB setup: `courses {_id:'task_showcase', students:[task_alice,task_bob,task_carol]}`,
`groups {courseid:'task_showcase', description:'Team A', size:2, students:[task_alice,task_bob], audiences:[]}`.

## Verification status (legacy exploration, 2026-10-14)
- Verified live: page rendering, all validation errors, submit JSON, Mongo/GridFS documents,
  MCQ end-to-end (`mcq_single`), file input download and its access rules, submission rules on
  preview courses, public files matrix, client-side validation messages, RST
  rendering (direct `ParsableText` call), MCQ grading of every showcase input (direct
  `MCQAgent.check_answer` call), every docker grading script (dry run in the `env-default` image).
- The shared backend container was unavailable during part of this exploration, so docker end-to-end runs
  (timeouts/overflow/kill/ssh/archive storage, limits/eval/group/stored end-to-end) are
  specified from the code + dry runs and must be re-checked against the legacy when the backend is up.
