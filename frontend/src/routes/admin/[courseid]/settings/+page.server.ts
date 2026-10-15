/**
 * Course settings page (CADM-03/04/05, LTI-01), course admins only. The form
 * posts its values as one JSON field; nothing is written unless every field
 * is valid.
 */
import { fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { services } from '#lib/server/app.js';
import { requireCourseAdmin } from '#lib/server/courses/access.js';
import { saveCourse } from '#lib/server/courses/course.js';
import { buildSettings, ltiClients, settingsForm, settingsValues } from '#lib/server/course-admin/settings.js';
import { jsonField } from '#lib/server/forms.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { course } = await requireCourseAdmin(event, event.params.courseid);
	return {
		values: await settingsValues(course),
		clients: [...ltiClients(services().config.ltiConfig, 'global'), ...ltiClients(course.content.lti_config, 'course')]
	};
};

export const actions: Actions = {
	default: async (event) => {
		const { course, user } = await requireCourseAdmin(event, event.params.courseid);
		const posted = jsonField(await event.request.formData(), 'settings', settingsForm);
		if (!posted) return fail(400, { message: t('Invalid form') });
		const result = buildSettings(course, posted, user);
		if ('errors' in result) return fail(400, { message: result.errors.join('\n') });
		saveCourse(course.id, result.content);
		return { message: t('Settings saved.') };
	}
};
