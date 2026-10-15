/**
 * JSON actions of the task page (TASK-08..12), posted to the page URL with an
 * `@action` field like the legacy AJAX protocol (submit, check, load, kill).
 * Browser page requests (Accept: text/html) still reach +page.svelte.
 */
import { taskAction } from '#lib/server/task/page.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => taskAction(event, event.params.courseid, event.params.taskid);
