# Course model (`course.yaml`) — reference

This document describes every key of a course description file
(`<tasks_directory>/<courseid>/course.yaml`) as interpreted by the legacy frontend
(`legacy/inginious/frontend/courses.py`, `accessible_time.py`, `task_dispensers/*.py`,
plugins) and the rules derived from it (accessibility, registration, ACL, grade).
The rewrite must read and write **exactly** this format (the same directory is shared with the
unchanged backend/agents and the WebDAV server).

Example courses exercising every key: `infra/tasks/nav*` (see `docs/features/nav/`).

## 1. File, id, loading and caching

| Aspect | Rule |
|---|---|
| Location | `<tasks_directory>/<courseid>/course.yaml`. A first-level folder of `tasks_directory` is a course iff it contains `course.yaml` (`Course.get`, `courses.py:L298-L319`). `course.json` is **not** read by `Course.get` (only checked for existence by the marketplace import). |
| Course id | `Course.get` requires `id_checker(courseid)` = `re.match(r"[a-z0-9\-\._]+$", id, re.IGNORECASE)` (`common/base.py:L17-L19`); otherwise `InvalidNameException`. The new app applies the same rule when a course is created ("Create new course" in /mycourses) — see NAV-04. |
| Parsing | `loads_json_or_yaml("course.yaml", bytes)` → `inginious.common.custom_yaml.load` (YAML 1.1, ordered dicts). JSON content is valid YAML and is accepted. Unreadable file → `CourseUnreadableException`. |
| Writing | `Course.save()` → `custom_yaml.dump(self._content)` (`courses.py:L292-L296`); the whole descriptor is rewritten (keys order kept, comments lost). |
| Caching | `fetch_or_cache(course_fs, "course.yaml", loader)` (`common/filesystems/__init__.py:L151-L157`): one `Course` object per process, rebuilt only when the mtime of `course.yaml` increases. The task dispenser (and its parsed config) lives in that cached object. |
| Listing | `Course.get_all()` lists the first-level folders and silently skips (log warning "Cannot open course : %s") any folder whose course fails to load (missing file, invalid YAML, invalid key value, `nofrontend: true`, ...). Broken courses therefore disappear from every list. |
| Errors per page | `/course/<id>`: any loading error → 404 "Course not found.". `/register/<id>`: only `InvalidNameException`, `CourseNotFoundException`, `CourseUnreadableException` → 404 "This course doesn't exist."; a course with an invalid value (e.g. bad date) → **500**. `/group/<id>`: no try/except → **500** for any error (even unknown course). |
| i18n | Optional folder `<courseid>/$i18n/` containing `<lang>.mo` gettext catalogs. `course.gettext(lang, text)` translates course `name`, `description` and tag names; untranslated text is returned as is. Each `.mo` is also cached by mtime. |

## 2. Keys

Default = value used when the key is absent. "Forced if LTI" = value overridden when `is_lti: true`
(`courses.py:L89-L103`). Any exception while reading keys L59-L85 is re-raised as
`Exception("Course has an invalid YAML spec: <id>")` (course becomes unloadable).

| Key | Type | Default | Meaning / rules |
|---|---|---|---|
| `name` | str | **required** | Course name (translated through `$i18n`). Missing → `Exception("Course has an invalid name")`. Empty string is accepted (then `get_name` returns `""`). |
| `nofrontend` | bool | `false` | If true the course cannot be loaded by the frontend at all (exception; hidden everywhere). |
| `description` | str (reStructuredText) | `""` | Rendered with `ParsableText(..., "rst")` (see rst-rendering.md; the new app sanitizes the output). Shown on /courselist cards and in the "About this course" accordion of the course page (only if the raw key is non-empty). |
| `admins` | list[str] | `[]` | Usernames with admin rights on the course. |
| `tutors` | list[str] | `[]` | Usernames with tutor (staff) rights. `get_staff()` = set(admins + tutors). Staff are always considered "registered" and the course is always open to them. |
| `accessible` | bool \| str | `None` → always | Course accessibility period (AccessibleTime, §3). `false` = never (hidden course). Forced `true` if LTI. Ignored (forced closed) when `archived`. Plugins may override through hook `course_accessibility(course, default)` (first non-None return wins). |
| `registration` | bool \| str | `None` → always | Self-registration period (AccessibleTime). Forced `false` if LTI. |
| `registration_password` | str \| null | `null` | If not null, the password required by `/register/<id>` (stored as is in course.yaml). The settings page stores `null` when the field is empty. Forced `null` if LTI. |
| `registration_ac` | null \| `"username"` \| `"email"` \| `"binding"` | `null` | Access-control method for registration. Any other value → course unloadable ("invalid value for registration_ac"). Forced `null` if LTI. |
| `registration_ac_accept` | bool | `true` | `true`: list is an allow-list; `false`: list is a deny-list. |
| `registration_ac_list` | list[str] | `[]` | Patterns; `*` is a wildcard (`.*`), everything else literal; full, **case-sensitive** match (§4). Forced `[]` if LTI. |
| `groups_student_choice` | bool | `false` | Students may join/leave groups themselves on `/group/<id>`. Forced `false` if LTI. |
| `allow_unregister` | bool | `true` | Students may unregister themselves. Forced `false` if LTI. Plugins may override through hook `course_allow_unregister(course, default)`. |
| `allow_preview` | bool | `false` | Non-registered users (and anonymous visitors) may see the course page and task pages while the course is accessible. |
| `is_lti` | bool | `false` | LTI course: see forced values above; course list links to `lti_url`. |
| `lti_url` | str | `""` | URL of the external platform (link on /courselist). Reset to `""` if not LTI. |
| `lti_keys` | dict[str,str] | `{}` | LTI 1.1 consumer key → secret. Reset to `{}` if not LTI. |
| `lti_config` | dict | `{}` | LTI 1.3 tool configuration (pylti1.3 format, issuer → list of client configs). Reset if not LTI. |
| `lti_secrets` | dict[str,str] | `{}` | LTI 1.3 deployment → secret. Reset if not LTI. |
| `lti_send_back_grade` | bool | `false` | Send grades back to the LMS. Effective only if LTI. When true, the course cannot be used outside an LTI session (reason `lti_not_registered`). |
| `archived` | bool | `false` | Archived copy (created by danger zone "archive"). Accessibility forced to never → only staff can open it. |
| `archive_date` | str (ISO 8601) | absent | `datetime.fromisoformat(...).astimezone()`; displayed in /mycourses for archived courses. Invalid → course unloadable. |
| `tags` | dict[tagid, tag] | `{}` | Course tags; tag = `{name: str (required), description: str = "", visible: bool = false, type: int = 0}`; type 0 = skill, 1 = misconception, 2 = category/organisational. Missing `name` → course unloadable. Used on task/submission pages and statistics, **not** by the course-page category filter (which uses dispenser `categories`). Note: `Tag.get_description()` returns the translated *name* (legacy bug). |
| `task_dispenser` | str | `"toc"` | Id of the task dispenser: `toc` (TableOfContents), `combinatory_test` (CombinatoryTest), `contest` (contests plugin, only if loaded). Unknown id → silently falls back to `TableOfContents`. |
| `dispenser_data` | dict \| list | `{}` | Dispenser configuration, §5. Invalid structure/config value → course unloadable. |
| `scoreboard` | list | absent | Used by the scoreboard plugin: list of `{name: str, content: {taskid: weight}, reverse: bool}`. |
| `use_classrooms` | bool | — | Legacy key (pre-audiences). Not read anymore; must be preserved on save. |
| any other key | — | — | Preserved verbatim (`get_descriptor()` returns a deep copy of the whole dict and the settings page re-saves it). |

Keys written by the legacy frontend when creating courses:
- "Create new course" (/mycourses, superadmin): `{name: <id>, accessible: false}`.
- Marketplace import: `{description, admins: [<importer>], accessible: false, tags, name, [task_dispenser: toc, dispenser_data: {config: {}, toc: <old toc>}]}` (NAV-18).
- Archive (danger zone): copy + `archived: true`, `archive_date: <now UTC isoformat>`.

## 3. AccessibleTime (`accessible_time.py`)

Used for `accessible`, `registration` and per-task `accessibility` (dispenser config).

Constructor `AccessibleTime(val)`:

| `val` | start | hard end | soft end |
|---|---|---|---|
| `None`, `""`, `true` | MIN | MAX | MAX |
| `false` | MAX | MAX | MAX (never open) |
| `"A"` | A | MAX | MAX |
| `"A / B"` | A | B | B |
| `"A / S / B"` (3+ parts; parts after the 3rd ignored) | A | B (3rd part) | S |

- Parts are split on `/` and stripped. An empty part takes the default (start → MIN, end → MAX); e.g. `"/ 2014-07-16"` = open until that date, `"2014-07-16 /"` = open from that date.
- MIN = `datetime.min` with tz UTC+23:59 (`timezone.max`), MAX = `datetime.max` with tz UTC−23:59 (`timezone.min`), i.e. sentinels that compare below/above any real date.
- `parse_date(s)`: first `datetime.fromisoformat(s).astimezone()` (accepts `2014-07-16`, `2014-07-16 11:24:00`, `2014-07-16T11:24:00+02:00`, ...); on ValueError tries `"%d/%m/%Y %H:%M:%S"`, `"%d/%m/%Y %H:%M"`, `"%d/%m/%Y %H"`, `"%d/%m/%Y"` — never reached in practice for those formats since the string was split on `/` first. Anything else → `Exception("Unknown format for ...")`.
- **Naive dates are interpreted in the server's local timezone** (`astimezone()` on a naive datetime). The reference containers run in UTC. The rewrite must use the same server-timezone rule.
- If soft end > hard end, soft end := hard end.
- Predicates (`when` defaults to now, tz-aware):
  - `before_start()` = start > now; `after_start()` = not before_start (start ≤ now).
  - `is_open()` = start ≤ now ≤ hard end (inclusive).
  - `is_open_with_soft_deadline()` = start ≤ now ≤ soft end.
  - `is_always_accessible()` = (start, end) == (MIN, MAX); `is_never_accessible()` = (start, end) == (MAX, MAX).
  - `get_std_start_date()`/`get_std_end_date()`/`get_std_soft_end_date()`: ISO string or `""` for sentinels (used by edit forms).
- Course settings form writes `accessible`/`registration` as `true`, `false` or `"<start>/<end>"` (custom).

## 4. Registration access control

`Course.is_user_accepted_by_access_control(user)` (`courses.py:L232-L249`):
1. `registration_ac` null → accepted.
2. `user` is None (anonymous) → refused.
3. Keys: `username` → `[user.username]`; `email` → `[user.email]`; `binding` → the keys of `user.bindings` (auth-method ids, e.g. `github`, `google`, ...).
4. Regex = `"|".join(re.escape(p).replace("\\*", ".*") for p in registration_ac_list)`, compiled once at load; each key is tested with `fullmatch` (case-sensitive; `?`, `[` ... are literals). An empty list produces the empty regex, which only matches an empty key.
5. `at_least_one = any(match)`; result = `at_least_one` if `registration_ac_accept` else `not at_least_one`.

`Course.is_registration_possible(user)` = `accessible.is_open() and registration.is_open() and ACL(user)`.
Note it does **not** check whether the user is already registered; staff/superadmin are not exempt from the ACL.

## 5. Task dispensers and `dispenser_data`

### 5.1 TableOfContents (`toc`)

```yaml
dispenser_data:
  toc:                      # list of sections (SectionsList)
    - title: Part 1         # required, non-empty
      config: {closed: false, hidden_if_empty: false}   # optional
      sections_list:        # non-terminal section ...
        - title: Basics
          tasks_list: [t1, t2]   # ... or terminal section (list of task ids, each must pass id_checker)
  config:                   # per-task settings, keyed by task id
    t1: {weight: 1, accessibility: true, categories: [easy], evaluation_mode: best,
         no_stored_submissions: 0, submission_limit: {amount: -1, period: -1}, group_submission: false}
  imported: true            # optional flag written by the admin structure editor
```

- Legacy format: if `dispenser_data` is a **list**, it is treated as `{toc: <list>}` (`toc.py:L27-L29`); `null`/`{}` → `{toc: {}, config: {}}` (an empty dict iterates as an empty section list). Very old files (e.g. `infra/tasks/tutorial`) also have `tasks_list` as a dict `{taskid: rank}` (iteration yields the keys) and extra keys `id`, `rank` (ignored).
- A section must contain `sections_list` or `tasks_list`, else `InvalidTocException("One section don't contain a sections list nor a tasks list")`; missing/empty `title` → "No title for one section"; invalid task id → "One task id contains non alphanumerical characters".
- Section `config` keys: `closed` (bool, default false: section rendered collapsed), `hidden_if_empty` (bool, default false: section not rendered when none of its *direct* tasks is currently open). Combinatory test: `amount` (int, default 0).
- `config` is normalised at load (`parse_tasks_config`, `util.py:L346-L367`): entries for task ids that are not task folders are **deleted**, missing tasks get `{}`, every value is validated (invalid → course unloadable "In taskid X : ...").

Per-task config items (`task_dispensers/util.py`):

| Key | Default | Validation | Meaning |
|---|---|---|---|
| `weight` | `1` | int or float, ≥ 0 | Weight in the course grade. |
| `accessibility` | **`false`** | any AccessibleTime value | Task availability period. **Default is never accessible**: a task without config is invisible to everybody (staff included, on the course page). |
| `categories` | `[]` | list of str, no `""` | Category labels (course-page filter, task page "Category tags", submissions filter). |
| `evaluation_mode` | `"best"` | `"best"` \| `"last"` | Which submission counts. |
| `no_stored_submissions` | `0` | int ≥ 0 (0 = unlimited) | Max stored submissions. |
| `submission_limit` | `{amount: -1, period: -1}` | ints ≥ -1; period ≠ -1 requires amount ≠ -1 | Submission tokens (amount per period in hours; -1 = unlimited / never reset). |
| `group_submission` | `false` | bool | Group (team) submission. Not available in `combinatory_test` (always false). |

Legacy task.yaml fields (`weight`, `submission_limit`, `stored_submissions`, `groups`, `evaluate`, `accessible`, `categories`) are **not** used by the dispensers; they can be imported into `dispenser_data.config` by the admin "migrate tasks" action (course admin task list).

Visibility rules derived from `accessibility`:
- A task is listed on the course page and counts in the grade iff `accessibility.after_start()` (start ≤ now) — `get_user_task_list`.
- It is rendered "disabled" with " - deadline reached" when not `is_open()` (after the hard end).
- `task_is_visible_by_user` = (course open to user and `after_start`) or staff; `task_can_user_submit` additionally requires `is_open()`.

### 5.2 CombinatoryTest (`combinatory_test`)

Same structure as `toc` (subclass). Each **top-level** section (index `i`, title `T`) draws
`int(config.amount)` tasks among its `get_tasks()` (recursive) whose own `accessibility.after_start()`:

```python
rand = random.Random("{}#{}#{}".format(username, i, T))   # Python Mersenne-Twister, str seed (SHA-512 seeding, version 2)
choices = [t for t in section.get_tasks() if after_start(t)]
rand.shuffle(choices)
selected = choices[:amount]
```

Selected tasks get their configured accessibility, all others `AccessibleTime(False)`.
**The rewrite must reproduce CPython's `random.Random(str)` + `shuffle` bit-for-bit** (or call
Python) or students will see different tasks. Test vectors (course `navcombi`: Pool A = [c1..c4]
amount 2, Pool B = [c5, c6] amount 1): nav_alice → {c4, c3}, {c6}; nav_bob → {c3, c1}, {c6};
nav_carol → {c2, c1}, {c6}; superadmin → {c2, c1}, {c5}. Staff get a random draw too.

### 5.3 Contest (`contest`, contests plugin)

`dispenser_data = {toc_data: <toc dispenser_data>, contest_settings: {enabled: bool, start: iso, end: iso, blackout: int ≥ 0 (hours), penalty: int ≥ 0 (minutes)}}`. When enabled, every task of the toc gets `AccessibleTime(start + "/")`, other tasks never. (Documented with the contests plugin.)

## 6. Course grade (TableOfContents and subclasses)

`get_course_grades(user_tasks, usernames)` (`toc.py:L85-L105`):

```
for each task folder t of the course (NOT only the toc!):
    if accessibility(t, user).after_start():  denominator += weight(t)
for each user_tasks document d of the user:
    if accessibility(d.taskid, user).after_start(): numerator += d.grade * weight(d.taskid)
grade = round(numerator / denominator)  if denominator > 0 else 0     # Python round(): banker's rounding (77.5 → 78, 76.5 → 76)
```

- Tasks with configured accessibility that are **not placed in the toc** still count (invisible but graded).
- Tasks whose period ended still count. Tasks not yet started do not.
- `user_tasks.grade` is the cached grade of the "best"/"last" submission (0–100).
- Example `navopen` for nav_alice: weights t1=1 (100), t2=3 (50), t3=0, tpast=1 (100), tsoft=1 (0), textra=5 (100, not in toc); tfuture (not started) and tnever (no config) ignored → (100+150+100+500)/11 = 77.27 → **77 %**.

## 7. Access decision summary

`UserManager.course_is_open_to_user(course, username, lti, return_reason)` (`user_manager.py:L692-L739`):

1. Staff (admin/tutor) or superadmin → open.
2. `not course.get_accessibility().is_open()` (includes archived) → `"closed"`.
3. Not registered and not `allow_preview` → `"unregistered_not_previewable"`.
4. `lti` truthy and `course.is_lti() != lti` → `"lti_only"`.
5. `lti is False` and course is LTI: open if not `lti_send_back_grade`, else `"lti_not_registered"`.
6. Otherwise open.

`course_is_user_registered(course, username)` = staff/superadmin or `courses` document `{_id: courseid, students: username}` exists.

## 8. Test fixtures (NAV area)

Courses on disk (`infra/tasks/`, course.yaml/task.yaml written as JSON, which is valid YAML; tasks are 1-question MCQs):

| Course | Purpose |
|---|---|
| `navopen` | admins superadmin+nav_admin, tutor nav_tutor; registration open; groups_student_choice; tags; toc with nested sections (`closed`, `hidden_if_empty`), weights 0/1/3/5, categories, deadlines (past, soft, future, none), `textra` not in toc |
| `navpwd` | `registration_password: s3cret`, `allow_unregister: false` |
| `navclosed` | `accessible: false` |
| `navfuture` | `accessible: "2030-01-01 / 2031-01-01"` |
| `navpreview` / `navpreviewreg` | `allow_preview: true` with registration closed / open |
| `navregclosed` | `registration: "2020-01-01 / 2021-01-01"` |
| `navacl` / `navdeny` / `navbind` | email allow-list / username deny-list / binding allow-list |
| `navlti` | `is_lti: true`, `lti_url` |
| `navarchive` | `archived: true`, `archive_date` |
| `navcombi` | `combinatory_test` dispenser |
| `navnew` | created through "Create new course" |

Users (password `superadmin`): nav_alice (audience TP1 of navopen), nav_bob, nav_carol (`@ok.org`), nav_dave (binding `github`, member of "Group Full"), nav_tutor, nav_admin, nav_eve (no course).
MongoDB: `courses` docs navopen/navpwd/navcombi, audience "TP1" and groups "Group A" (size 2), "Group B (TP1 only)" (size 1, audience TP1), "Group Full" (size 1) in navopen, "PWD group" in navpwd.
A broken course (`accessible: "notadate"`) and a marketplace import were tested then removed.
