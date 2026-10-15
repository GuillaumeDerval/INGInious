/**
 * /administrator/users (SITE-01..05): superadmin user administration. The list
 * is read with GET (`?page=&q=`); every change is a POST form action, guarded
 * by `requireSuperadmin` and protected by the origin check. Accounts
 * are designated by their (non-empty) username; a superadmin cannot delete
 * his own account here (checked server side, not only hidden in the table).
 */
import { fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { services } from '#lib/server/app.js';
import { deleteUser } from '#lib/server/auth/accounts.js';
import { revokeBinding } from '#lib/server/auth/external.js';
import { parseForm } from '#lib/server/forms.js';
import { requireSuperadmin } from '#lib/server/security/guards.js';
import { activateUser, createUser, listUsers } from '#lib/server/site/users.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const me = requireSuperadmin(event);
	const q = event.url.searchParams.get('q') ?? '';
	const { passwordMinLength } = services().config;
	return {
		...(await listUsers(Number(event.url.searchParams.get('page') ?? 1), q)),
		q,
		me: me.username,
		passwordMinLength
	};
};

const target = z.object({ username: z.string().min(1), binding_id: z.string().default('') });
const newUser = z.object({ username: z.string(), realname: z.string(), email: z.string(), password: z.string() });
/** The account named by a form. */
const account = (username: string) => services().db.c.users.findOne({ username });

/**
 * Builds a superadmin form action: parses the form with `schema` (400 when
 * invalid), runs `op` and answers with its error (`status`) or `success`.
 */
function action<S extends z.ZodType>(
	schema: S,
	op: (f: z.infer<S>) => Promise<string | null>,
	success: string,
	status = 400
) {
	return async (event: RequestEvent) => {
		requireSuperadmin(event);
		const error = await op(await parseForm(event.request, schema));
		return error ? fail(status, { message: error }) : { message: t(success) };
	};
}

export const actions: Actions = {
	/** SITE-02 */
	add: action(newUser, createUser, 'User created.'),
	/** SITE-03 */
	delete: async (event) => {
		const me = requireSuperadmin(event);
		const f = await parseForm(event.request, target);
		if (f.username === me.username) return fail(403, { message: t('You cannot delete your own account here.') });
		if (!(await deleteUser(await account(f.username))))
			return fail(404, { message: t('Impossible to delete this user') });
		return { message: t('User deleted.') };
	},
	/** SITE-04 */
	activate: action(
		target,
		async (f) => ((await activateUser(f.username)) ? null : t('User not found')),
		'User activated.',
		404
	),
	/** SITE-05 */
	revoke: action(target, async (f) => revokeBinding(await account(f.username), f.binding_id), 'Binding revoked.')
};
