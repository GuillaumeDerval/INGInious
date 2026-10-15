# Filter tasks by category on the course page

- **ID**: NAV-12
- **Actors**: student, staff, anonymous (preview)
- **Routes**: client-side on GET /course/<courseid>
- **Depends on**: NAV-10, NAV-14 (`categories` config item)
- **Legacy code**: `legacy/inginious/frontend/task_dispensers/toc.py:L76-L83`, `templates/course.html:L109-L118,L138-L157`, `templates/task_dispensers/task_list.html:L53-L57`

## Use case
In a long course, a student shows only the tasks of one category (e.g. "easy", "week 3").

## Preconditions
At least one task of the toc has a non-empty `categories` list in `dispenser_data.config`.

## Main flow
1. Server: `get_all_categories()` = set union of `categories` of every task id **listed in the toc** (visible or not; tasks outside the toc ignored). Empty toc → `[]`. Order = Python set iteration order (unspecified; the rewrite may sort).
2. If the set is non-empty, a small `<select id="tag_filter" class="form-control input-sm">` is shown right of the course title with first option `""` "Filter tasks by category", then one option per category (value = label = category string, not translated).
3. Every rendered task item contains hidden markers `div#tag[data-tag-name="<category>"]` (duplicate ids, legacy).
4. `onchange` → `filter_tag(select)`: for each `<a>` inside `.tasks-list`, show it if one of its markers equals the selected value or if the value is `""`, otherwise hide it.
5. Sections and their headers stay visible even if all their tasks are hidden.

## Alternative / error flows
- Course `tags` (skills/misconceptions/categories of `course.yaml`) are **not** used here; only dispenser `categories`.
- No persistence; reload resets the filter.

## Data
`dispenser_data.config.<taskid>.categories: [str]`.

## Permissions & security
Category strings are escaped in the HTML attribute/option. Client-side only.

## Acceptance tests
- navopen: options = {"easy", "hard"} (plus the placeholder).
- Select "hard" → only "T2 hard" visible; "easy" → T1 and T2; placeholder → all visible tasks again.
- navpwd (no categories) → no select rendered.
