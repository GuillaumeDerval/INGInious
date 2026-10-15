/**
 * Public course list (NAV-01): the courses currently open matching the search
 * `?q=` (name or id), one page at a time (`?page=`, `COURSES_PER_PAGE` cards:
 * only the courses of the page are rendered), with their badges and
 * call-to-action for the viewer (anonymous visitors included) and the `main_menu` entries.
 */
import { aclUser } from '#lib/server/courses/access.js';
import { pageSlice } from '#lib/server/pagination.js';
import {
	COURSES_PER_PAGE,
	courseCard,
	mainMenu,
	publicCourses,
	searchCourses,
	userCourses
} from '#lib/server/nav/courses.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = await aclUser(locals.user?.username);
	const mine = new Set(user ? (await userCourses(user.username, locals.lang)).map((c) => c.id) : []);
	const q = url.searchParams.get('q') ?? '';
	const found = searchCourses(publicCourses(locals.lang), q, locals.lang);
	const { page, pages, skip, limit } = pageSlice(found.length, url.searchParams.get('page'), COURSES_PER_PAGE);
	return {
		courses: found.slice(skip, skip + limit).map((c) => courseCard(c, locals.lang, user, mine.has(c.id))),
		q,
		count: found.length,
		page,
		pages,
		loggedIn: !!locals.user,
		nav: await mainMenu()
	};
};
