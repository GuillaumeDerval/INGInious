# LDAP auth plugin

- **ID**: AUTH-16
- **Actors**: anonymous / logged-in user with an institutional LDAP account
- **Routes**: `/auth/signin/<id>` → 302 `/auth/page/<id>`; GET/POST `/auth/page/<id>`
- **Depends on**: AUTH-14
- **Legacy code**: `legacy/inginious/frontend/plugins/auth/ldap_auth.py:L22-L171`, template `legacy/inginious/frontend/plugins/auth/custom_auth_form.html` (served with template prefix `ldap_auth/`)

## Use case
Users sign in with their campus LDAP username/password on an INGInious-hosted form; the account is
created/bound like any external method (documented from code; `ldap3` is not even installed in the
legacy Docker image — enabling the plugin makes the worker fail to boot with `ModuleNotFoundError: No module named 'ldap3'`).

## Preconditions
```yaml
plugins:
  - plugin_module: inginious.frontend.plugins.auth.ldap_auth
    id: ldap                  # required
    name: LDAP Login          # default "LDAP"
    imlink: /static/x.png     # optional image URL for button and form
    host: ldap.test.be
    port: 0                   # 0 or absent → None (library default)
    encryption: none          # none | ssl | tls (anything else → exception at start-up). ssl = implicit TLS, tls = StartTLS
    base_dn: o=test,c=be
    request: "(uid={})"       # search filter, {} replaced by escaped login
    bind_dn: "uid={},ou=People,o=test,c=be"   # optional: initial bind as the user ({} replaced by the DN-escaped login)
    auto_bind: true           # optional, default true
    cn: cn                    # attribute for real name (default "cn")
    mail: mail                # attribute for e-mail (default "mail")
```

## Main flow
1. Button → `/auth/signin/<id>` stores `redir_url` (Referer) and 302 to `/auth/page/<id>`.
2. `GET /auth/page/<id>` → `custom_auth_form.html`: breadcrumb with `settings.name`, image `imlink` (max-width 150px), form `login`, `password`, "Sign in".
3. `POST`: `login = form.login.strip().lower()`, `password`.
   1. `password.rstrip() == ""` → "Authentication failed: Empty password" (prevents anonymous bind).
   2. Connect `ldap3.Connection(Server(host, port, use_ssl=encryption=='ssl', get_info=ALL), auto_bind, [user=bind_dn.format(<DN-escaped login>), password])` (StartTLS first when `encryption: tls`) → `LDAPException` → "Cannot contact host".
   3. Search `base_dn` with `request.format(escape_filter_chars(login))`, attributes `[cn, mail]`; no result → "Unknown user".
   4. `conn.rebind(user_dn, password)` success → e-mail = attr mail (first if list), realname = attr cn (first if list), username = login. Missing attribute → "Can't get field <name> from your LDAP server".
   5. `bind_user(id, (login, realname, email, {}))` → false → 302 `/signin?binderror=`; true → 302 `auth_storage[id].redir_url` or `/`.
   6. Rebind failure → "Incorrect password".

## Alternative / error flows
- Unknown `<id>` in `/auth/page/<id>` → `AttributeError` → 500.
- Error messages displayed as red alert "Authentication failed: <error>".

## Data
- `users.bindings.<id> = [<lowercased login>, {}]`. LDAP login is not the INGInious username (user picks one on the profile page on first sign-in).

## Permissions & security
- The login is DN-escaped in `bind_dn` and filter-escaped in `request`.
- `encryption: tls` performs StartTLS before any bind.
- The plugin form POST is protected by the origin check (CORE-04).
- Failed LDAP sign-ins are rate-limited per login and per client (answer 429 "Too many requests, please retry later." once over the limit).
- Login lower-cased → bindings are case-insensitive.

## Acceptance tests
- (Rewrite, with a test LDAP server e.g. `bitnami/openldap` container) valid credentials → user created with empty username and `bindings.ldap=[login,{}]`, redirect to `redir_url`.
- Empty password → "Empty password"; unknown user → "Unknown user"; wrong password → "Incorrect password"; unreachable host → "Cannot contact host".
- Login `"  Alice "` → binding id `alice`.
- Filter escaping: login `*)(uid=*` is escaped (no wildcard match); a login with DN special characters (`,`, `+`, `=`) is escaped in `bind_dn`.
- `encryption: tls` performs StartTLS.
