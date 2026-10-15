/** LTI-02 LTI 1.1 basic launch (POST only: GET answers 405). */
import { launch11 } from '#lib/server/lti/lti11.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => launch11(event, event.params.courseid, event.params.taskid);
