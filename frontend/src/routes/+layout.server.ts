/**
 * Root server load: exposes the current user, the UI language and the few
 * configuration values the application shell needs (CORE-01). Only
 * explicitly selected, non-sensitive fields are sent to the browser — never
 * the configuration object itself.
 */
import { services } from '#lib/server/app.js';
import { takeFlash } from '#lib/server/flash.js';
import { tosLinks } from '#lib/server/auth/static-pages.js';
import pkg from '../../package.json' with { type: 'json' };
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, cookies }) => {
	const { config } = services();
	return {
		user: locals.user,
		lang: locals.lang,
		isLti: locals.session.doc.is_lti,
		/** Timezone/indentation of the session (also set for anonymous visitors). */
		timezone: locals.user?.timezone ?? locals.session.doc.timezone ?? 'UTC',
		codeIndentation: locals.user?.codeIndentation ?? locals.session.doc.code_indentation ?? '4',
		version: pkg.version,
		allowRegistration: config.allowRegistration,
		// Legacy IS_TOS_DEFINED: the link is shown only when both pages exist.
		privacyHref: tosLinks()?.privacy ?? null,
		flash: takeFlash(cookies),
		// CORE-06: public DSN of the optional Sentry browser error reporting.
		sentryDsn: config.sentryIoUrl ?? null
	};
};
