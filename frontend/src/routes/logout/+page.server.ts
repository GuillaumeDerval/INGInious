/**
 * Logout (AUTH-06): POST only (no state change on GET). The
 * session is deleted server-side and its cookie cleared; GET shows a
 * confirmation button.
 */
import { redirect } from '@sveltejs/kit';
import { services } from '#lib/server/app.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.session.doc.loggedin) redirect(303, '/signin');
};

export const actions: Actions = {
	default: async ({ locals }) => {
		await services().sessions.destroy(locals.session);
		redirect(303, '/courselist');
	}
};
