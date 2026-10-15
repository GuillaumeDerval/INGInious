# Table-of-contents task list (sections, task status, hidden tasks)

- **ID**: NAV-10
- **Actors**: student, staff, anonymous (preview)
- **Routes**: rendered inside GET /course/<courseid>
- **Depends on**: NAV-09, NAV-14 (task config items), NAV-12 (filter markers), course-model.md §5
- **Legacy code**: `legacy/inginious/frontend/task_dispensers/toc.py:L18-L158`, `task_dispensers/util.py:L210-L343`, `task_dispensers/__init__.py:L99-L108`, `templates/task_dispensers/toc.html:L1-L42`, `templates/task_dispensers/task_list.html:L1-L62`, `static/js/common.js:L196-L213` (`dropdown`)

## Use case
Teachers organise tasks into nested, collapsible sections; students see, for each visible
task, its weight, completion and whether its deadline passed.

## Preconditions
Course uses `task_dispenser: toc` (default) or `combinatory_test` (same renderer, NAV-13).

## Main flow
1. `accessibilities = dispenser.get_accessibilities(all task ids, [username])`.
2. Recursive rendering of `dispenser_data.toc` (`toc.html`, `level` starts at 3):
   - For each section compute `section_tasks` = the ids of `section.get_tasks()` (the task list of a terminal section; all descendant tasks of a non-terminal one) that exist as task folders, and `have_accessible_tasks` = any of them `is_open()` now.
   - Skip the section entirely if `config.hidden_if_empty` is true and no task is open.
   - Terminal section (`tasks_list`) → card (`task_list.html`):
     - header `.section_header.card-header` with the title passed through the **global** gettext `_()` (not the course catalog) and a caret (`fa-caret-down`; `fa-caret-left` if `config.closed`); clicking the header toggles the content (`dropdown()` JS: slideUp/slideDown + caret swap);
     - content `.content.list-group.tasks-list` (`display:none` if closed): for each task **in `tasks_data`** (i.e. visible: `after_start`), an `<a class="list-group-item list-group-item-action">` to `/course/<cid>/<tid>` containing:
       - green check `fa-check` (colour `#468847`) if `succeeded`, transparent otherwise;
       - translated task name; if not `is_open()` (hard deadline passed) the item gets class `disabled` (still clickable: `pointer-events: auto`) and text " - **deadline reached**";
       - badge "Weight : <weight>" (raw number, e.g. `1`, `0.5`, `3`), always shown (also for weight 0);
       - if the user is registered (staff count): progress bar `bg-success`, width `grade|int`%, label `N %` (integer if the float is integral, else the raw float, e.g. `33.33 %`), followed by `task_list_item` plugin hook entries (`| safe`);
       - hidden `div#tags_of_task` with one `div#tag[data-tag-name=<category>]` per dispenser category (NAV-12).
   - Non-terminal section (`sections_list`) → `div.section.sections-list.mb-4` with header (`span.title.h<level>` + divider line + caret) and `div.content.ml-4` containing the recursive rendering with `level+1`.
3. Tasks never shown: not yet started (`before_start`, e.g. `tfuture`), no/false accessibility (`tnever`, also the default!), not referenced in the toc (`textra` — still counted in the grade), referenced but missing folder.
4. A section whose tasks are all hidden still renders an empty card unless `hidden_if_empty`. Note `hidden_if_empty` tests `is_open()` while visibility tests `after_start()`: a section whose tasks are all past their deadline is hidden by `hidden_if_empty` although its tasks would be listed as "deadline reached".

## Alternative / error flows
- Invalid toc/config in `course.yaml` → course unloadable (404 on course page).
- Legacy list format of `dispenser_data` is accepted (course-model §5.1).

## Data
`course.yaml` `dispenser_data` (toc + config), task names, `user_tasks.grade/succeeded`.

## Permissions & security
Visibility on the course page is cosmetic: the task page applies its own check (`task_is_visible_by_user`: course open and `after_start`, or staff). Section titles and task names are escaped.

## Acceptance tests (course navopen as nav_alice)
- Rendered order and nesting: "Part 1" (h3 non-terminal) › "Basics" card [T1 easy, T2 hard], "Advanced" card collapsed (`fa-caret-left`, content hidden) [T3 weight zero]; "Deadlines" card [T past - deadline reached (disabled), T soft deadline].
- "Hidden if empty" section (only `tfuture`, starting 2030) is not rendered.
- `tnever` (no config) and `textra` (not in toc) are never shown.
- T1 shows the green check and 100 %; T2 50 %; weight badges 1, 3, 0, 1, 1.
- Clicking the "Advanced" header reveals T3 and switches the caret to `fa-caret-down`; clicking again hides it.
- Anonymous preview (navpreview): items without progress bars.
- Unit: `SectionsList` errors — missing title, section without tasks_list/sections_list, invalid task id.
