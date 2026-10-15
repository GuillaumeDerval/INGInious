/**
 * Language switch (AUTH-10): POST-only action storing the chosen language in
 * the session, then going back to the page the user came from.
 *
 * The language is only changed by this POST action (no state change on GET),
 * only whitelisted codes are accepted and the return target is restricted to
 * same-site paths.
 */
import { redirect } from '@sveltejs/kit';
import { LANGUAGES } from '#lib/i18n/index.js';
import { services } from '#lib/server/app.js';
import { safeRedirectTarget } from '#lib/server/security/guards.js';
import type { Actions, PageServerLoad } from './$types';

/** GET /language has nothing to show: go home. */
export const load: PageServerLoad = () => redirect(303, '/');

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const language = String(form.get('language') ?? '');
		if (Object.hasOwn(LANGUAGES, language) && language !== locals.session.doc.language) {
			locals.session.doc.language = language;
			services().sessions.markDirty(locals.session);
		}
		redirect(303, safeRedirectTarget(form.get('redirect') as string | null, '/'));
	}
};
