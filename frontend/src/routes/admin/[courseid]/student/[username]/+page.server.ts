/**
 * Per-student task status (CSTU-09) and task state reset (CSTU-10), course staff.
 * Any username is accepted (unknown users simply have no data); resetting a
 * never-viewed task gives an error message instead of the legacy 500. The task
 * list is paginated and filtered on the server (`?status=&q=&page=`: thousands of tasks).
 */
import { fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { requireCourseStaff } from '#lib/server/courses/access.js';
import { resetState, studentTaskPage, userInfos } from '#lib/server/course-students/people.js';
import { formText } from '#lib/server/forms.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { course } = await requireCourseStaff(event, event.params.courseid);
	const { username } = event.params;
	const params = event.url.searchParams;
	const [q, status] = [params.get('q') ?? '', params.get('status') ?? ''];
	return {
		username,
		q,
		status,
		realname: (await userInfos([username]))[username].realname || username,
		...(await studentTaskPage(course, username, { lang: event.locals.lang, q, status, page: params.get('page') }))
	};
};

export const actions: Actions = {
	reset: async (event) => {
		const { course } = await requireCourseStaff(event, event.params.courseid);
		const taskid = formText(await event.request.formData(), 'taskid');
		return (await resetState(course, event.params.username, taskid))
			? { message: t('Task state reset.') }
			: fail(404, { message: t('This task was never viewed by the student.') });
	}
};
