/**
 * LinkedIn sign-in (AUTH-15, legacy `linkedin_auth`). Options: `id`, `name`
 * (default "LinkedIn"), `client_id`, `client_secret`. The legacy
 * `r_liteprofile` API no longer exists: "Sign In with LinkedIn using OpenID
 * Connect" (`openid profile email` + userinfo) is used instead. Only an address
 * with `email_verified: true` may create an account.
 */
import { oauthPlugin } from '../../auth/oauth.js';

/** Registers the LinkedIn auth method. */
export const init = oauthPlugin('linkedin');
