/**
 * /external (SITE-18): endpoint of the "simple_grader" plugin, 404 unless the
 * plugin is enabled with an `api_key`. Answers are JSON with CORS `*` (the
 * shared secret, not cookies, authenticates callers).
 */
import { error } from '@sveltejs/kit';
import { body } from '#lib/server/api/index.js';
import {
	graderEnabled,
	handleGrader,
	validKey
} from '#lib/server/plugins/bundled/inginious.frontend.plugins.simple_grader.js';
import { requirePlugin } from '#lib/server/plugins/index.js';
import { authThrottle, clientAddress } from '#lib/server/auth/rate-limit.js';
import type { RequestHandler } from './$types';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };

/** 404 when the plugin is not usable. */
function guard(): void {
	requirePlugin('inginious.frontend.plugins.simple_grader');
	if (!graderEnabled()) error(404, 'Not found');
}

/** Legacy test form. */
export const GET: RequestHandler = () => {
	guard();
	const html =
		'<!doctype html><title>External grade POST test</title><form method="post"><textarea name="input">{"question1":"print \'Hello World!\'"}</textarea><input name="taskid" value="helloworld"> (taskid) <input name="api_key" type="password"> (api_key) <label><input type="checkbox" name="async"> async?</label><button>Submit</button></form>';
	return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};

/** CORS preflight of JSON posts. */
export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });

/** New job or poll; 403 without the shared secret. */
export const POST: RequestHandler = async (event) => {
	guard();
	const form = await body(event.request);
	// Key guesses are throttled per client ; a throttled client gets the same answer.
	const client = clientAddress(event);
	if (authThrottle.blocked(client) || !validKey(form.get('api_key'))) {
		authThrottle.failed(client);
		return Response.json({ status: 'error', status_message: 'Invalid API key' }, { status: 403, headers: CORS });
	}
	return Response.json(await handleGrader(form), { headers: CORS });
};
