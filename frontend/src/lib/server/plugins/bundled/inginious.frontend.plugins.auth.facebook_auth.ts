/**
 * Facebook sign-in (AUTH-15, legacy `facebook_auth`). Options: `id`, `name`
 * (default "Facebook"), `client_id`, `client_secret`.
 */
import { oauthPlugin } from '../../auth/oauth.js';

/** Registers the Facebook auth method. */
export const init = oauthPlugin('facebook');
