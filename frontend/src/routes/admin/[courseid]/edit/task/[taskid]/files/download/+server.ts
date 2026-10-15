/**
 * Download of a task file, or of a folder as a zip (CADM-14): always as an
 * attachment with `nosniff`, so uploaded HTML is never rendered on the site.
 */
import { error } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import { attempt } from '#lib/server/attempt.js';
import { download as taskDownload } from '#lib/server/course-admin/task-files.js';
import { requireTaskAdmin } from '#lib/server/course-admin/task-editor.js';
import { download } from '#lib/server/forms.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { course } = await requireTaskAdmin(event);
	const file = attempt(
		() => taskDownload(course.id, event.params.taskid, event.url.searchParams.get('path') ?? '/'),
		() => error(404, t("This path doesn't exist."))
	);
	return download(file.data as Uint8Array<ArrayBuffer>, file.name);
};
