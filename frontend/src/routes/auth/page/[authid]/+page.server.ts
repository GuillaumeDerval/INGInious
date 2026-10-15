/** Sign-in form of the form-based auth methods, i.e. LDAP (AUTH-16). */
import { error, fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { endAuth, finishAuth, requireMethod } from '#lib/server/auth/external.js';
import { authThrottle, clientAddress } from '#lib/server/auth/rate-limit.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** The form-based method of the URL, 404 otherwise. */
function formMethod(event: RequestEvent | Parameters<PageServerLoad>[0]) {
	const method = requireMethod(event.params.authid, event);
	return method.form ? method : error(404, t("Auth method doesn't exist"));
}

export const load: PageServerLoad = (event) => {
	const { name, imlink } = formMethod(event);
	return { name, imlink: imlink ?? null };
};

export const actions: Actions = {
	default: async (event) => {
		const method = formMethod(event);
		const form = await event.request.formData();
		// Failed LDAP binds are throttled per login and per client.
		const [client, account] = [clientAddress(event), `${method.id}:${String(form.get('login')).trim().toLowerCase()}`];
		if (authThrottle.blocked(client, account))
			return fail(429, { message: t('Too many requests, please retry later.') });
		const result = await finishAuth(event.locals.session, method, { url: event.url, form });
		if (!result.location) {
			authThrottle.failed(client, account);
			return fail(400, { message: t('Authentication failed: {}', result.error) });
		}
		endAuth(event.cookies, result);
	}
};
