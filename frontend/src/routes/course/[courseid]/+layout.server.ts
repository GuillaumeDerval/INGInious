/**
 * Course layout (NAV-09): only contributes the course section of the
 * sidebar, headed by a context card (the course, linking to its page) like
 * the administration layout (docs/design-system.md, "Navigation"). It never fails (pages, including the task pages, apply their own
 * access rules) and shows nothing for courses the user cannot access, so
 * that error pages do not reveal course names.
 */
import { courseIsOpenToUser } from '#lib/server/courses/access.js';
import { findCourse } from '#lib/server/courses/course.js';
import { courseNav } from '#lib/server/nav/courses.js';
import { t } from '#lib/i18n/index.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	const course = findCourse(params.courseid);
	const username = locals.user?.username ?? null;
	if (!course || (await courseIsOpenToUser(course, username, Boolean(locals.session.doc.is_lti))) !== true) return {};
	const [{ title, items }] = await courseNav(course, username, locals.lang);
	return { nav: [{ title, context: t('Course'), contextHref: `/course/${course.id}`, items: [] }, { items }] };
};
