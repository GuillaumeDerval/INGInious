# Registration access control lists (username / email / binding)

- **ID**: NAV-07
- **Actors**: student; course admin (configures it in course settings)
- **Routes**: none of its own — evaluated by /courselist, /mycourses, /course/<id>, /register/<id>
- **Depends on**: NAV-06, course settings feature (course admin), AUTH bindings
- **Legacy code**: `legacy/inginious/frontend/courses.py:L66-L70,L105-L106,L192-L202,L232-L249,L277-L279`, `pages/course_admin/settings.py:L80-L88`

## Use case
A teacher restricts self-enrollment to a population: specific usernames, an e-mail domain
(e.g. `*@uclouvain.be`), or users who linked a given authentication method (e.g. an SSO
binding), or conversely blocks some users.

## Preconditions
`registration_ac` set in `course.yaml` (`username`, `email` or `binding`).

## Main flow
1. At course load the list `registration_ac_list` is compiled into one regex: each entry is `re.escape`d, then `\*` is replaced by `.*`; entries are joined with `|`.
2. `is_user_accepted_by_access_control(user)`:
   - method `null` → true;
   - user is None (anonymous) → false;
   - keys: `username` → `[username]`; `email` → `[email]`; `binding` → `user.bindings.keys()` (e.g. `["github"]`; users without bindings have no key → never match);
   - `at_least_one` = any key `fullmatch`es the regex (case-sensitive);
   - result = `at_least_one` if `registration_ac_accept` (default true, allow-list) else `not at_least_one` (deny-list).
3. The result is part of `is_registration_possible`, which gates: the "Auto-registration" badge (NAV-01), the redirect to /register (NAV-05), the register form and POST (NAV-06), the "Enroll" link on previewable courses (NAV-15).
4. The ACL is only checked at registration time: already-registered students are never re-checked; staff are unaffected (always registered).

## Configuration (course settings page, for reference)
- `registration_ac`: select None/username/binding/email (`"None"` stored as `null`; other values → "Invalid ACL value").
- `registration_ac_accept`: "true" → accept list, otherwise deny list.
- `registration_ac_list`: textarea, one entry per line, each line stripped (empty lines kept as `""`).

## Alternative / error flows
- Invalid `registration_ac` value in YAML → course unloadable (exception "Course has an invalid value for registration_ac").
- Empty list + accept → nobody (except a user with an empty key) can register; empty list + deny → everybody.
- Pattern characters other than `*` are literal (`.` matches a dot only).

## Data
`course.yaml` keys `registration_ac`, `registration_ac_accept`, `registration_ac_list`; `users.username`, `users.email`, `users.bindings` (map auth_id → [external id, data]).

## Permissions & security
- Matching is case-sensitive: `Alice@OK.org` does not match `*@ok.org`. The email cannot be changed from the profile page (only set at sign-up / by an auth plugin); an email ACL relies on the e-mail verification done at sign-up (activation mail) or by the auth plugin.
- Usernames are chosen at sign-up, so a username allow-list is best used with exact names rather than broad patterns.
- Binding ACL checks binding ids only (any account bound to "github" passes).

## Acceptance tests (courses navacl / navdeny / navbind)
- navacl (`email`, accept, `["*@ok.org", "nav_bob@x.org"]`): nav_carol (nav_carol@ok.org) → /register/navacl shows the form; nav_bob (exact email) → form; nav_alice → redirect to course page "This course is closed.".
- navdeny (`username`, deny, `["nav_bob", "nav_c*"]`): nav_bob and nav_carol → redirect (refused); nav_alice → form.
- navbind (`binding`, accept, `["github"]`): nav_dave (bindings `{github: [...]}`) → form; nav_alice (no bindings) → refused.
- Anonymous: badge "Auto-registration" hidden for ACL courses.
- Unit: regex construction with `*` at start/middle/end, special chars escaped, case sensitivity, accept vs deny.
