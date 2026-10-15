/**
 * Tasks of one section of the course page, loaded when a section of a large
 * course is opened (NAV-10): `GET /course/<courseid>/$section?path=<path>`
 * answers the task rows as JSON (`$` never appears in task ids, so no task page
 * is shadowed). Same access rules as the page.
 */
import { error } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { requireCourseAccess } from '#lib/server/courses/access.js';
import { sectionItems } from '#lib/server/nav/courses.js';
import { forbidLti } from '#lib/server/security/guards.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	forbidLti(event);
	const { course, user } = await requireCourseAccess(event, event.params.courseid);
	const path = event.url.searchParams.get('path') ?? '';
	const tasks = await sectionItems(course, user?.username ?? null, event.locals.lang, path);
	if (!tasks) error(404, t('Not found'));
	return Response.json(tasks);
};
