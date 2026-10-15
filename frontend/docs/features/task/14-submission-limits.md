# Submission limits (tokens)

- **ID**: TASK-14
- **Actors**: course admin (configures), student / group (limited); staff are never limited
- **Routes**: checked in `GET`/`POST /course/<courseid>/<taskid>`
- **Depends on**: TASK-08, TASK-09, TASK-16
- **Legacy code**: `legacy/inginious/frontend/task_dispensers/util.py:L155-L179`, `models/user_task.py:L12-L44` (`Tokens`, `check_tokens`), `user_manager.py:L571-L607`, `templates/task.html:L81-L95,L384-L416`

## Use case
Limit the number of submissions (globally or per time window) to discourage trial-and-error.

## Preconditions
`course.yaml → dispenser_data.config.<taskid>.submission_limit = {amount: int, period: int}`:
- `{amount: -1, period: -1}` (default) = no limit;
- `{amount: N, period: -1}` = N submissions in total;
- `{amount: N, period: H}` = N submissions per window of H **hours**;
- validation: ints, ≥ -1, `amount = -1` with `period ≠ -1` rejected.

## Main flow
1. `user_tasks.tokens = {amount: int (default 0), date: Date (default epoch)}` (embedded; `date` often absent in DB until the first reset).
2. Each **completed** new submission increments `tokens.amount` (TASK-09) — tokens are consumed at completion, not at submission time; crashes/timeouts also consume tokens. (The app consumes the token when the submission is created; crashes/timeouts still count.)
3. `task_can_user_submit(..., only_check='tokens')`: for every member (group task) or the user: `check_tokens(limit)`:
   - `ok = tokens.amount < limit.amount`;
   - if `period > 0` and `tokens.date < now - period hours` → `reset_tokens()` (`amount = 0`, `date = now`, saved) and ok.
   All members must be ok (`reduce` over `user_tasks` documents; members without a `user_tasks` doc are ignored).
4. Page: Information row "Submission limit": "No limitation" / "{N} submissions" / "{N} submissions<br /> every {H} hour(s)". When exhausted: disabled button "You have reached the submission limit." (group: "Your group have reached the submission limit.") + "<br/> It will be refilled within the next {H} hour(s)" if `period > 0`.
5. POST when exhausted → "You are not allowed to submit for this task.".

## Alternative / error flows
- Window semantics: the window starts when a check finds `tokens.date` older than the period (it then sets `amount = 0`, `date = now`). Since checks run at every page display/POST (template calls `task_can_user_submit(...,'tokens')`), the first display of a limited task already initialises `date` to "now"; afterwards the window is "H hours after the last reset", **not** a sliding window and not anchored on submission times.
- For tasks without limit the `tokens.date` field is never written (documents look like `tokens: {amount: 2}`).
- Admin/tutor: unlimited (staff bypass), but their tokens are still counted.
- Tokens are never reset when the limit config changes.

## UI elements
Information row; disabled submit button messages.

## Data
`user_tasks.tokens.amount` (int), `user_tasks.tokens.date` (Date). Course config `submission_limit`.

## Permissions & security
The limit is checked before submission, and the app consumes a token with an atomic increment when the submission is created, rolling it back (and deleting the submission) when the limit is exceeded; together with the single-waiting-submission rule, parallel requests cannot exceed the limit.

## Acceptance tests
- `task_showcase/limited_amount` (2, -1) as `task_carol`: two submissions accepted; afterwards the page shows "You have reached the submission limit." and POST returns "You are not allowed to submit for this task."; `user_tasks.tokens.amount == 2`.
- `limited_period` (1, 1h): after the allowed submission(s) the button says "…It will be refilled within the next 1 hour(s)"; setting `tokens.date` to 2 hours ago in DB re-enables submission and resets `amount` to 0.
- Admin can submit beyond the limit.
