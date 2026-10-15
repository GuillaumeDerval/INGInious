/**
 * "My courses" dashboard (NAV-02): the user's courses with their progress,
 * server-side search (`?q=`), filter chips (`?filter=`) and pagination
 * (`?page=`, progress computed for the page only), pins (NAV-03), last tried exercises (NAV-21) and, for superadmins, the
 * creation of a new course (NAV-04 / CADM-01).
 */
import { fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { createCourse } from '#lib/server/courses/course.js';
import { pinCourse, pinnedCourses, unpinCourse } from '#lib/server/courses/members.js';
import { lastTried, mainMenu, MY_FILTERS, myCourses, userCourses, type MyFilter } from '#lib/server/nav/courses.js';
import { forbidLti, requireSuperadmin, requireUser } from '#lib/server/security/guards.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	forbidLti(event);
	const { username } = requireUser(event);
	const lang = event.locals.lang;
	const courses = await userCourses(username, lang);
	const params = event.url.searchParams;
	const q = params.get('q') ?? '';
	const filter = (MY_FILTERS as readonly string[]).includes(params.get('filter')!)
		? (params.get('filter') as MyFilter)
		: '';
	return {
		...(await myCourses(username, courses, lang, { q, filter, page: params.get('page') })),
		q,
		filter,
		total: courses.length,
		lastTried: await lastTried(username, courses, lang),
		superadmin: event.locals.user!.superadmin,
		nav: await mainMenu()
	};
};

export const actions: Actions = {
	/** Toggles the pin of one of the user's courses (unknown or foreign courses are refused, NAV-03). */
	pin: async (event) => {
		forbidLti(event);
		const { username } = requireUser(event);
		const courseid = String((await event.request.formData()).get('courseid'));
		if (!(await userCourses(username, event.locals.lang)).some((c) => c.id === courseid))
			return fail(404, {
				message: t(
					'Something went wrong when pinning/unpinning your course. If the issue persists please contact an administrator.'
				)
			});
		if ((await pinnedCourses(username)).includes(courseid)) await unpinCourse(username, courseid);
		else if (!(await pinCourse(username, courseid)))
			return fail(400, { message: t('You are not allowed to have more than 6 pinned courses.') });
	},
	/** Creates an empty hidden course; invalid or existing ids are refused (NAV-04, CADM-01). */
	create: async (event) => {
		requireSuperadmin(event);
		try {
			const id = String((await event.request.formData()).get('new_courseid') ?? '');
			createCourse(id, { accessible: false, name: id }); // legacy key order (sorted)
		} catch {
			return fail(400, { message: t('Failed to create the course.') });
		}
		return { message: t('Course created.') };
	}
};
