/** Static pages `/pages/<pageid>` (AUTH-02): terms of service, privacy policy, help... */
import { requireStaticPage } from '#lib/server/auth/static-pages.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => requireStaticPage(params.pageid, locals.lang);
