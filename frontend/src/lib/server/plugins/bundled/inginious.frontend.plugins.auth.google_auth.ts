/**
 * Google sign-in (AUTH-15, legacy `google_auth`). Options: `id`, `name`
 * (default "Google"), `client_id`, `client_secret`, `domain`. When set,
 * `domain` is enforced: accounts of another Google Workspace domain are refused.
 */
import { oauthPlugin } from '../../auth/oauth.js';

/** Registers the Google auth method. */
export const init = oauthPlugin('google');
