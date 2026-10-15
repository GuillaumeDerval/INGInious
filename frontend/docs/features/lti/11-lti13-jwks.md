# LTI 1.3 tool JWKS endpoint

- **ID**: LTI-11
- **Actors**: LTI 1.3 platform (server-to-server), anonymous
- **Routes**: GET /lti1.3/jwks/<keyset_hash>, GET /lti1.3/jwks/<courseid>/<keyset_hash>
- **Depends on**: LTI-01 (configs)
- **Legacy code**: `legacy/inginious/frontend/pages/lti/v1_3/__init__.py:53-75` (`LTI13JWKSPage`),
  `legacy/inginious/frontend/lti/v1_3/__init__.py:21-38` (`lti_keyset_hash`, `lti_tool`),
  `legacy/inginious/frontend/flask/mapping.py:110-112`, PyLTI1p3 `Registration.get_jwk`

## Use case
Platforms configured with a "keyset URL" fetch the tool's public key from INGInious to
verify the tool's signed messages (deep-linking responses, AGS client assertions).

## Preconditions
- A client exists in the course config (if `<courseid>` given) or in the global config.

## Main flow
1. `<courseid>` given → `Course.get(courseid).lti_config()` (unknown course → 404;
   non-LTI course → `{}`); else `{}`.
2. Merge the global config with that dict into a new object (the course configuration is
   never modified).
3. For each issuer and client: if `keyset_hash == md5(issuer + client_id).hexdigest()` →
   `200 application/json` `{"keys": [jwk]}` with the client's public key, where `jwk` =
   jwcrypto export of the PEM + `"alg": "RS256"`, `"use": "sig"`; `kid` = RFC 7638 SHA-256
   thumbprint (base64url).
4. No match → 404 page "Keyset not found".

Live:
```
GET /lti1.3/jwks/9abc89657265a7a437fd1f9964506e8e      (md5("https://platform.example"+"tool-client-1"))
200 {"keys":[{"alg":"RS256","e":"AQAB","kid":"jK_d5dBcK5F6t6kPomoP_SOl9rRHoIdTNLx7nN2oKD0","kty":"RSA","n":"rXF_l9…","use":"sig"}]}
```
The course-scoped URL of a global client also works (`/lti1.3/jwks/lti_test/<hash>` →
200), as does a non-LTI course id (`/lti1.3/jwks/tutorial/<hash>` → 200).

## Alternative / error flows
- Bad hash → 404; unknown course → 404.

## UI elements
None (JSON). The URL is displayed in the course settings cards (LTI-01).

## Data
Reads course `lti_config` and global `lti_config`. No DB access.

## Permissions & security
- Public endpoint exposing only public keys.
- The endpoint never modifies any configuration: the course settings page (LTI-01) is
  unaffected by JWKS calls.

## Acceptance tests
- `md5(iss+client_id)` hash → JWKS with one RSA key, fields `alg, e, kid, kty, n, use`,
  `kid` = RFC 7638 thumbprint.
- Course-scoped and global variants; unknown hash/course → 404.
- Calling the endpoint any number of times does not change the course configuration.
