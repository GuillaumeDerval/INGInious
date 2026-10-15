/**
 * Registration, activation, lost password and password reset (AUTH-07,
 * AUTH-08), only for anonymous visitors when `allow_registration` is true.
 * Opening an activation link has no side effect: the account is
 * activated by the button of the page (POST). Successful activations and
 * resets lead to the sign-in page.
 */
import { error, redirect, type ActionFailure, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { services } from '#lib/server/app.js';
import { setFlash } from '#lib/server/flash.js';
import { activate, register, requestReset, resetPassword, resetUser } from '#lib/server/auth/accounts.js';
import { parseForm } from '#lib/server/forms.js';
import { tosLinks } from '#lib/server/auth/static-pages.js';
import type { Actions, PageServerLoad } from './$types';
import { clientAddress } from '#lib/server/auth/rate-limit.js';

/** Refuses logged-in users and instances without self-registration; returns the posted form when given a schema. */
async function guard<S extends z.ZodType>(event: RequestEvent, schema: S) {
	if (event.locals.session.doc.loggedin || !services().config.allowRegistration)
		error(403, t("You're not allow to register."));
	return event.request.method === 'POST' ? parseForm(event.request, schema) : (null as z.infer<S>);
}

/** Back to the sign-in page with the success message, or the failure. */
function toSignin<T extends object>(event: RequestEvent, result: ActionFailure<T> | { message: string }) {
	if (!('message' in result)) return result;
	setFlash(event.cookies, 'success', result.message);
	redirect(303, '/signin');
}

export const load: PageServerLoad = async (event) => {
	await guard(event, z.any());
	const [activate, token] = ['activate', 'reset'].map((k) => event.url.searchParams.get(k));
	const user = token ? await resetUser(token) : null;
	return {
		tos: tosLinks(),
		activate,
		reset: user && { token: token!, realname: user.realname, username: user.username },
		invalidReset: !!token && !user
	};
};

const passwords = { passwd: z.string(), passwd2: z.string() };
const registration = z.object({
	username: z.string(),
	realname: z.string(),
	email: z.string(),
	...passwords,
	term_policy_check: z.string().optional()
});

export const actions: Actions = {
	register: async (event) => {
		const f = await guard(event, registration);
		return register({ ...f, tos: !!f.term_policy_check }, event.locals.lang, event.url, clientAddress(event));
	},
	activate: async (event) =>
		toSignin(event, await activate((await guard(event, z.object({ activate: z.string() }))).activate)),
	lostpasswd: async (event) =>
		requestReset(
			(await guard(event, z.object({ recovery_email: z.string() }))).recovery_email,
			event.url,
			clientAddress(event)
		),
	resetpasswd: async (event) => {
		const f = await guard(event, z.object({ reset: z.string(), ...passwords }));
		return toSignin(event, await resetPassword(f.reset, f.passwd, f.passwd2));
	}
};
