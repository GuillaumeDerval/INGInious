/**
 * Sign-in page (AUTH-05). `?redirect=` (same-site paths only) is the page to
 * open after login. Logged-in visitors are sent there directly, or to the
 * profile while their external account has no username yet.
 */
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { services } from '#lib/server/app.js';
import { safeRedirectTarget } from '#lib/server/security/guards.js';
import { authenticate, connectUser } from '#lib/server/auth/accounts.js';
import { clientAddress } from '#lib/server/auth/rate-limit.js';
import { parseForm } from '#lib/server/forms.js';
import { methodList } from '#lib/server/auth/external.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const target = safeRedirectTarget(url.searchParams.get('redirect'));
	if (locals.session.doc.loggedin) redirect(303, locals.session.doc.username ? target : '/preferences/profile');
	return { redirect: target, passwordForm: services().config.allowRegistration, methods: methodList() };
};

const schema = z.object({ login: z.string(), password: z.string(), redirect: z.string().optional() });

export const actions: Actions = {
	default: async (event) => {
		const { request, locals } = event;
		const form = await parseForm(request, schema);
		const user = await authenticate(form.login, form.password, clientAddress(event));
		if (!user) return fail(400, { message: t('Invalid login/password'), login: form.login });
		await connectUser(locals.session, user);
		redirect(303, safeRedirectTarget(form.redirect));
	}
};
