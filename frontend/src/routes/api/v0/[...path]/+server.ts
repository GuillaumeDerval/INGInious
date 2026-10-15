/**
 * REST API v0 (SITE-06..11): every method of every `/api/v0/...` URL is
 * dispatched by #lib/server/api (which answers 404/405 itself).
 */
import { handleApi } from '#lib/server/api/index.js';
import type { RequestHandler } from './$types';

/** All methods (GET, POST, and 405 for the others). */
export const fallback: RequestHandler = (event) => handleApi(event, event.params.path);
