/**
 * Audience edition (CSTU-05), course staff. The audience is always looked up
 * with the URL id AND the course (foreign or unknown ids are 404, ids in the
 * posted data are ignored). Only admins may
 * add students who are not registered yet (they are then enrolled).
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '#lib/i18n/index.js';
import { requireCourseStaff } from '#lib/server/courses/access.js';
import { deleteAudiences, findAudience, updateAudience } from '#lib/server/course-students/audiences.js';
import { userOptions } from '#lib/server/course-students/people.js';
import { formText } from '#lib/server/forms.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** Guard + scoped audience lookup (404 when not in this course). */
async function audience(event: RequestEvent) {
	const { course, admin } = await requireCourseStaff(event, event.params.courseid);
	const doc = await findAudience(course.id, event.params.audienceid);
	if (!doc) error(404, t("This audience doesn't exist."));
	return { course, admin, doc };
}

/** Posted audience. */
const schema = z.object({
	description: z.string().default(''),
	students: z.array(z.string()).default([]),
	tutors: z.array(z.string()).default([])
});

export const load: PageServerLoad = async (event) => {
	const { course, doc } = await audience(event);
	return {
		audience: {
			id: String(doc._id),
			description: doc.description,
			tutors: doc.tutors,
			students: await userOptions(doc.students)
		},
		staff: await userOptions([...new Set([...course.admins, ...course.tutors])])
	};
};

export const actions: Actions = {
	update: async (event) => {
		const { course, admin, doc } = await audience(event);
		const form = await event.request.formData();
		const data = schema.parse({
			description: formText(form, 'description'),
			students: form.getAll('students'),
			tutors: form.getAll('tutors')
		});
		const message = await updateAudience(course, doc._id, data, admin);
		return message ? fail(400, { message }) : { message: t('Audience updated.') };
	},
	delete: async (event) => {
		const { course, doc } = await audience(event);
		await deleteAudiences(course.id, [doc._id]);
		redirect(303, `/admin/${course.id}/students?tab=audiences`);
	}
};
