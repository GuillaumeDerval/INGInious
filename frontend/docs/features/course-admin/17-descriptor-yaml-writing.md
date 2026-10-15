# Writing `course.yaml` / `task.yaml` (serialisation format used by all editors)

- **ID**: CADM-17
- **Actors**: system (used by CADM-01, 03–10, 12, 15)
- **Routes**: — (cross-cutting persistence)
- **Depends on**: reference `docs/reference/course-model.md`, `docs/reference/task-model.md`; WebDAV (same files edited externally); backend (reads `task.yaml` from the shared tasks directory)
- **Legacy code**: `legacy/inginious/common/custom_yaml.py:L17-L87` (`load`, `dump`); `common/base.py:L36-L55` (`loads_json_or_yaml`, `get_json_or_yaml`); `courses.py:L30-L38,L289-L325`; `tasks.py:L24-L31,L209-L251`; `common/filesystems/__init__.py:L148-L168` (`fetch_or_cache`, `invalidate_cache`), `common/filesystems/local.py:L51-L59` (`put`)

## Use case
Every admin edit ends up as a full rewrite of a YAML descriptor on disk. The rewrite must produce files that the
unchanged Python backend, the legacy frontend (during migration) and humans editing via WebDAV/git can read with the
same meaning; diffs should stay small.

## Main flow
1. Loading: `custom_yaml.load` = PyYAML **SafeLoader** (C version if available) with every mapping loaded as `OrderedDict` (file key order preserved).
2. Editing: course settings start from a deep copy of the loaded descriptor (order + unknown keys preserved, new keys appended at the end); the task editor rebuilds a **plain dict** from the form (unknown keys dropped, see CADM-10); dispenser data comes from `json.loads` (plain dicts).
3. Writing: `custom_yaml.dump(data)` = `yaml.dump(data, Dumper=SafeDumper subclass, encoding='utf-8', allow_unicode=True, default_flow_style=False, indent=4)`, then `fs.put(<file>, bytes)` (plain `open(..., 'wb').write`, **not atomic**, no backup, no locking; parent dirs created).
4. Representation rules (verified by running the dumper in the frontend container):
   - `OrderedDict` → mapping in insertion order; **plain `dict` → keys sorted alphabetically** (PyYAML default `sort_keys=True`). E.g. task.yaml top level and `dispenser_data` are sorted; `course.yaml` top level and `problems` keep their order.
   - Block style everywhere (`default_flow_style=False`), except empty containers `{}` / `[]`.
   - Indentation 4; a list directly under a mapping key is written **without extra indentation** (`key:\n- item`), list items that are mappings are written `-   key: value` (dash + 3 spaces).
   - Strings containing `\n` → literal block scalar `|`, `|-` (no trailing newline) or `|+` (several trailing newlines); before dumping, tabs are replaced by 4 spaces and **trailing whitespace of every line is removed** (also turns `\r\n` into `\n`).
   - Single-line strings: plain when unambiguous; quoted with single quotes when they would be read as another type or contain special characters: `'yes'`, `'on'`, `'42'`, `''`, `'2025-01-01'`, `'a: b'`. Non-ASCII written raw (UTF-8).
   - Long plain scalars may be folded on several lines (PyYAML width 80), e.g. the 3-part accessibility string in CADM-08 — equivalent when parsed.
   - `None` → `null`; `True/False` → `true/false`; ints/floats plain.
   - Any other object → `str(obj)` as a string (lossy).
5. Cache: `fetch_or_cache` keys parsed objects on `path` + file mtime; after a write the next access reloads (mtime changed). `Task.delete`/`Course.delete` call `invalidate_cache`. Writes within the same mtime granularity could be missed (theoretical).
6. File names: always `course.yaml` / `task.yaml` (a `.json` extension would switch to JSON with `indent=4` but is never used by the editors).

## Typed values actually written by the legacy editors (compatibility matrix)
| Key | Written type | Note |
|---|---|---|
| course `accessible`, `registration` | bool or `"start/end"` string | settings form |
| course `registration_password` | `null` or string | |
| course `registration_ac` | `null` or `username`/`binding`/`email` | |
| course `tags.<id>.type` | int | `visible` bool |
| course `dispenser_data.config.<t>.accessibility` | bool or `"start/soft_end/end"` | CADM-08 |
| course `dispenser_data.toc[].config.amount` | int | combinatory test |
| task `input_random` | int | |
| task `regenerate_input_random` | `'on'` or absent | string! |
| task `environment_parameters.limits.*` | strings (`'15'`, `''`) | raw form values |
| task `environment_parameters.network_grading` | `'on'` or absent | |
| task `environment_parameters.run_cmd` | string (`''` allowed) | |
| task top-level `network_grading` | always `false` | legacy leftover |
| task `problems.<p>.optional` (code types) | `'on'` or absent | |
| task `problems.<p>.multiple/unshuffle/centralize` | `true` or absent | |
| task `problems.<p>.limit`, `max_size`, `offset` | int or absent | |
| task `problems.<p>.answer` (match) | string | |
| new task (TOC "create") | `{environment_type: mcq, name: <id>, problems: {}}` | sorted keys |

## Alternative / error flows
- Concurrent edits (two admins, or WebDAV + web editor) → last writer wins, no conflict detection.
- A crash during `put` leaves a truncated file (course/task then fails to load → 403/red task).

## Permissions & security
- Safe loader/dumper: no arbitrary object construction (YAML 1.1 schema, plain data types only). The course settings
  form and the task editor only write the fields they edit (other existing keys are kept).

## Acceptance tests
- Golden-file tests: for each editor action of CADM-01..16, the produced YAML parsed with a YAML 1.1 safe loader equals (as data) the legacy output listed in the corresponding feature; key order of `course.yaml` preserved across saves.
- Strings `yes`, `on`, `42`, `2025-01-01`, `''` round-trip as strings (quoted).
- Multiline descriptions/contexts: trailing spaces stripped, tabs → 4 spaces (legacy parity) — or document deviation.
- Files written by the rewrite are loadable by the legacy `Course`/`Task` classes and by the backend unchanged.
