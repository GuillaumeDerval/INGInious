/**
 * Starts the sign-in (or binding) flow of an external auth method (AUTH-14).
 * POST only: a GET cannot start a flow (login/linking CSRF). The form field
 * `redirect` is the same-site page to come back to.
 */
import { redirect } from '@sveltejs/kit';
import { requireMethod, startAuth } from '#lib/server/auth/external.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const method = requireMethod(event.params.authid, event);
	const target = (await event.request.formData()).get('redirect');
	redirect(303, await startAuth(event.locals.session, method, typeof target === 'string' ? target : null, event.url), {
		external: true
	});
};
