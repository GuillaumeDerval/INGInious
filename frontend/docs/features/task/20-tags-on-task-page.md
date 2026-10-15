# Tags shown after a submission (skills, misconceptions, auto-tags)

- **ID**: TASK-20
- **Actors**: student, staff; grading scripts set tags
- **Routes**: `GET /course/<courseid>/<taskid>`, `@action=check`, `@action=load_submission_input`
- **Depends on**: TASK-09, TASK-10, COURSE (tags in `course.yaml`)
- **Legacy code**: `legacy/inginious/common/tags.py`, `courses.py:L82,L268-L269`, `pages/tasks.py:L135-L138,L359-L367`, `templates/task.html:L110-L125,L212-L228`, `static/js/task.js:L104-L107,L748-L821`, container API `feedback.set_tag` / `feedback.tag`

## Use case
Grading scripts flag concepts mastered (skills, green) or detected misconceptions (red), plus
free-form "auto tags"; students see them on the task page and in the history.

## Preconditions
Course tags in `course.yaml`: `tags: {<tagid>: {name, description?, type: 0|1|2, visible: bool}}`
(type 0 = skill, 1 = misconception, 2 = category/organisational; `visible` default false).
Grading script: `tag-set <tagid> true|false` / `feedback.set_tag(tagid, bool)` → `tests[tagid] = bool`; `tag "<value>"` / `feedback.tag(value)` → `tests["*auto-tag-<hash(str(value))>"] = str(value)`.

## Main flow
1. Page: `visible_tags` = tags with `visible: true` (all tags for staff). If non-empty: `<h3>Tags</h3><div id="main_tag_group">` with, per type-0 tag, `<span class="badge alert-info" id="<tagid>" title="<name>" style="display:none">name</span>` and per type-1 tag the same with `alert-danger` (type 2 never rendered). All hidden initially.
2. Result JSON `tests`: for each course tag of type 0/1 that is (visible or user is **admin**) and present in `submission.tests` → copied; for admins also every `*auto-tag-*` key.
3. JS `updateMainTags(data)`: reset (danger badges hidden, auto-tag (warning) badges removed, others → `badge alert-info`); for each `tests[tag]` truthy: show it (skills become `badge alert-success`, misconceptions stay red); auto tags appended as `<span class="badge alert-warning">value</span>` (truncated to 28 chars + "…" with the full value in `data-original-title`).
4. History badge: per submission, count of course tags whose `tests[tagid]` is truthy → `<span class="badge alert-info" id="tag_counter" title="<names>">N</span>`; for a new submission, `updateTagsToNewSubmission` counts badges of `#main_tag_group` with `id in tests && tests[id]`.

## Alternative / error flows
- Tutors (staff, non-admin) see hidden tags in the header (template uses staff rights) but do **not** receive their values in `tests` (JSON uses admin rights) — inconsistency.
- `tests` values are stored by mongoengine `MapField(StringField())`: booleans come back as booleans from the agent but the model declares strings.

- Auto-tag ids use Python's `hash(str(value))`, randomized per process (PYTHONHASHSEED): the same value yields different ids across runs (verified `*auto-tag-8357813642712626234` vs others) — never rely on them.

## UI elements
Tag badges (info/success/danger/warning), tooltips (`title` = tag **name**: `Tag.get_description` returns the name — legacy bug).

## Data
`submissions.tests: {"skill_loop": true, "misc_off_by_one": false, "*auto-tag-4518…": "auto tag: 4 tests passed"}`.

## Permissions & security
- Auto-tag values are inserted as text (auto-tags are only sent to admins).
- Hidden (non-visible) tag values are not sent to students.

## Acceptance tests
- `task_showcase/code_python` correct solution as student: header shows "Loops" (green) only; "Off-by-one" stays hidden; "Hidden skill" not rendered; `tests` JSON lacks `skill_hidden` and auto-tags.
- Off-by-one solution (`range(n)`) → "Off-by-one" red badge shown.
- Same as admin: "Hidden skill" badge green, auto-tag "auto tag: 4 tests passed" warning badge.
- History item badge shows the number of true tags (e.g. 1 for a student).
