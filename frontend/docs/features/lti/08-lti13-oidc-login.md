# LTI 1.3 OIDC third-party initiated login

- **ID**: LTI-08
- **Actors**: LTI 1.3 platform (via the user's browser)
- **Routes**: GET|POST /lti1.3/oidc_login, GET|POST /lti1.3/oidc_login/<courseid>
- **Depends on**: LTI-01 (course `lti_config`) / global `lti_config`, LTI-09 (next step)
- **Legacy code**: `legacy/inginious/frontend/pages/lti/v1_3/__init__.py:78-101` (`LTI13OIDCLoginPage`),
  `legacy/inginious/frontend/lti/v1_3/__init__.py:24-59` (`lti_tool`, `MongoLTILaunchDataStorage`),
  `legacy/inginious/frontend/flask/mapping.py:96-98`,
  PyLTI1p3 `oidc_login.py`, `cookies_allowed_check.py`, `contrib/flask/*`

## Use case
Every LTI 1.3 launch starts with the platform redirecting the browser to the tool's
*OIDC login initiation URL*; the tool answers with a redirect to the platform's
authorization endpoint carrying a `state` and a `nonce`, after which the platform posts a
signed `id_token` to the launch URL (LTI-09).

## Preconditions
- The issuer (and client id) is configured in the global `lti_config` or, when the URL
  contains `<courseid>`, in that course's `lti_config` (course must be LTI; non-LTI course
  → empty course config, global only).

## Main flow
Behaviour of the app (`app/src/lib/server/lti/lti13.ts`, `oidcLogin`); legacy differences
are noted at the end of the section.
1. `<courseid>` given → course lookup (unknown → 404). Tool config = the course
   registrations (LTI courses only; a registration of an `(iss, client_id)` declared
   elsewhere with other platform keys is ignored) followed by the global ones, merged
   into new objects.
2. Parameters: query string on GET, form on POST. `iss`, `login_hint` or
   `target_link_uri` missing → 400 "Invalid LTI login request.".
3. Registration: `client_id` given → matching client; else the only client of the issuer,
   else the one flagged `default: true`; none → 400 "Unknown LTI platform.".
4. First request (no `lti1p3_new_window` param): **200 text/html cookie-check page**
   ("Loading...", "Your browser prohibits to save cookies in the iframes." / "Click here
   to open content in the new tab."). Its JS sets a test cookie and, if it works,
   navigates with **GET** to the same path with all received parameters +
   `lti1p3_new_window=1`; otherwise it offers to open that URL in a new tab.
5. Second request (`lti1p3_new_window` present):
   - `state = "state-<uuid4>"`, cookie `lti1p3-<state>=<state>` (Max-Age 300, Path=/,
     HttpOnly; over https also `Secure; SameSite=None; Partitioned`, otherwise
     `SameSite=Lax`);
   - `nonce` = 48 random hex characters, saved in `lti_launch` as
     `{key: "lti1p3-nonce-<nonce>", value: <state>, expires: now + 1 h}`;
   - **302** to `auth_login_url?scope=openid&response_type=id_token&response_mode=form_post&prompt=none&client_id=…&redirect_uri=<target_link_uri>&state=…&nonce=…&login_hint=…[&lti_message_hint=…]`.

Legacy differences (functional): legacy answered missing parameters and unknown issuers
with 500 pages, checked `target_link_uri` before the cookie page, stored the nonce with
`value: true`, set the normal INGInious session cookie on the cookie-check page, and set
no SameSite attribute on the state cookie over http.

Verified live (legacy):
```
GET /lti1.3/oidc_login?iss=https%3A%2F%2Fplatform.example&login_hint=u1&target_link_uri=http%3A%2F%2Flocalhost%3A8093%2Flti1.3%2Flaunch&client_id=tool-client-1&lti_message_hint=abc&lti_deployment_id=dep-1&lti1p3_new_window=1
→ 302 Location: http://localhost:8094/auth?scope=openid&response_type=id_token&response_mode=form_post&prompt=none&client_id=tool-client-1&redirect_uri=http%3A%2F%2Flocalhost%3A8093%2Flti1.3%2Flaunch&state=state-040222ac-…&nonce=cd30be91…&login_hint=u1&lti_message_hint=abc
   Set-Cookie: lti1p3-state-040222ac-…=state-040222ac-…; Max-Age=300; HttpOnly; Path=/
```

## Alternative / error flows
- Unknown `<courseid>` → 404.
- Missing parameters → 400; unknown issuer or client → 400.
- POST initiation (platform form post) is supported; the cookie-check page then switches
  to GET with the parameters in the query string.
- `lti_deployment_id` is only forwarded, not checked here (the deployment is checked at
  launch, LTI-09).

## UI elements
Cookie-check HTML page (unstyled, translated texts).

## Data
- Writes `lti_launch` nonce documents (bound to the state, expiring after 1 h, consumed once by LTI-09).
- Sets cookie `lti1p3-state-…`.

## Permissions & security
- `redirect_uri` is the request's `target_link_uri`; the platform checks it against the
  redirect URIs registered for the tool (displayed in LTI-01).
- The nonce is random, bound to the `state`, which must match the state cookie of the
  browser that started the login; it is consumed once at launch (LTI-09).
- Over https the state cookie is `SameSite=None; Secure; Partitioned`, so the platform's
  cross-site form POST to `/lti1.3/launch` carries it; over plain http it is
  `SameSite=Lax`, so launches only work over https (or same-site hosts).

## Acceptance tests
- Missing `target_link_uri`, `iss` or `login_hint` → 400.
- First call without `lti1p3_new_window` → 200 HTML whose continuation URL contains
  `lti1p3_new_window=1` and the forwarded params.
- Second call → 302 to the platform auth URL with exactly the parameters above; state
  cookie set with 300 s lifetime; nonce document created.
- Unknown issuer → 400; issuer with two clients and no `client_id` → client flagged
  `default`.
- Course-specific URL uses course config + global config.
