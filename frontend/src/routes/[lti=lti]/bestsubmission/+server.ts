/** SITE-20 / LTI-14 best submission of the LTI session (plugin `ltibestsubmission`, 404 when disabled). */
import { bestSubmission } from '#lib/server/plugins/bundled/inginious.frontend.plugins.ltibestsubmission.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => bestSubmission(event);
