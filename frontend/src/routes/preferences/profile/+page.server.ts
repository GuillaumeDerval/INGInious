/** Profile preferences (AUTH-09, AUTH-10, AUTH-11). */
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { services } from '#lib/server/app.js';
import { parseForm } from '#lib/server/forms.js';
import { requireSession, saveProfile, sessionAccount } from '#lib/server/auth/profile.js';
import { clientAddress } from '#lib/server/auth/rate-limit.js';
import { tosLinks } from '#lib/server/auth/static-pages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const doc = requireSession(event);
	const user = (await sessionAccount(event.locals.session)) ?? error(404, t('Incorrect email.'));
	const profile = {
		username: user.username,
		realname: user.realname,
		email: user.email,
		language: user.language || 'en',
		timezone: user.timezone ?? doc.timezone ?? 'UTC',
		codeIndentation: user.code_indentation ?? '4',
		hasPassword: !!user.password
	};
	const { allowRegistration, passwordMinLength } = services().config;
	return { profile, passwords: allowRegistration, passwordMinLength, tos: tosLinks(), tosSigned: !!doc.tos_signed };
};

const optional = z.string().optional();
const schema = z.object({
	username: optional,
	realname: z.string(),
	language: z.string(),
	timezone: z.string(),
	code_indentation: z.string(),
	oldpasswd: optional,
	passwd: optional,
	passwd2: optional,
	term_policy_check: optional
});

export const actions: Actions = {
	default: async (event) => {
		requireSession(event);
		const f = await parseForm(event.request, schema);
		return saveProfile(event.locals.session, { ...f, tos: !!f.term_policy_check }, clientAddress(event));
	}
};
