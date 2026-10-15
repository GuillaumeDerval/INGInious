/**
 * Course submissions page (CSTU-11) and in-place replay (CSTU-14).
 * The query is read from the URL (GET, bookmarkable); replays are POST
 * actions restricted to course admins and to submissions of this course,
 * refused beyond the export limit (`exportLimitError`).
 */
import { fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { requireCourseAdmin, requireCourseStaff } from '#lib/server/courses/access.js';
import { getTask } from '#lib/server/courses/task.js';
import { LAYOUTS } from '#lib/server/course-students/archive.js';
import {
	exportLimitError,
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

/** Fields of the submissions needed to replay them (never their outputs or feedback). */
const REPLAY_FIELDS = { courseid: 1, taskid: 1, username: 1, status: 1, input: 1, archive: 1 } as const;

export const actions: Actions = {
	/**
	 * Replays the submission `submissionid`, the `selected` ones, or the whole selection of the URL
	 * search string `query`; submissions still being graded are skipped (never queued twice).
	 */
	replay: async (event) => {
		const { course } = await requireCourseAdmin(event, event.params.courseid);
		const form = await event.request.formData();
		const ids = [...form.getAll('submissionid'), ...form.getAll('selected')];
		const selected = form.has('query')
			? await selectedSubmissions(course, parseQuery(new URLSearchParams(formText(form, 'query'))), REPLAY_FIELDS)
			: null;
		const tooMany = selected ? selected.tooMany : exportLimitError(ids.length);
		if (tooMany) return fail(400, { message: tooMany });
		const docs = selected
			? (await selected.docs.toArray()).filter((s) => GRADED.includes(s.status))
			: await pickSubmissions(course, ids);
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
