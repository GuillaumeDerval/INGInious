/** Task page (TASK-01): data loaded by `loadTaskPage` (guards included). */
import { loadTaskPage } from '#lib/server/task/page.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => loadTaskPage(event, event.params.courseid, event.params.taskid);
