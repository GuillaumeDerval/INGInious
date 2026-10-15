# Per-user API key (WebDAV password)

- **ID**: AUTH-19
- **Actors**: course admin / superadmin (WebDAV client)
- **Routes**: none of its own; displayed on `/admin/<courseid>/tasks`; consumed by the WebDAV server (port 8081 in the test env)
- **Depends on**: WebDAV feature (other area), course admin task list page
- **Legacy code**: `legacy/inginious/frontend/user_manager.py:L252-L266` (`get_user_api_key`), `L811-L813` (`generate_api_key`), `legacy/inginious/frontend/webdav.py:L54-L74`, `legacy/inginious/frontend/templates/course_admin/task_list.html:L79`, `legacy/inginious/frontend/models/user.py:L21`

## Use case
Course administrators edit course files through WebDAV using their username and a generated secret
(the "API key") rather than their account password (which external-auth users do not even have).

## Preconditions
- User exists.

## Main flow
1. Whenever the key is requested with `create=True` (task list page of a course admin, WebDAV auth attempt) and `users.apikey` is absent/null, generate `hexlify(os.urandom(40))` (80 hex chars) and save it.
2. The task list page shows a table with WebDAV URL, username and "Password" `<code>{apikey}</code>`.
3. WebDAV basic auth: user must be admin of the realm (course) and the password must equal `apikey` (constant-time comparison). The WebDAV server accepts Basic auth with an existing key only.

## Alternative / error flows
- There is **no UI to regenerate/revoke** the key (the profile page has no API-key field). Rewrite may add regeneration, but must keep `users.apikey` format.
- Unknown username → `User.objects.get` raises `DoesNotExist` (500 in callers).

## Data
- `users.apikey`: str (80 lowercase hex chars) or absent/null.
- Example: `apikey: '377f8cfdcc…136cb90754078a694238'`.

## Permissions & security
- The key is stored in `users.apikey` (DB compatibility) and compared in constant time; failed WebDAV authentications are rate-limited per account and per client.
- It is shown only to its owner, on their course admin task list page.
- Only admins of the requested course are granted WebDAV access (see WebDAV docs).

## Acceptance tests
- Admin opens `/admin/<course>/tasks` without `apikey` → DB gets an 80-hex `apikey`, page shows it; second visit shows the same key.
- WebDAV basic auth with username + apikey succeeds for a course admin, fails for a non-admin and with a wrong key.
