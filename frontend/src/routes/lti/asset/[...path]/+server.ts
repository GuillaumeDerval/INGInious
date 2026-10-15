/** LTI-06 asset proxy: relative files of the statement of the session's task. */
import { ltiAsset } from '#lib/server/lti/pages.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => ltiAsset(event, event.params.path);
