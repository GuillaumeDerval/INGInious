/** LTI-09 message launch (resource link or deep linking: the message type decides). */
import { launch13 } from '#lib/server/lti/lti13.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => launch13(event, event.params.courseid, event.params.taskid);
export const POST = GET;
