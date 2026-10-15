# Combinatory test dispenser administration

- **ID**: CADM-09
- **Actors**: course admin, superadmin
- **Routes**: `GET|POST /admin/<courseid>/tasks` when `task_dispenser: combinatory_test`
- **Depends on**: CADM-06 (switch dispenser), CADM-07 (editor and save protocol, shared code), CADM-08 (config items), student course page (random task selection)
- **Legacy code**: `legacy/inginious/frontend/task_dispensers/combinatory_test.py:L15-L74`; `templates/course_admin/task_dispensers/combinatory_test.html:L1-L41`; `static/js/task_dispensers.js:L496-L498` (`dispenser_structure_combinatory_test`)

## Use case
The admin builds an exam-like course where each section is a *pool* of tasks and every student sees only a fixed
number of randomly chosen tasks per section (deterministic per student).

## Preconditions
- Dispenser switched to "Combinatory test" (CADM-06), which wipes `dispenser_data`.

## Main flow
1. Page identical to the TOC editor (CADM-07) with these differences:
   - Info alert (dismissible) "Combinatory tests": "Only the specified amount of tasks to be displayed will be shown to the user. There is no state: changing the amount of tasks per section, section position or section title will affect the effective task set a user will be displayed." / "As an administrator, the only way to access all the tasks is through this administration page."
   - Sections cannot contain sub-sections in the UI (`display_subsections=False`: no "Add subsection").
   - Section config: one number field `amount` "Amount of tasks to be displayed" (default 0) instead of closed/hidden_if_empty.
   - Config items: Weight, Submission storage, Evaluation mode, Categories, Submission limit, Accessibility (**no group submission**; `get_group_submission()` always False).
2. Save payload: same as TOC (`dispenser_structure_combinatory_test` = same JSON). Section config posted as string from the number input (`{"amount": "1"}`).
3. Server: TOC validation, then for every top-level section `config.amount = int(config.get("amount", 0))` (missing config → `{amount: 0}` added). `int()` failure → "Something wrong happened: Invalid course structure: invalid literal for int() with base 10: 'x'".
4. Written (verified):
   ```yaml
   task_dispenser: combinatory_test
   dispenser_data:
       config:
           legacy1: {}
           task1:
               group_submission: true
           task2: {}
       imported: false
       toc:
       -   config:
               amount: 1
           tasks_list:
           - task1
           - task2
           title: Pool A
       -   config:
               amount: 0
           tasks_list:
           - legacy1
           title: Pool B
   ```
   (a crafted `group_submission` key is accepted and kept although unused by this dispenser.)
5. Student side (for reference): for each section index *i*, the accessible tasks of the section (accessibility `after_start`) are shuffled with `Random("<username>#<i>#<section title>")` and the first `amount` are given their configured accessibility; all others are `AccessibleTime(False)`. Amount 0 → no task shown.

## Alternative / error flows
- Nested `sections_list` can still be posted (no server-side check) but `amount` is only normalised on top-level sections.
- Switching back to TOC wipes the structure again.

## Data
- `course.yaml` `task_dispenser: combinatory_test`, `dispenser_data` like TOC with `toc[].config.amount: int`.

## Permissions & security
- Same as CADM-07.

## Acceptance tests
- Switch to combinatory test; create two pools with amount 1 and 0; YAML as above with `amount` stored as int.
- Non-numeric amount → error message, nothing saved.
- Settings modal has no "Submission mode".
- Student with a given username always gets the same task set; changing the section title changes it.
