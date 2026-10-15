/**
 * SvelteKit server hooks: services start-up (`init`) and the request pipeline
 * (`handle`, implemented in #lib/server/request.ts).
 */
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { initServices } from '#lib/server/app.js';
import { handleRequest } from '#lib/server/request.js';
import { ensureRecovery } from '#lib/server/submissions/manager.js';
import { initLti } from '#lib/server/lti/pages.js';

/**
 * Connects to MongoDB and the backend once, before the first request, then
 * starts the background work: recovery of submissions whose job was lost while
 * the server was down (TASK-25) and the LTI grade passback queues (LTI-07/12).
 */
export const init: ServerInit = async () => {
	await initServices();
	void ensureRecovery();
	initLti();
};

/** Session, user, language, maintenance mode and security headers for every request. */
export const handle: Handle = ({ event, resolve }) => handleRequest(event, resolve);
