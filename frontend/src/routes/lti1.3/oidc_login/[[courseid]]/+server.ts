/** LTI-08 OIDC third-party initiated login (GET or POST, global or course configuration). */
import { oidcLogin } from '#lib/server/lti/lti13.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => oidcLogin(event, event.params.courseid);
export const POST = GET;
