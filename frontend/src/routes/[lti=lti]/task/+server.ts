/** LTI-05 JSON actions of the LTI task page (submit, check, load, kill). */
import { ltiTaskAction } from '#lib/server/lti/pages.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => ltiTaskAction(event);
