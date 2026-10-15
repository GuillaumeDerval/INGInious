/**
 * Account self-deletion (AUTH-13), confirmed by typing the account e-mail
 * address. The account is the one of the session (by `_id`, see `deleteUser`).
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { services } from '#lib/server/app.js';
import { deleteUser } from '#lib/server/auth/accounts.js';
import { requireSession, sessionAccount } from '#lib/server/auth/profile.js';
import { parseForm } from '#lib/server/forms.js';
import type { GuardEvent } from '#lib/server/security/guards.js';
import type { Actions, PageServerLoad } from './$types';

/** Refuses the page when `allow_deletion` is false. */
function guard(event: GuardEvent) {
	const doc = requireSession(event);
	if (!services().config.allowDeletion) error(403, t('User unavailable or deletion is forbidden.'));
	return doc;
}

export const load: PageServerLoad = (event) => ({ email: guard(event).email ?? '' });

export const actions: Actions = {
	default: async (event) => {
		guard(event);
		const f = await parseForm(event.request, z.object({ delete_email: z.string() }));
		if (!(await deleteUser(await sessionAccount(event.locals.session), f.delete_email)))
			return fail(400, { message: t('The specified email is incorrect.') });
		await services().sessions.destroy(event.locals.session);
		redirect(303, '/');
	}
};
