# OAuth2 auth plugins: GitHub, Google, Facebook, LinkedIn

- **ID**: AUTH-15
- **Actors**: anonymous / logged-in user
- **Routes**: `/auth/signin/<id>`, `/auth/callback/<id>` (AUTH-14)
- **Depends on**: AUTH-14
- **Legacy code**: `legacy/inginious/frontend/plugins/auth/github_auth.py:L16-L69`, `google_auth.py:L17-L79`, `facebook_auth.py:L17-L70`, `linkedin_auth.py:L16-L73` (all use `requests_oauthlib.OAuth2Session`)

## Use case
Let users sign in with a social/Google Workspace account (documented from code only; real providers unreachable in the test environment — redirect URLs verified for GitHub and Google).

## Preconditions
Plugin entry in config, e.g.
```yaml
plugins:
  - plugin_module: inginious.frontend.plugins.auth.github_auth   # or google_auth, facebook_auth, linkedin_auth
    id: github            # required: used in URLs and bindings
    name: Github          # optional display name (defaults: Github, Google, Facebook, LinkedIn)
    client_id: ...
    client_secret: ...
    debug: false          # legacy option (allowed an http callback); ignored by the new app
    domain: example.org   # google only: passed as `hd` parameter
```

## Main flow (common)
1. `get_auth_link`: `OAuth2Session(client_id, scope, redirect_uri=<base_url> + "/auth/callback/<id>")`, `authorization_url(base)` → stores `auth_storage.oauth_state = state`, returns the URL (`response_type=code`).
2. `callback`: new session with stored `state`; `fetch_token(token_url, client_secret, authorization_response=request.url)` (validates `state`); fetch profile; return tuple. Any exception inside → `None` (→ callbackerror).

| Provider | authorize URL | token URL | scope | profile → (id, realname, email, additional) |
|---|---|---|---|---|
| GitHub | `https://github.com/login/oauth/authorize` | `https://github.com/login/oauth/access_token` | `user:email` | `GET https://api.github.com/user` → `str(id)`, `name` or `login` if empty; e-mail = the primary verified entry of `GET /user/emails`; `{}` |
| Google | `https://accounts.google.com/o/oauth2/v2/auth` (+`hd=<domain>`) | `https://www.googleapis.com/oauth2/v4/token` | `…/auth/userinfo.email`, `…/auth/userinfo.profile`, `openid` | `GET https://www.googleapis.com/oauth2/v3/userinfo` → `sub`, `name`, `email`; `{}` |
| Facebook | `https://www.facebook.com/dialog/oauth` | `https://graph.facebook.com/oauth/access_token` | `public_profile`, `email` | `GET https://graph.facebook.com/me?fields=id,name,email` → `id`, `name`, `email`; `{}` (uses `facebook_compliance_fix`; stores new state) |
| LinkedIn | `https://www.linkedin.com/oauth/v2/authorization` | `https://www.linkedin.com/oauth/v2/accessToken` (`include_client_id=True`) | `r_liteprofile`, `r_emailaddress` | `GET https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)` + `clientAwareMemberHandles…` → `id`, `"First Last"`, first EMAIL handle; `{}` |

- Icons (`get_imlink`): GitHub `<i class="fa fa-github" style="font-size:50px; color:#24292e;">`; Google `<img src="/static/icons/google-icon.svg" … width:50px; height:50px;>`; Facebook `fa-facebook-square` `#4267b2`; LinkedIn `fa-linkedin-square` `#008CC9`.

## Alternative / error flows
- Callback without stored `oauth_state` → `KeyError` before the try → 500.
- Provider denies / token exchange fails / missing field → `None` → `/signin?callbackerror=`.
- Google with `domain` set: an account whose returned `hd` claim / e-mail domain differs → `None` → `/signin?callbackerror=`.
- LinkedIn `r_liteprofile` API is deprecated by LinkedIn (plugin probably broken today; parity optional — flag to product owner).

## Data
- `sessions.auth_storage.<id>.oauth_state`; `users.bindings.<id> = [<provider id as str>, {}]`.

## Permissions & security
- The `state` (and, for Google, the PKCE verifier) is stored in the server-side session and checked at the callback.
- `redirect_uri` is built from the configured public base URL (and must match the URI registered at the provider).
- Only the primary verified GitHub e-mail is used.
- Google `hd` is enforced server-side when `domain` is set (the `hd` claim of the userinfo must equal `domain`), and Google accounts whose e-mail is reported unverified are refused.
- Provider tokens are not stored (only used once).

## Acceptance tests
- GitHub/Google: `/auth/signin/<id>` 302 URL contains exactly the authorize URL, `client_id`, `redirect_uri=<base>/auth/callback/<id>`, the scopes above, `state`; Google contains `hd=<domain>` when configured.
- Mocked provider (rewrite integration test): token + profile endpoints returning sample JSON → user created/bound as in AUTH-14 with `bindings.<id>[0]` = provider id string.
- Token endpoint error → `/signin?callbackerror=`.
- Google with `domain` set rejects accounts from another domain; GitHub uses the primary verified e-mail.
