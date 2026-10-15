/**
 * Danger zone (CADM-15/16), course admins only: archive the course data or
 * delete the course. Both require the course id typed by the user (POST,
 * same-origin checked by SvelteKit).
 */
import { fail, redirect } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { requireCourseAdmin } from '#lib/server/courses/access.js';
import { archiveCourse, wipeAndDeleteCourse } from '#lib/server/course-admin/danger.js';
import { setFlash } from '#lib/server/flash.js';
import { formText } from '#lib/server/forms.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async (event) => ({
	archived: (await requireCourseAdmin(event, event.params.courseid)).course.archived
});

/** Checks the rights and the typed course id. */
async function confirmed(event: RequestEvent) {
	const { course } = await requireCourseAdmin(event, event.params.courseid);
	return formText(await event.request.formData(), 'courseid') === course.id ? course : null;
}

export const actions: Actions = {
	archive: async (event) => {
		const course = await confirmed(event);
		if (!course) return fail(400, { message: t('Wrong course id.') });
		try {
			const archive = await archiveCourse(course);
			return { archive, message: t('Course archived as : {}', archive) };
		} catch (e) {
			return fail(400, {
				message: t('An error occurred while dumping course from database: {}', (e as Error).message)
			});
		}
	},
	delete: async (event) => {
		const course = await confirmed(event);
		if (!course) return fail(400, { message: t('Wrong course id.') });
		await wipeAndDeleteCourse(course);
		setFlash(event.cookies, 'success', t('Course {} deleted.', course.id));
		redirect(303, '/');
	}
};
