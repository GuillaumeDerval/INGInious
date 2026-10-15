# Per-task dispenser settings (weight, submission storage, evaluation mode, group submission, categories, submission limit, accessibility)

- **ID**: CADM-08
- **Actors**: course admin, superadmin
- **Routes**: client-side modals inside `GET /admin/<courseid>/tasks`; persisted in `dispenser_data.config` by the CADM-07 save POST
- **Depends on**: CADM-07 (save + validation), TASK-* (submission limits, accessibility, evaluation mode, group submissions are enforced on the student side), course grade computation (weights)
- **Legacy code**: `legacy/inginious/frontend/task_dispensers/util.py:L13-L208` (config item classes, `InvalidTocException`); `task_dispensers/toc.py:L18-L21` (`config_items`, `legacy_fields`); templates `course_admin/task_dispensers/config_items/{weight,submission_storage,evaluation_mode,groups,categories,submission_limit,accessibility}.html`, `util_task_edit_modal.html`, `util.html:L46-L80,L159-L194`; `accessible_time.py`

## Use case
For each task the admin sets how it is graded and accessed: weight in the course grade, how many submissions are
kept, whether the best or last submission counts, individual or group submission, categories (tags used for
filtering), submission rate limit, and opening/soft-deadline/closing dates.

## Preconditions
- Task placed in the TOC (only tasks of the TOC keep a config).

## Main flow
1. Click the task's "Task settings" (`fa-cogs`) button → modal `#edit_task_modal` titled "Edit task <taskid>"; on `show.bs.modal` each config item reads `dispenser_config[taskid][key] ?? default` and fills its controls.
2. Every control change immediately updates the JS object `dispenser_config[taskid]` and the "pill" summary under the task name; nothing is sent until "Save changes" (CADM-07). Modal button "Close".
3. **Grouped edit**: select tasks with the checkboxes, choose a setting pill in "On setting:", then Grouped actions → "Change selection" opens `#grouped-actions-edit` showing only that item's controls (classes suffixed `_grouped`); changes apply to all checked tasks.

### Config items (TOC order; combinatory test omits group submission)
| Item (id, label) | Default | UI controls | Stored value (JSON → YAML) | Server validation message (prefixed by "Invalid course structure: In taskid <t> : ") |
|---|---|---|---|---|
| `weight` "Weight" / "Grade weight (in comparison to other tasks)" | `1` | number input `.weight` (placeholder 1) | `Number(value)` (int or float; empty → 0) | not int/float or < 0 → "The weight value must be a numeric >= 0 " (resp. without trailing space) |
| `no_stored_submissions` "Submission storage" | `0` (= all) | radios "All submissions" (`store_all` → 0) / "Only the last {nbr_submissions} submissions" (`store_not_all`) + number `#no_stored_submissions_value` | int | not int → "The store submission must be an integer > 1 "; < 0 → "The store submission must be an integer > 1" |
| `evaluation_mode` "Evaluation mode" / "Evaluation submission" | `"best"` | radios "Best submission" (`best`) / "Last submission" (`last`) | `"best"`/`"last"` | other → "The evaluation mode must be either best or last but is <v>" |
| `group_submission` "Submission mode" | `false` | radios "Individually" (`false`) / "Per group" (`true`) | bool | non-bool → "Invalid submission mode" |
| `categories` "Categories" | `[]` | text "Tag name, separated by commas" | `value.split(",").filter(x => x !== "")` (no trimming) | contains `""` → "All categories must have a name but are :[…]" |
| `submission_limit` "Submission limit" / "Submission limits" | `{"amount": -1, "period": -1}` | radios "No limitation" (`none` → {-1,-1}), "Hard limit: {n} submission(s)" (`hard`, number `#submission_limit_hard` → `{amount: n, period: -1}`), "Soft limit: {n} submission(s) every {h} hour(s)" (`soft`, numbers `#submission_limit_soft_0/1` → amount/period) | `{amount: int, period: int}` (period in hours) | not ints → "Invalid submission limit"; amount -1 with period ≠ -1 → "You have given a period but no amount for the submission limit"; < -1 → "Submission limit values must be higher than or equal to -1" |
| `accessibility` "Accessibility" | `false` (never accessible!) | radios "Never" (`false`), "Always" (`true`), "Custom, from: … to: …" + datetimepickers `#accessibility_start`, `#accessibility_end`, `#accessibility_soft_end` ("Soft Deadline", tooltip "Students can still submit after this date"), format `YYYY-MM-DD HH:mm:ssZ` | `true` / `false` / `"<start>/<soft_end>/<end>"` (note the **soft end in the middle**) | `AccessibleTime` parse error → "Invalid task accessibility : Unknown format for <x>" |

Pills (short display, `short=True`): "Grade weight (in comparison to other tasks) : 2.5"; "Submission storage : All submissions | Only the last 3 submissions"; "Evaluation submission : Best submission | Last submission"; "Submission mode : Per group | Individually"; "Categories : cat1,cat2"; "Submission limits : No limitation | Hard limit: 5 submission(s) | Soft limit: 5 submission(s) every 24 hour(s)"; "Accessibility : Never | Always | Custom, from: <start> to: <end> (<soft end>)" (dates formatted with `dtf`, browser locale, session timezone).

### Verified example (UI modal on `task1`, then "Save changes")
Posted `config`: `{"task1":{"weight":2.5,"no_stored_submissions":3,"evaluation_mode":"last","group_submission":true,"categories":["cat1","cat2"],"submission_limit":{"amount":5,"period":24},"accessibility":"2026-01-01 00:00:00+00:00/2026-06-01 00:00:00+00:00/2026-07-01 00:00:00+00:00"},"task2":{}}`
Written:
```yaml
dispenser_data:
    config:
        task1:
            accessibility: 2026-01-01 00:00:00+00:00/2026-06-01 00:00:00+00:00/2026-07-01
                00:00:00+00:00
            categories:
            - cat1
            - cat2
            evaluation_mode: last
            group_submission: true
            no_stored_submissions: 3
            submission_limit:
                amount: 5
                period: 24
            weight: 2.5
        task2: {}
```
(Long plain scalars are folded at ~80 columns by PyYAML — semantically the same string.)
Only keys explicitly changed are stored; untouched items stay absent and use defaults (`task2: {}` → weight 1,
all submissions stored, best, individual, no categories, no limit, **accessibility false = never accessible**).

## Alternative / error flows
- Choosing the radio "Only the last … submissions" without typing a number stores `Number("store_not_all")` = `NaN` → JSON `null` → save fails with "The store submission must be an integer > 1 " (code analysis; verified server message with `null`).
- Custom accessibility with all dates empty → `"//"` → parsed as always accessible.
- Values posted with wrong types (e.g. `"weight": "7"`) are rejected; unknown keys inside a task config are kept verbatim.
- The default `accessibility: false` means a newly created/placed task is **hidden to students** until the admin opens it (important parity point).

## Data
- `course.yaml` → `dispenser_data.config.<taskid>`: `{weight?: number, no_stored_submissions?: int, evaluation_mode?: "best"|"last", group_submission?: bool, categories?: [str], submission_limit?: {amount: int, period: int}, accessibility?: bool|str}`.
- Legacy task-level equivalents (imported by CADM-06): `weight`, `stored_submissions`, `evaluate`, `groups`, `categories`, `submission_limit`, `accessible`.

## Permissions & security
- Admin only (via CADM-07 POST). Client-side only state until save. No server-side type coercion: the JSON types are stored as received if valid.

## Acceptance tests
- Each item: set via modal, save, check YAML type/value; reopen modal shows the stored value.
- Grouped edit on 2 selected tasks sets the same value on both.
- Each invalid value (negative weight, `evaluation_mode: worst`, `categories: [""]`, `{amount:-1, period:3}`, `group_submission:"yes"`, `accessibility:"zz"`, `no_stored_submissions:null`) → the exact error message and no change saved.
- Task without config → student sees it as not accessible (accessibility default false); weight 1 in grade.
- Accessibility string order start/soft_end/end preserved.
