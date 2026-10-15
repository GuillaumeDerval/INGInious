/**
 * Task files manager (CADM-14), course admins only. Every change is a POST
 * form action (no GET side effect); `?open=<path>` loads a text file into the
 * editor.
 */
import { fail } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { attempt } from '#lib/server/attempt.js';
import { requireTaskAdmin } from '#lib/server/course-admin/task-editor.js';
import { formText } from '#lib/server/forms.js';
import { coursePath } from '#lib/server/courses/files.js';
import {
	createFile,
	deleteFile,
	FileError,
	listFiles,
	readText,
	renameFile,
	saveText
} from '#lib/server/course-admin/task-files.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** Checks the rights and the task (404 when it does not exist). */
const guard = async (event: RequestEvent) => [(await requireTaskAdmin(event)).course.id, event.params.taskid] as const;

export const load: PageServerLoad = async (event) => {
	const [c, task] = await guard(event as RequestEvent);
	const open = event.url.searchParams.get('open');
	const opened = !open
		? null
		: attempt(
				() => ({ path: open, content: readText(c, task, open), error: '' }),
				(e) => ({ path: open, content: null, error: e.message })
			);
	return { taskid: task, files: listFiles(coursePath(c, task)), opened };
};

/** Runs a file operation with the posted form; user errors become a 400. */
function action(fn: (c: string, task: string, form: FormData) => Promise<void> | void) {
	return async (event: RequestEvent) => {
		const [c, task] = await guard(event);
		try {
			await fn(c, task, await event.request.formData());
		} catch (e) {
			if (e instanceof FileError) return fail(400, { message: e.message });
			return fail(500, { message: t('An error occurred while writing the file') });
		}
		return { message: t('Changes saved.') };
	};
}

export const actions: Actions = {
	create: action((c, task, f) => createFile(c, task, formText(f, 'path'))),
	upload: action(async (c, task, f) => {
		const file = f.get('file');
		if (!(file instanceof File)) throw new FileError(t('No file'));
		createFile(c, task, formText(f, 'path') || file.name, new Uint8Array(await file.arrayBuffer()));
	}),
	save: action((c, task, f) => saveText(c, task, formText(f, 'path'), formText(f, 'content'))),
	rename: action((c, task, f) => renameFile(c, task, formText(f, 'path'), formText(f, 'new_path'))),
	delete: action((c, task, f) => deleteFile(c, task, formText(f, 'path')))
};
