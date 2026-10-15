/** LTI-11 tool JWKS: /lti1.3/jwks/<keyset_hash> (global) or /lti1.3/jwks/<courseid>/<keyset_hash>. */
import { jwks } from '#lib/server/lti/lti13.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => jwks(params.rest);
