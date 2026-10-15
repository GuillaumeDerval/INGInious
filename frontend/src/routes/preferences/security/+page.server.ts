/**
 * Security preferences (AUTH-04): "Log out other sessions" closes every other
 * session of the account (other browsers and devices); the current one stays open.
 */
import { t } from '#lib/i18n/index.js';
import { closeOtherSessions, requireSession } from '#lib/server/auth/profile.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	requireSession(event);
};

export const actions: Actions = {
	default: async (event) => {
		requireSession(event);
		await closeOtherSessions(event.locals.session);
		return { message: t('Your other sessions have been logged out.') };
	}
};
