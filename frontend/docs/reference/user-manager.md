# UserManager API reference (legacy)

Source: `legacy/inginious/frontend/user_manager.py` (843 lines). A singleton created in
`app.py:L165` (`UserManager(config['SUPERADMINS'])`), exposed as `current_app.user_manager`, as the
Jinja global `user_manager`, and to plugins via `plugin_manager.get_user_manager()`.
Many methods default `username=None` to `session.username` (implicit dependency on the Flask session).
Models: `inginious/frontend/models/*.py` (mongoengine). Collections: `users`, `sessions`, `courses`
(CourseClass: `{_id: courseid, students: [username]}`), `audiences`, `groups`, `user_tasks`, `submissions`.

## Auth plugin interface
| Symbol | Lines | Behaviour |
|---|---|---|
| `AuthInvalidInputException`, `AuthInvalidMethodException` | L27-L32 | raised by `connect_user` (missing keys) / unknown hash method |
| `AuthMethod` (abstract) | L35-L72 | `get_id()`, `get_name()`, `get_imlink()` (raw HTML), `get_auth_link(auth_storage)` → URL, `callback(auth_storage)` → `(id, realname, email, additional)` or `None` — see AUTH-14 |
| `register_auth_method(m)` / `get_auth_method(id)` / `get_auth_methods()` | L104-L122 | OrderedDict registry keyed by `get_id()` (config order) |

## Users, authentication, accounts (AUTH area)
| Method | Lines | Behaviour |
|---|---|---|
| `sanitize_email(email)` (classmethod) | L84-L98 | regex validation (dot-atom or quoted local part, domain labels, TLD 2-6 letters, optional trailing dot), returns `local@domain.lower()` or `None` |
| `auth_user(username, password, do_connect=True)` | L124-L142 | `users.findOne({username, activate:{$exists:false}})`; hash prefix dispatch (`argon2id-`, `sha512-`, none = sha512); connects on success; returns User or None; unknown prefix raises |
| `verify_hash(db_hash, password, method)` / `verify_hash_sha512` / `verify_hash_argon2id` | L144-L169 | see AUTH-05 |
| `connect_user(user)` | L171-L201 | requires `realname,email,username`; `users.update({email},{$set:{realname,username,language}})`; fills session (`loggedin, email, username, realname, language, timezone, code_indentation, tos_signed, token=None`); logs connection |
| `disconnect_user()` | L203-L212 | `session.loggedin=False` (+log) |
| `get_users_info(usernames)` | L214-L223 | `{username: User or None}` |
| `get_user_info(username)` | L225-L230 | User or None |
| `get_user_realname(username)` / `get_user_email(username)` | L232-L250 | field or None |
| `get_user_api_key(username, create=True)` | L252-L266 | lazily generates `users.apikey` (80 hex, `os.urandom(40)`); raises if user missing (AUTH-19) |
| `activate_user(hash)` | L268-L274 | `findOneAndUpdate({activate:hash},{$unset:{activate}})` → bool (AUTH-07) |
| `bind_user(auth_id, (id, realname, email, additional))` | L276-L325 | sign-in / bind / create external account (AUTH-14) |
| `revoke_binding(username, binding_id)` | L327-L345 | → `(error: bool, msg)` (AUTH-12) |
| `delete_user(username, confirmation_email=None)` | L347-L364 | removes user (+email match if given), submissions containing username, user_tasks, unregisters from courses (AUTH-13; also used by superadmin user admin) |
| `create_user(values)` | L366-L379 | used by superadmin user admin: fails with "User could not be created." if username or email exists; creates `{username, realname, email, password: argon2id}` **without** activation, returns None on success |
| `generate_api_key()` | L811-L813 | `hexlify(os.urandom(40))` |
| `hash_password_sha512(s)` / `hash_password_argon2id(s)` / `hash_password(s)` | L815-L843 | `hash_password` → `"argon2id-" + PasswordHasher().hash(s)` |

## Rights (used by every area)
| Method | Lines | Behaviour |
|---|---|---|
| `user_is_superadmin(username=None)` | L775-L783 | `username in config.superadmins` |
| `has_admin_rights_on_course(course, username=None, include_superadmins=True)` | L785-L796 | `username in course.get_admins()` or superadmin |
| `has_staff_rights_on_course(course, username=None, include_superadmins=True)` | L798-L809 | `username in course.get_staff()` (admins + tutors) or superadmin |

## Course membership / access (documented in detail by the course areas)
| Method | Lines | Behaviour (summary) |
|---|---|---|
| `course_is_open_to_user(course, username, lti=None, return_reason=False)` | L692-L739 | staff → True; closed → `"closed"`; not registered & no preview → `"unregistered_not_previewable"`; `lti` True and course not LTI → `"lti_only"`; `lti` False & LTI course with grade send-back → `"lti_not_registered"`; `lti="auto"` uses `session.is_lti` |
| `course_is_user_registered(course, username=None)` | L741-L754 | staff → True; else `courses.findOne({_id, students: username})` |
| `get_course_registered_users(course, with_admins=True)` | L756-L769 | `courses.students` (+ staff) |
| `course_register_user(course, username=None, password=None, force=False)` | L640-L671 | refuses empty/unknown username; unless `force`: `course.is_registration_possible(user)` and registration password; refuses if already registered; `courses.update({_id},{$push:{students}}, upsert)` |
| `course_unregister_user(course_id, username=None)` | L673-L690 | `$pull` username from `audiences.students`, `groups.students`, `courses.students` |
| `get_course_audiences(course)` / `get_course_audiences_per_student(course)` | L610-L623 | natsorted by description / `{student: [audience]}` |
| `get_course_groups(course)` / `get_course_user_group(course, username=None)` | L625-L638 | natsorted groups / the user's group |
| `get_user_pinned_courses(username)` / `pin_course` / `unpin_course` | L505-L517 | `users.pinned_courses` add_to_set / pull |

## Task progress cache (documented by task/submission areas)
| Method | Lines | Behaviour (summary) |
|---|---|---|
| `get_course_cache(username, course)` / `get_course_caches(usernames, course)` | L385-L452 | aggregate `user_tasks` over readable tasks → `{username: {task_tried, total_tries, task_succeeded, task_grades:{taskid:grade}, grade}}` restricted to visible tasks; grade from task dispenser |
| `get_task_cache(username, courseid, taskid)` / `get_task_caches(...)` | L454-L489 | `{username: UserTask or None}` (note: crashes if `usernames is None`) |
| `user_saw_task(username, courseid, taskid)` | L491-L503 | upsert `user_tasks` with `tried:0, succeeded:false, grade:0.0, submissionid:null, state:""` |
| `update_user_stats(username, task, submission, result_str, grade, state, newsub, task_dispenser)` | L520-L552 | `newsub`: `$inc tried, tokens.amount`; default submission per evaluation mode (`best`/`last`); replay: recompute from best/last submission |
| `task_is_visible_by_user(course, task, username=None, lti=None)` | L554-L569 | (open to user and dispenser `after_start`) or staff |
| `task_can_user_submit(course, task, username=None, only_check=None, lti=None)` | L571-L607 | staff → True; course open, task open, group required for group tasks, submission tokens (`check_tokens`) — note: uses `session.username` (not `username`) for group/token checks |

## Gotchas for the rewrite
- Implicit `session` usage in many methods; the rewrite should pass the user explicitly.
- `users.username`/`users.email` indexes are not unique; e-mail compare is exact (case-sensitive local part).
- External-auth users may have `username: ""` (several at once).
- `delete_user` deletes shared group submissions.
- `connect_user` updates users **by e-mail** (all users sharing that e-mail!).
