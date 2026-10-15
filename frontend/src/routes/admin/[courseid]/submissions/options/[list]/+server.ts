/**
 * Suggestions of the long choice lists of the submission query form (CSTU-11/17, scale):
 * `GET /admin/<courseid>/submissions/options/<users|audiences|tasks|org_categories>?q=<text>`
 * answers `[{value, label}]` (SearchSelect protocol), course staff only.
 */
import { error, json } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { requireCourseStaff } from '#lib/server/courses/access.js';
import { searchOptions, type ListName } from '#lib/server/course-students/query.js';
import type { RequestHandler } from './$types';

const LISTS: string[] = ['users', 'audiences', 'tasks', 'org_categories'] satisfies ListName[];

export const GET: RequestHandler = async (event) => {
	const { course } = await requireCourseStaff(event, event.params.courseid);
	if (!LISTS.includes(event.params.list)) error(404, t('Not found'));
	const q = event.url.searchParams.get('q') ?? '';
	return json(await searchOptions(course, event.params.list as ListName, q, event.locals.lang));
};
