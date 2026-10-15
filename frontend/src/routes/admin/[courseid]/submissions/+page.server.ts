/**
 * Course submissions page (CSTU-11) and in-place replay (CSTU-14).
 * The query is read from the URL (GET, bookmarkable); replays are POST
 * actions restricted to course admins and to submissions of this course.
 */
import { fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { requireCourseAdmin, requireCourseStaff } from '#lib/server/courses/access.js';
import { getTask } from '#lib/server/courses/task.js';
import { LAYOUTS } from '#lib/server/course-students/archive.js';
import {
	GRADED,
	listSubmissions,
	parseQuery,
	pickSubmissions,
	queryOptions,
	selectedSubmissions
} from '#lib/server/course-students/query.js';
import { replaySubmission } from '#lib/server/submissions/manager.js';
import { formText } from '#lib/server/forms.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { course, user } = await requireCourseStaff(event, event.params.courseid);
	const query = parseQuery(event.url.searchParams);
	const lang = event.locals.lang;
	return {
		query,
		options: await queryOptions(course, user.username, lang, query),
		...(await listSubmissions(course, query, lang)),
		layouts: [...LAYOUTS]
	};
};

export const actions: Actions = {
	/**
	 * Replays the submission `submissionid`, the `selected` ones, or the whole selection of the URL
	 * search string `query`; submissions still being graded are skipped (never queued twice).
	 */
	replay: async (event) => {
		const { course } = await requireCourseAdmin(event, event.params.courseid);
		const form = await event.request.formData();
		const docs = form.has('query')
			? (await selectedSubmissions(course, parseQuery(new URLSearchParams(formText(form, 'query'))))).docs.filter((s) =>
					GRADED.includes(s.status)
				)
			: await pickSubmissions(course, [...form.getAll('submissionid'), ...form.getAll('selected')]);
		if (!docs.length) return fail(404, { message: t('No submission selected.') });
		let n = 0;
		for (const sub of docs)
			try {
				await replaySubmission(sub, course, getTask(course, sub.taskid));
				n++;
			} catch {
				// Task removed from the course: the submission cannot be replayed.
			}
		return { message: t('{} selected submissions were set for replay.', n) };
	}
};
