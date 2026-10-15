# Scale and performance suite

The frontend must stay fast on large installations: thousands of courses, thousands of
tasks per course, tens of thousands of students, 100,000 submissions on a single task and
submissions with several megabytes of feedback. `npm run test:perf` (in `app/`) measures
it on a generated data set, against budgets, and keeps the measurements as regression
guards. It is not part of `npm test`.

## Running it

```sh
cd app
npm run test:perf                                  # every scenario
PERF_ID=me npm run test:perf -- -g "course|task"   # a subset, in an isolated run
```

- The production build is started on its own port with its own database
  (`INGInious_perf`) and tasks directory (`perf/.data/tasks`); nothing is shared with
  the development server or the integration tests.
- The data set is generated once by `perf/seed.ts` (a few seconds) and reused while
  `SCALE` (perf/setup-data.ts) is unchanged; delete `perf/.data` to force it.
- Runs with different `PERF_ID`s can execute in parallel (own port, build and results).
- Results: `perf/results/<PERF_ID>.jsonl` (one measurement per line) and
  `perf/results/<PERF_ID>.md` (table).

## Data set

| Item | Size |
|---|---|
| Courses | 2,000 small courses (5 tasks, 2 of them with a deadline next month) + the big course |
| Big course | 5,000 tasks in 10 chapters × 5 parts, 20,000 registered students, 500 audiences, 2,000 groups |
| Main student | registered in 200 small courses and in the big course |
| Submissions | 100,000 on the big course's first task, 10,000 by the main student on its second task |
| Large feedback | three submissions with 1, 5 and 15 MB of RST feedback (MongoDB caps documents at 16 MB) |
| Grading status | `user_tasks` for 10 tasks × 20,000 students |

Documents follow the legacy schema exactly (docs/reference/db-schema.md).

## Measurements and budgets

For every page: the server time of a first (cold) request and the median of three more
(warm), the size of the HTML; in Chromium after hydration: DOM nodes, largest contentful
paint, time to hydration (`inginious:hydrated` mark of the root layout) and total
blocking time (long tasks beyond 50 ms). Downloads (CSV exports) are timed to their end.

| Budget | Value |
|---|---|
| Server time (warm median) | ≤ 500 ms |
| HTML size | ≤ 500 KB |
| DOM nodes | ≤ 5,000 |
| Total blocking time | ≤ 300 ms |
| Largest contentful paint | ≤ 2.5 s |
| Download (CSV) | ≤ 30 s |

Assertions are soft: every scenario is measured even when one budget is exceeded.

**Pages that cannot meet the budget load their data asynchronously.** When some data
cannot be computed within the budget, the load function returns it as an unawaited promise
(SvelteKit streaming): the page is sent at once and shows a spinner (`ui/Loading.svelte`)
in the section until the data arrives. The server budget then applies to the first byte;
the complete response time is reported too. Today this concerns the "Student progress"
statistics tab, which aggregates the grading status of every student at each request.

## First measurements (before the scale fixes, 2026-10-14)

| Scenario | Server (warm) | HTML | DOM nodes |
|---|---:|---:|---:|
| Course list (2,001 courses) | 232 ms | 3.7 MB | 30,208 |
| My courses (201 courses) | 763 ms | 684 KB | 5,237 |
| Upcoming tasks (200 courses) | 1,092 ms | 688 KB | 5,990 |
| Course page (5,000 tasks) | 905 ms | 6.9 MB | 50,612 |
| Task page, 10,000 own submissions | 974 ms | 11.6 MB | 90,285 |
| Task page, task with 100,000 submissions | 243 ms | 34 KB | 321 |
| Task page / submission, 15 MB feedback | 128–401 ms | 32–62 KB | ~350 |
| Task list editor (5,000 tasks) | 816 ms | 1.3 MB | 7,745 |
| Students / audiences / groups (20,000 students) | > 5 min | | |
| One student's page | 996 ms (104 s cold) | 9.3 MB | 95,348 |
| Submissions browser (110,000) | 1,393 ms | 7.3 MB | 78,727 |
| Course statistics | 58 s | 9.8 MB | 113,281 |
| Users administration (20,002 users) | 16 ms | 37 KB | 386 |
| CSV: submissions / students / progress | 2.4 s / 87 s / 54 s | | |

Two causes dominated: per-student loops over every grading status (quadratic in the
number of students), and lists rendered entirely (courses, tasks, submissions, history).

## How the student lists, course pages and submissions scale

| Page | Strategy |
|---|---|
| Course list, My courses | server-side search (`?q=`, name or id), filter chips (`?filter=`) and pagination (`?page=`, 24 cards); descriptions rendered and progress computed for the page only, with one `user_tasks` query |
| Upcoming tasks | one `user_tasks` query for every course, paginated by 50 tasks |
| Course page | per-section counts per category; the first 150 tasks of open sections are sent, the other sections come closed and load on opening (`GET /course/<id>/$section?path=`) |
| Task page | latest 20 submissions (projection) and their count; older pages through the `history` JSON action (cursor: date + id) |
| Submissions browser | choice lists over 100 entries (students, tasks, audiences) become server-searched pickers; evaluation flags read for the rows of the page |
| Task list editor | sections folded beyond 200 tasks; the JSON of the structure is built on submit |
| Course and task loading | listings skip the `safeJoin` path checks of their own (real, valid) sub-folders; "last tried" sorts projected submissions |

## After the scale fixes (2026-10-15)

Full run (`npm run test:perf`): 22 scenarios, all within budget. Same data set as above.
Times are to the first byte; "Complete" includes streamed data.

| Scenario | First byte (cold) | First byte (warm) | Complete (warm) | HTML | DOM nodes | LCP | Blocking |
|---|---:|---:|---:|---:|---:|---:|---:|
| Course list (2,001 courses), anonymous | 1,330 ms | 20 ms | 20 ms | 68 KB | 565 | 152 ms | 0 ms |
| Course list, student | 43 ms | 33 ms | 33 ms | 65 KB | 534 | 128 ms | 0 ms |
| My courses (201 courses) | 227 ms | 71 ms | 71 ms | 104 KB | 822 | 164 ms | 1 ms |
| Upcoming tasks (200 courses) | 212 ms | 87 ms | 87 ms | 106 KB | 924 | 196 ms | 0 ms |
| Course page (5,000 tasks) | 161 ms | 72 ms | 72 ms | 243 KB | 1,712 | 192 ms | 0 ms |
| Task page, task with 100,000 submissions | 126 ms | 72 ms | 72 ms | 34 KB | 323 | 168 ms | 0 ms |
| Task page, 10,000 own submissions | 76 ms | 74 ms | 74 ms | 53 KB | 471 | 176 ms | 21 ms |
| Task page, 15 MB feedback | 168 ms | 72 ms | 72 ms | 33 KB | 314 | 168 ms | 0 ms |
| Submission, 15 MB feedback | 196 ms | 123 ms | 123 ms | 63 KB | 369 | 224 ms | 0 ms |
| Task list editor (5,000 tasks) | 1,891 ms | 101 ms | 103 ms | 408 KB | 596 | 212 ms | 14 ms |
| Course settings | 19 ms | 11 ms | 11 ms | 42 KB | 420 | 104 ms | 0 ms |
| Students (20,000) | 274 ms | 135 ms | 135 ms | 171 KB | 1,782 | 248 ms | 0 ms |
| Audiences (500) | 94 ms | 68 ms | 68 ms | 123 KB | 852 | 164 ms | 0 ms |
| Groups (2,000) | 53 ms | 38 ms | 38 ms | 161 KB | 1,108 | 144 ms | 0 ms |
| One student | 35 ms | 28 ms | 28 ms | 132 KB | 1,316 | 132 ms | 0 ms |
| Submissions browser (110,000) | 553 ms | 248 ms | 248 ms | 231 KB | 2,234 | 376 ms | 2 ms |
| Course statistics | 123 ms | 96 ms | 96 ms | 64 KB | 545 | 188 ms | 6 ms |
| Student progress (20,000 students, streamed) | 25 ms | 5 ms | 471 ms | 37 KB | 691 | 128 ms | 0 ms |
| Users administration (20,002 users) | 22 ms | 13 ms | 13 ms | 37 KB | 388 | 104 ms | 0 ms |
| CSV: submissions (11 MB) / students / progress | 1.9 s / 2.2 s / 1.0 s | | | | | | |

Cold times include the first parse of thousands of course/task descriptors (cached by file
modification time afterwards).

| Scenario | Before (warm, HTML) | After (warm, HTML) |
|---|---|---|
| Course list | 232 ms, 3.7 MB | 20 ms, 68 KB |
| Course page (5,000 tasks) | 905 ms, 6.9 MB | 72 ms, 243 KB |
| Task page, 10,000 own submissions | 974 ms, 11.6 MB | 74 ms, 53 KB |
| Students (20,000) | > 5 min | 135 ms, 171 KB |
| One student | 104 s cold, 9.3 MB | 28 ms, 132 KB |
| Submissions browser | 1,393 ms, 7.3 MB | 248 ms, 231 KB |
| Course statistics | 58 s, 9.8 MB | 96 ms, 64 KB |
| Students / progress CSV | 87 s / 54 s | 2.2 s / 1.0 s |

