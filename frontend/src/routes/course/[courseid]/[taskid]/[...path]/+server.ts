/** Public task files, submitted input files and grading archives (TASK-04/22/23). */
import { serveTaskFile } from '#lib/server/task/page.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	serveTaskFile(event, event.params.courseid, event.params.taskid, event.params.path);
