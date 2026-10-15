/** LTI-04 login step: bound LMS users go to their task, others get the bind link. */
import { loginPage } from '#lib/server/lti/pages.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => loginPage(event);
