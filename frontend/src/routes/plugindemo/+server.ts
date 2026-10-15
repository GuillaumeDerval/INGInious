/** GET /plugindemo (SITE-16): page of the "demo" plugin, 404 when it is disabled. */
import { requirePlugin } from '#lib/server/plugins/index.js';
import type { RequestHandler } from './$types';

/** The legacy plain-text answer. */
export const GET: RequestHandler = () => {
	requirePlugin('inginious.frontend.plugins.demo');
	return new Response('This is a simple demo plugin', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};
