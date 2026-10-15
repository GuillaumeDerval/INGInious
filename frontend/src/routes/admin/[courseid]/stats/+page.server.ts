/**
 * Course statistics, course staff: tabs "Submissions" (CSTU-17, default) and
 * "Student progress" (CSTU-16, `?tab=progress`, one page of tasks at a time):
 * only the statistics of the shown tab are computed. The progress aggregates the
 * grading status of every student, too slow for large courses to wait for: it is
 * streamed (unawaited promise), the page shows a spinner meanwhile.
 */
import { requireCourseStaff } from '#lib/server/courses/access.js';
import { progress } from '#lib/server/course-students/people.js';
import { parseQuery, queryOptions } from '#lib/server/course-students/query.js';
import { submissionStats } from '#lib/server/course-students/stats.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { course, user } = await requireCourseStaff(event, event.params.courseid);
	const lang = event.locals.lang;
	const params = event.url.searchParams;
	if (params.get('tab') === 'progress')
		return { tab: 'progress', progress: progress(course, lang, params.get('page')), stats: null };
	const query = parseQuery(params);
	return {
		tab: 'submissions',
		progress: null,
		stats: {
			options: await queryOptions(course, user.username, lang, query),
			...(await submissionStats(course, query, lang))
		}
	};
};
