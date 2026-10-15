/** LTI-05 task page of the LTI session (same page for LTI 1.1 and 1.3). */
import { loadLtiTask } from '#lib/server/lti/pages.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => loadLtiTask(event);
