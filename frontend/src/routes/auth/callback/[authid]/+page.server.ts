/**
 * Callback of the external auth methods (AUTH-14): GET for OAuth providers,
 * POST for SAML (assertion consumer service). A SAML response posted by the
 * identity provider is first re-posted by the page itself, so that the
 * SameSite=Lax session cookie is sent with it (legacy `alreadyRedirected` trick).
 */
import { endAuth, finishAuth, requireMethod } from '#lib/server/auth/external.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	// After a POST, the page is only rendered to re-post the SAML response.
	if (event.request.method !== 'GET') return {};
	const method = requireMethod(event.params.authid, event);
	endAuth(event.cookies, await finishAuth(event.locals.session, method, { url: event.url, form: null }));
};

export const actions: Actions = {
	default: async (event) => {
		const method = requireMethod(event.params.authid, event);
		const form = await event.request.formData();
		if (!form.has('alreadyRedirected'))
			return {
				repost: {
					SAMLResponse: String(form.get('SAMLResponse') ?? ''),
					RelayState: String(form.get('RelayState') ?? '')
				}
			};
		endAuth(event.cookies, await finishAuth(event.locals.session, method, { url: event.url, form }));
	}
};
