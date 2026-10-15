/** LTI-04 binding of the LMS user to the signed-in INGInious account (normal session, new window). */
import { bindAction, bindPage } from '#lib/server/lti/pages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => bindPage(event);
export const actions: Actions = { default: (event) => bindAction(event) };
