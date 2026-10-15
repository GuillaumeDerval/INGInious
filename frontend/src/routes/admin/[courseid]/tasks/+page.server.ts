/**
 * Task list administration (CADM-06..09): staff can view it, only course admins can
 * change it and see their WebDAV credentials (WebDAV is admin-only).
 */
import { fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { services } from '#lib/server/app.js';
import { requireCourseAdmin, requireCourseStaff } from '#lib/server/courses/access.js';
import type { Course } from '#lib/server/courses/course.js';
import { hasLegacyTasks, loadTasks } from '#lib/server/courses/task.js';
import { apiKey } from '#lib/server/auth/accounts.js';
import {
	DISPENSERS,
	migrateTasks,
	saveStructure,
	structurePost,
	switchDispenser
} from '#lib/server/course-admin/tasks.js';
import { plugins } from '#lib/server/plugins/index.js';
import { formText, jsonField } from '#lib/server/forms.js';
import type { Actions, PageServerLoad } from './$types';

/** Dispensers offered for a course (contest only with the contests plugin). */
const dispensers = () =>
	DISPENSERS.filter((d) => d !== 'contest' || plugins().isEnabled('inginious.frontend.plugins.contests'));

export const load: PageServerLoad = async (event) => {
	const { course, user, admin } = await requireCourseStaff(event, event.params.courseid);
	const tasks: Record<string, string> = {};
	const errors: Record<string, string> = {};
	for (const [id, task] of loadTasks(course))
		if (task instanceof Error) errors[id] = task.message;
		else tasks[id] = course.tr(event.locals.lang, task.name);
	const host = services().config.webdavHost;
	return {
		kind: course.dispenser.kind,
		dispensers: dispensers(),
		structure: { toc: course.dispenser.data.toc, config: course.dispenser.data.config },
		tasks,
		errors,
		legacy: hasLegacyTasks(course),
		webdav:
			host && admin
				? { url: `${host}/${course.id}`, username: user.username, password: await apiKey(user.username) }
				: null
	};
};

/** Runs an admin action and turns its error messages into the action result. */
async function run(
	event: Parameters<Actions[string]>[0],
	fn: (course: Course, form: FormData) => Promise<string[]> | string[]
) {
	const { course } = await requireCourseAdmin(event, event.params.courseid!);
	const errors = await fn(course, await event.request.formData());
	return errors.length ? fail(400, { message: errors.join('\n') }) : { message: t('Changes saved.') };
}

export const actions: Actions = {
	dispenser: (event) =>
		run(event, (course, form) =>
			[switchDispenser(course, formText(form, 'dispenser'), dispensers())].filter((e) => e !== null)
		),
	migrate: (event) => run(event, (course) => [migrateTasks(course)].filter((e) => e !== null)),
	save: (event) =>
		run(event, (course, form) => {
			const posted = jsonField(form, 'data', structurePost);
			return posted ? saveStructure(course, posted) : [t('Invalid form')];
		})
};
