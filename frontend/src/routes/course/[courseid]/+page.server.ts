/**
 * Course page (NAV-09..15): description, task list (large courses: some
 * sections are loaded when opened, see ./$section/+server.ts) and grade for the user,
 * preview for non-registered visitors (NAV-15), and unregistration (NAV-08).
 * Access rules (redirect to /register, 403 explanations, 404) come from
 * `requireCourseAccess` (NAV-05).
 */
import { fail, redirect } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { isOpen } from '#lib/server/courses/accessible.js';
import { aclUser, isRegistrationPossible, requireCourseAccess } from '#lib/server/courses/access.js';
import { allCategories } from '#lib/server/courses/dispenser.js';
import { unregisterUser } from '#lib/server/courses/members.js';
import { courseName, courseTasks, lastTried } from '#lib/server/nav/courses.js';
import { forbidLti } from '#lib/server/security/guards.js';
import { renderText } from '#lib/server/text/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	forbidLti(event);
	const { course, user, registered, staff } = await requireCourseAccess(event, event.params.courseid);
	const lang = event.locals.lang;
	const username = user?.username ?? null;
	const { sections, grade, succeeded, total } = await courseTasks(course, username, lang);
	const description = course.description ? renderText(course.tr(lang, course.description), { language: lang }) : null;
	const canRegister = !!user && !registered && isRegistrationPossible(course, await aclUser(username));
	const tried = registered ? await lastTried(username!, [course], lang) : [];
	return {
		course: { id: course.id, name: courseName(course, lang), description, categories: allCategories(course.dispenser) },
		anonymous: !user,
		registered,
		staff,
		hidden: staff && !isOpen(course.accessible),
		canUnregister: registered && !staff && course.allowUnregister,
		canRegister,
		sections,
		grade,
		succeeded,
		total,
		lastTried: tried
	};
};

export const actions: Actions = {
	/** Leaves the course, keeping the submissions (NAV-08); refused for staff and when not allowed. */
	unregister: async (event) => {
		const { course, user, registered, staff } = await requireCourseAccess(event, event.params.courseid);
		if (!registered || staff || !course.allowUnregister)
			return fail(403, { message: t('You are not allowed to do that.') });
		await unregisterUser(course.id, user!.username);
		redirect(303, '/mycourses');
	}
};
