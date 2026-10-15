/**
 * Course marketplace (NAV-18), superadmin only: list of the shared courses
 * and their import (then the new course administration page).
 */
import { importAction, marketCourses, pick } from '#lib/server/nav/marketplace.js';
import { requireSuperadmin } from '#lib/server/security/guards.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	requireSuperadmin(event);
	const lang = event.locals.lang;
	return {
		courses: (await marketCourses()).map((c) => ({
			id: c.id,
			name: pick(c, 'name', lang),
			shortDesc: pick(c, 'short_desc', lang)
		}))
	};
};

export const actions: Actions = { default: (event) => importAction(event, null, (id) => `/admin/${id}`) };
