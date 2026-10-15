/**
 * Task editor (CADM-10..13), course admins only: GET loads the descriptor of
 * an existing task (404 otherwise), the `save` action merges the posted
 * values into task.yaml.
 */
import { fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import {
	editorPost,
	editorTabs,
	environments,
	requireTaskAdmin,
	saveEditor
} from '#lib/server/course-admin/task-editor.js';
import { jsonField } from '#lib/server/forms.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { course, raw } = await requireTaskAdmin(event);
	const { problems = {}, ...values } = raw;
	if (Array.isArray(values.author)) values.author = values.author.join(', ');
	return {
		taskid: event.params.taskid,
		values,
		problems: Object.entries(problems as Record<string, { type: string } & Record<string, unknown>>).map(([id, p]) => ({
			...p,
			id
		})),
		environments: environments(),
		tabs: await editorTabs(course, event.params.taskid, raw)
	};
};

export const actions: Actions = {
	save: async (event) => {
		const { course } = await requireTaskAdmin(event);
		const posted = jsonField(await event.request.formData(), 'task', editorPost);
		if (!posted) return fail(400, { message: t('Invalid form') });
		const message = await saveEditor(course, event.params.taskid, posted);
		return message ? fail(400, { message }) : { message: t('Task saved.') };
	}
};
