# Combinatory test task dispenser (random task draw per student)

- **ID**: NAV-13
- **Actors**: student (sees own draw), staff (also get a draw on the course page), course admin (configures)
- **Routes**: rendered in GET /course/<courseid>; also affects task visibility/submission, grades, upcoming tasks, statistics
- **Depends on**: NAV-10 (same renderer), NAV-11, NAV-14, course admin task-list editor (configuration UI)
- **Legacy code**: `legacy/inginious/frontend/task_dispensers/combinatory_test.py:L15-L74`, `app.py:L160-L161` (registration of dispensers)

## Use case
A teacher builds an exam/quiz where each student receives a random but stable subset of the
tasks of each pool (section), to limit cheating.

## Preconditions
`task_dispenser: combinatory_test` in `course.yaml`; each top-level section has `config.amount` (int, default 0).

## Main flow
1. Structure identical to `toc` (subclass of TableOfContents); section config field `amount` ("Amount of tasks to be displayed", number, default 0) replaces `closed`/`hidden_if_empty` in the editor (the renderer still honours `closed`/`hidden_if_empty` if present).
2. `get_accessibilities(taskids, usernames)`:
   - start with `AccessibleTime(False)` for every task;
   - for each **top-level** section at index `i` with title `T`: candidates = `section.get_tasks()` (recursive) whose configured accessibility `after_start()`; `rand = random.Random(f"{username}#{i}#{T}")`; shuffle a copy of the candidates; the first `amount` get their configured accessibility.
3. Consequences: non-drawn tasks are invisible, not submittable, not counted in the grade; the draw is deterministic per (username, section index, section title) — renaming/reordering sections changes all draws; adding a task to a pool changes the draw.
4. `get_group_submission()` always false (no group submissions); config items exclude `group_submission`.
5. Rendering identical to toc (NAV-10).
6. `check_dispenser_data` additionally casts every section `config.amount` to `int` (error string on failure).

## Alternative / error flows
- `amount` larger than the pool → all candidates drawn. `amount` 0/missing → nothing visible.
- Candidates not yet started are excluded **before** shuffling, so the draw changes when a task's start date passes.

## Data
`course.yaml` `task_dispenser`, `dispenser_data.toc[i].config.amount`, `dispenser_data.config`.

## Permissions & security
Draws are deterministic per (username, section index, section title). The rewrite **must** reproduce CPython's `random.Random(str_seed).shuffle()` exactly (MT19937, seed = int from `str.encode() + sha512(str).digest()`, `shuffle` via `_randbelow(i+1)` using `getrandbits`) to keep existing students' draws stable.

## Acceptance tests (course navcombi: Pool A = c1..c4 amount 2, Pool B = c5, c6 amount 1, c6 weight 4)
- nav_alice sees Pool A {Combi 3, Combi 4} and Pool B {Combi 6}; nav_bob {Combi 1, Combi 3} / {Combi 6}; nav_carol {Combi 1, Combi 2} / {Combi 6}; superadmin {Combi 1, Combi 2} / {Combi 5}. Items appear in toc order, not draw order.
- Python reference: `Random("nav_alice#0#Pool A").shuffle(["c1","c2","c3","c4"])` → first two `c4, c3`.
- nav_alice opening /course/navcombi/c1 (not drawn) → "Error 403 Task unavailable" page (task page feature).
- Grade denominator for nav_alice = 1 + 1 + 4 = 6.
