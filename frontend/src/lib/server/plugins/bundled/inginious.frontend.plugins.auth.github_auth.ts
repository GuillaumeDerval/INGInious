/**
 * GitHub sign-in (AUTH-15, legacy `github_auth`). Options: `id`, `name`
 * (default "Github"), `client_id`, `client_secret`. The e-mail is the primary
 * *verified* address of the account.
 */
import { oauthPlugin } from '../../auth/oauth.js';

/** Registers the GitHub auth method. */
export const init = oauthPlugin('github');
