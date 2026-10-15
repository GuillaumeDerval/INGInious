# SAML2 SSO auth plugin

- **ID**: AUTH-17
- **Actors**: anonymous / logged-in user of a SAML identity provider (Shibboleth, ADFS…)
- **Routes**: `/auth/signin/<id>` (redirect to IdP), POST `/auth/callback/<id>` (ACS), GET `/auth/<id>/metadata` (SP metadata)
- **Depends on**: AUTH-14
- **Legacy code**: `legacy/inginious/frontend/plugins/auth/saml2_auth.py:L26-L171` (python3-saml `OneLogin_Saml2_Auth`)

## Use case
Universities federate authentication through SAML (e.g. eduGAIN/Shibboleth). INGInious acts as a
Service Provider. (Documented from code; no IdP available.)

## Preconditions
Plugin config = python3-saml settings dict plus INGInious keys:
```yaml
plugins:
  - plugin_module: inginious.frontend.plugins.auth.saml2_auth
    id: saml                # required
    name: University SSO    # default "SAML"
    imlink: /static/uni.png # optional
    strict: true
    sp: {entityId: ..., x509cert: ..., privateKey: ..., NameIDFormat: ...}   # assertionConsumerService is overwritten at runtime
    idp: {entityId: ..., singleSignOnService: {url, binding}, x509cert: ..., additionalX509certs: [ ... ]}
    security: {...}
    attributes:             # required for login to succeed
      uid: urn:oid:0.9.2342.19200300.100.1.1
      cn: urn:oid:2.5.4.3
      email: urn:oid:0.9.2342.19200300.100.1.3
    additional:             # optional extra attributes stored in the binding
      studentid: urn:...
```

## Main flow
1. `/auth/signin/<id>`: the SP settings get `sp.assertionConsumerService = {url: <base_url> + "/auth/callback/<id>", binding: HTTP-POST}` (per request, shared settings are not mutated), and the python3-saml request dict is built (https flag, host, port, path, GET/POST data, query string). `auth.login(return_to=<opaque RelayState key>)` → 302 to IdP; the auth storage (incl. `redir_url`) stays in the session.
2. IdP POSTs `SAMLResponse` + `RelayState` to `/auth/callback/<id>`.
3. First POST (no `alreadyRedirected`): returns a 200 auto-submitting HTML form re-posting `RelayState`, `SAMLResponse` (HTML-escaped) and `alreadyRedirected=yes` to the same URL — trick to get the session cookie sent (SameSite=Lax cookies are not sent on cross-site POST).
4. Second POST: `process_response()`; on "Signature validation failed. SAML Response rejected" retries with each `idp.additionalX509certs` certificate.
5. No errors and `attributes` configured: `username = attrs[uid][0]`, `realname = attrs[cn][0]`, `email = attrs[email][0]`, `additional = {field: attrs[urn][0] or ""}`; if `RelayState` matches the key stored in the session: return the tuple → AUTH-14 `bind_user`, redirect to the stored `redir_url`.
6. `GET /auth/<id>/metadata` → SP metadata XML (`text/xml`), or 500 with validation errors.

## Alternative / error flows
- Errors → logged "Errors while processing response : …", `None` → `/signin?callbackerror=`.
- No `attributes` key, or `RelayState` missing/unknown → `None` → callbackerror.
- Missing attribute in assertion → `KeyError` → 500.
- Unknown id in metadata URL → 500.

## Data
- `users.bindings.<id> = [<uid attribute>, {<additional field>: value}]` (only plugin filling `additional`; shown on the bindings page as `<id>.<key> : <value>`).

## Permissions & security
- `RelayState` is an opaque random key; the flow state (incl. `redir_url`, same-origin paths only) is stored server-side in the session.
- The ACS URL comes from the configured public base URL; per-request settings are never shared between requests.
- Response validation depends on python3-saml settings (`strict`, `wantAssertionsSigned`…) supplied by the operator.

## Acceptance tests
- (Rewrite, with a test IdP such as `kristophjunge/test-saml-idp` or a signed fixture response) full login creates user with `bindings.saml=[uid, {studentid: …}]`.
- First POST without `alreadyRedirected` returns the auto-submit form containing escaped `SAMLResponse`/`RelayState`.
- Response signed with an `additionalX509certs` certificate is accepted.
- Invalid signature → `/signin?callbackerror=`.
- `/auth/saml/metadata` returns valid SP metadata XML with ACS `<base>/auth/callback/saml`.
- A forged or unknown `RelayState` never causes an external redirect.
