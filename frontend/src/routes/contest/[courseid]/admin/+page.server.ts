/** /contest/<courseid>/admin (SITE-14): contest settings of a course, course admins only. */
import { fail, type RequestEvent } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { requireCourseAdmin } from '#lib/server/courses/access.js';
import { contestOf, MODULE, saveContest } from '#lib/server/plugins/bundled/inginious.frontend.plugins.contests.js';
import { requirePlugin } from '#lib/server/plugins/index.js';
import type { Actions, PageServerLoad } from './$types';

/** Plugin enabled + course admin + contest dispenser. */
async function guard(event: RequestEvent<{ courseid: string }>) {
	requirePlugin(MODULE);
	const { course } = await requireCourseAdmin(event, event.params.courseid);
	return { course, settings: contestOf(course) };
}

export const load: PageServerLoad = async (event) => {
	const { course, settings } = await guard(event);
	return { id: course.id, course: course.tr(event.locals.lang, course.name), settings };
};

export const actions: Actions = {
	default: async (event) => {
		const { course } = await guard(event);
		const message = saveContest(course, Object.fromEntries(await event.request.formData()));
		return message ? fail(400, { message }) : { message: t('Changes saved.') };
	}
};
