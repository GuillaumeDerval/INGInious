/**
 * WebDAV access to course folders (SITE-22/23): every method is handled by
 * #lib/server/webdav (authentication, path safety and descriptor checks).
 */
import { handleDav } from '#lib/server/webdav/index.js';
import type { RequestHandler } from './$types';

/** GET, PUT, PROPFIND, MKCOL, MOVE, COPY, DELETE, LOCK... */
export const fallback: RequestHandler = (event) => handleDav(event, event.params.path);
