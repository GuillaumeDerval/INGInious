/**
 * Marketplace course details (NAV-19), superadmin only: sanitized remote
 * description, license/authors/link and the import (then the course page).
 */
import { error } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { importAction, marketCourses, pick } from '#lib/server/nav/marketplace.js';
import { requireSuperadmin } from '#lib/server/security/guards.js';
import { renderText } from '#lib/server/text/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	requireSuperadmin(event);
	const c = (await marketCourses()).find((m) => m.id === event.params.courseid);
	if (!c) error(404, t('Course unavailable.'));
	const lang = event.locals.lang;
	const info = [
		[t('Language(s)'), c.languages],
		[t('License'), c.license],
		[t('Maintainer(s)'), c.maintainers],
		[t('Author(s)'), c.authors]
	];
	const description = renderText(pick(c, 'description', lang), { language: lang });
	return {
		id: c.id,
		name: pick(c, 'name', lang),
		description,
		info: info.filter(([, v]) => v),
		link: /^https:\/\//i.test(c.link) ? c.link : null
	};
};

export const actions: Actions = {
	default: (event) => importAction(event, event.params.courseid, (id) => `/course/${id}`)
};
