/**
 * Unit tests of the plugin routes: contest scoreboard and settings (/contest/<courseid>[/admin],
 * SITE-14: settings for course admins only), scoreboards (/scoreboard/<courseid>[/<index>],
 * SITE-13) and the simple grader endpoint (/external, SITE-18: shared secret required).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { siteEnv, event, user, MCQ_TASK, type SiteEnv } from '../../../tests/site/env.js';
import { resetPlugins } from '#lib/server/plugins/index.js';
import * as contests from '#lib/server/plugins/bundled/inginious.frontend.plugins.contests.js';
import * as scoreboards from '#lib/server/plugins/bundled/inginious.frontend.plugins.scoreboard.js';
import * as grader from '#lib/server/plugins/bundled/inginious.frontend.plugins.simple_grader.js';
import * as admin from './[courseid]/admin/+page.server.js';
import { load as contestLoad } from './[courseid]/+page.server.js';
import { load as boardsLoad } from '../scoreboard/[courseid]/+page.server.js';
import { load as boardLoad } from '../scoreboard/[courseid]/[scoreboardid]/+page.server.js';
import { GET as externalGet, OPTIONS as externalOptions, POST as externalPost } from '../external/+server.js';

const GRADER = 'inginious.frontend.plugins.simple_grader';
let env: SiteEnv;
beforeAll(async () => {
	env = await siteEnv();
	env.course(
		'ctr',
		{
			name: 'CTR',
			admins: ['admin1'],
			tutors: ['tutor1'],
			task_dispenser: 'contest',
			dispenser_data: { contest_settings: { enabled: true }, toc_data: { toc: [] } },
			scoreboard: [{ name: 'Board', content: 'p1' }]
		},
		{ p1: MCQ_TASK }
	);
	await env.db.c.courses.insertOne({ _id: 'ctr', students: ['alice'] });
	await resetPlugins().load(
		[
			{ plugin_module: contests.MODULE },
			{ plugin_module: scoreboards.MODULE },
			{ plugin_module: GRADER, api_key: 'k3y' }
		],
		{
			[contests.MODULE]: async () => contests,
			[scoreboards.MODULE]: async () => scoreboards,
			[GRADER]: async () => grader
		}
	);
});
afterAll(() => (resetPlugins(), env.cleanup()));

/** HTTP status of a load/action/handler (200 when it returns). */
const status = async (fn: () => unknown) => {
	try {
		await fn();
		return 200;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
};
/** Request event of `username` on a page of course ctr (`form`: POST body). */
const as = (username: string, params: Record<string, string> = {}, form?: Record<string, string>) =>
	event('/x', {
		method: form ? 'POST' : 'GET',
		body: form && new URLSearchParams(form),
		headers: form && { 'content-type': 'application/x-www-form-urlencoded' },
		user: user(username),
		params: { courseid: 'ctr', ...params }
	}) as never;

describe('SITE-14 contest pages', () => {
	it('show the scoreboard to members', async () => {
		expect(await contestLoad(as('alice'))).toMatchObject({ id: 'ctr', course: 'CTR', started: true });
		expect(await status(() => contestLoad(as('zed')))).toBe(403);
	});
	it('refuse the settings to tutors and students, save them for course admins', async () => {
		expect(await status(() => admin.load(as('tutor1')))).toBe(403);
		expect(await status(() => admin.load(as('alice')))).toBe(403);
		expect(await status(() => admin.actions.default(as('tutor1', {}, {})))).toBe(403);
		expect(await admin.load(as('admin1'))).toMatchObject({ id: 'ctr', settings: { enabled: true } });
		expect(await admin.actions.default(as('admin1', {}, { start: 'x' }))).toMatchObject({ status: 400 });
		const form = { start: '2020-01-01 00:00:00', end: '2099-01-01 00:00:00', blackout: '0', penalty: '20' };
		expect(await admin.actions.default(as('admin1', {}, { ...form, enabled: 'on' }))).toEqual({
			message: 'Changes saved.'
		});
	});
});

describe('SITE-13 scoreboard pages', () => {
	it('list the boards and rank the listed tasks', async () => {
		expect(await boardsLoad(as('alice'))).toMatchObject({ boards: ['Board'] });
		expect(await boardLoad(as('admin1', { scoreboardid: '0' }))).toMatchObject({ name: 'Board', rows: [] });
	});
});

describe('SITE-18 external grader endpoint', () => {
	it('refuses requests without the shared secret', async () => {
		const post = (body: Record<string, string>) =>
			externalPost(event('/external', { method: 'POST', body: new URLSearchParams(body) }) as never);
		for (const body of [
			{ taskid: 'p1', input: '{}' },
			{ taskid: 'p1', input: '{}', api_key: 'bad' }
		] as Record<string, string>[]) {
			const res = await post(body);
			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({ status: 'error', status_message: 'Invalid API key' });
		}
		expect(await (await post({ api_key: 'k3y', jobid: 'none' })).json()).toMatchObject({ status: 'error' });
		expect((await externalGet(event('/external') as never)).status).toBe(200);
		expect((await externalOptions(event('/external') as never)).status).toBe(204);
		resetPlugins();
		expect(await status(() => post({ api_key: 'k3y' }))).toBe(404);
	});
});
