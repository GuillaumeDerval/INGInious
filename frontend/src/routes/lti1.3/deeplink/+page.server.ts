/** LTI-10 deep-linking task picker (bound course administrators only). */
import { deepLinkData, deepLinkSelect } from '#lib/server/lti/pages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => deepLinkData(event);
export const actions: Actions = { default: (event) => deepLinkSelect(event) };
