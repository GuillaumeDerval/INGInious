/** Authentication bindings (AUTH-12): list, add (starts the provider flow) and revoke. */
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { parseForm } from '#lib/server/forms.js';
import { authMethods, revokeBinding, startAuth } from '#lib/server/auth/external.js';
import { requireSession, sessionAccount } from '#lib/server/auth/profile.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	requireSession(event);
	const bound = (await sessionAccount(event.locals.session))?.bindings ?? {};
	const bindings = Object.entries(bound).map(([id, [identifier, additional]]) => ({
		id,
		name: authMethods.get(id)?.name ?? id,
		identifier: String(identifier),
		additional: Object.entries((additional ?? {}) as Record<string, unknown>).map(([k, v]): [string, string] => [
			k,
			String(v)
		]),
		configured: authMethods.has(id)
	}));
	const available = [...authMethods.values()]
		.filter((m) => !Object.hasOwn(bound, m.id))
		.map(({ id, name }) => ({ id, name }));
	return { bindings, available };
};

export const actions: Actions = {
	add: async (event) => {
		requireSession(event);
		const method = authMethods.get(
			(await parseForm(event.request, z.object({ auth_binding: z.string() }))).auth_binding
		);
		if (!method) return fail(400, { message: t('Incorrect authentication binding.') });
		redirect(303, await startAuth(event.locals.session, method, '/preferences/bindings', event.url), {
			external: true
		});
	},
	revoke: async (event) => {
		requireSession(event);
		const f = await parseForm(event.request, z.object({ revoke_auth_binding: z.string() }));
		const message = await revokeBinding(await sessionAccount(event.locals.session), f.revoke_auth_binding);
		return message ? fail(400, { message }) : { message: t('Binding removed.') };
	}
};
