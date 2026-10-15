# Course settings: tags editor (skills / misconceptions / categories)

- **ID**: CADM-05
- **Actors**: course admin, superadmin
- **Routes**: Tags tab of `GET|POST /admin/<courseid>/settings`
- **Depends on**: CADM-03 (form & save), TASK-20 (tags shown on the task page / feedback), course list tag filtering
- **Legacy code**: `legacy/inginious/frontend/pages/course_admin/settings.py:L143-L146,L160-L195` (`define_tags`, `prepare_datas`); `templates/course_admin/settings.html:L423-L482`; `static/js/studio.js:L641-L682` (`studio_expand_description*`, `studio_add_table_line`); `common/tags.py:L6-L69`; `common/base.py:L107-L135` (`dict_from_prefix`)

## Use case
The admin defines the course's tags: *skills* (type 0, shown in blue, searchable), *misconceptions* (type 1, only
shown when activated by the grader feedback) and *categories* (type 2, organisational, never shown). Tasks/graders
refer to tags by id.

## Preconditions
- Admin rights.

## Main flow
1. Tags tab (`#tags_tab`) shows a button "New tag" (`studio_add_table_line(-1,'table','NEW')`) and a table `#table` with columns "id", "name", "description", "show to students", "type ".
2. One row per existing tag (`course.get_descriptor()['tags']`, in file order), row `id = loop.index` (1-based):
   - `tags[<i>][id]` text (value = tag id), `tags[<i>][name]` text (default "Unknown name" if missing), `tags[<i>][description]` textarea (1 row, expands to 5 on focus via `studio_expand_description`), `tags[<i>][visible]` checkbox (checked if `visible`), `tags[<i>][type]` select with options `0` "Skill", `1` "Misconception" (selected = `type|int`).
   - **There is no "Category" (2) option** and **no delete button**: a tag is removed by clearing its id (rows with an empty id are dropped).
3. "New tag" clones the hidden template row `#NEW` (all inputs `disabled` so it is not submitted), replaces `NEW` with `1 + id of the last <tr>` (or `0` when the last row is the template), removes `disabled`, fills `ID_REPLACE`/`NAME_REPLACE`/`DESCRIPTION_REPLACE` with empty strings and appends it.
4. POST: `dict_from_prefix("tags", form)` → `{"<i>": {"id":…, "name":…, "description":…, "visible"?:…, "type":…}}`.
   - `prepare_datas`: if two rows share the same non-empty id → error "Some datas have the same id! The id must be unique."; rows with empty `id` are dropped; result keyed by id.
   - For each tag: `visible = "visible" in tag` (checkbox present → true); `type = int(type)`; if (`id == ""` and type != 2) or `name == ""` → "Some tag fields were missing."; `id_checker(id)` false → "Invalid tag id: <id>"; then `id` removed from the value dict.
   - `course_content["tags"] = tags` and **the course is saved immediately** (`Course(...).save()`), before the other errors of the form are checked (source of the CADM-03 partial-save bug).
5. Written YAML (verified):
   ```yaml
   tags:
       misc1:
           name: Misconception one
           description: ''
           type: 1
           visible: false
       skill1:
           name: Skill one
           description: desc 1
           visible: true
           type: 0
   ```
   Inner key order follows the posted field order (`name, description, [visible], type`, with `visible` appended last when the checkbox was unchecked). Any extra posted sub-field (`tags[1][foo]`) would be stored too.

## Alternative / error flows
- Duplicate ids → "Some datas have the same id! The id must be unique." (tags not saved, but see CADM-03 for the rest of the form: then nothing is saved because the save happens inside `define_tags` only on success).
- Invalid id (e.g. `my tag`) → "Invalid tag id: my tag".
- Empty name → "Some tag fields were missing.".
- Non-integer `type` (crafted) → `ValueError` → HTTP 500.
- No tag rows posted → `tags: {}` (all tags deleted).
- Type-2 (category) tags existing in the file are displayed with type select defaulting to "Skill" (no option 2 selected) — **saving the form converts categories into skills**. Rewrite should offer the 3 types.
- Template row has `VISIBLE_REPLACE)` / `ID_STOP` artefacts (harmless typos in legacy HTML).

## Data
- `course.yaml` key `tags`: map `<tag id>` → `{name: str, description: str, visible: bool, type: int (0|1|2)}`.

## Permissions & security
- Admin only; values escaped in HTML. Tag ids validated by `id_checker`; names/descriptions free text (translated via course i18n at display).

## Acceptance tests
- Add two tags through the UI → YAML as above (booleans and ints typed).
- Clear an existing tag id → tag removed from YAML.
- Duplicate id, invalid id, empty name → the three messages; YAML unchanged.
- Existing type-2 tag survives a save with type 2 (rewrite fix) — legacy converts it to 0; document chosen behaviour.
