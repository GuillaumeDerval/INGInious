/**
 * Facebook sign-in (AUTH-15, legacy `facebook_auth`). Options: `id`, `name`
 * (default "Facebook"), `client_id`, `client_secret`. Facebook does not report
 * whether the address is verified: a Facebook identity signs in to the account
 * bound to it, or is bound from the profile, but does not create accounts.
 */
import { oauthPlugin } from '../../auth/oauth.js';

/** Registers the Facebook auth method. */
export const init = oauthPlugin('facebook');
