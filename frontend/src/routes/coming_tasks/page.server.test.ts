/** Unit tests of /coming_tasks (NAV-20). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { navEvent, outcome, setupNav, type NavEnv } from '../../../tests/fixtures/nav/setup.js';
import { plugins } from '#lib/server/plugins/index.js';
import { load } from './+page.server.js';

let env: NavEnv;
beforeAll(async () => {
	env = await setupNav();
	await env.db.c.courses.insertOne({ _id: 'nav_open', students: ['nav_alice'] });
});
afterAll(() => env.cleanup());

const get = (u: string | null, query = '') =>
	outcome(() => load(navEvent(u, { url: `http://localhost/coming_tasks${query}` })));

describe('/coming_tasks', () => {
	it('NAV-20 is a 404 when the plugin is disabled', async () => {
		expect(await get('nav_alice')).toMatchObject({ status: 404 });
	});

	it('NAV-20 lists the upcoming tasks with the time planner', async () => {
		await plugins().load([{ plugin_module: 'inginious.frontend.plugins.upcoming_tasks' }], {
			'inginious.frontend.plugins.upcoming_tasks': () =>
				import('#lib/server/plugins/bundled/inginious.frontend.plugins.upcoming_tasks.js')
		});
		const all = await get('nav_alice');
		expect(all).toMatchObject({ planner: 'unlimited', lastTried: [], nav: [{ items: [{ href: '/coming_tasks' }] }] });
		expect(all.courses[0].tasks.map((t: { id: string }) => t.id)).toEqual(['tsoft']);
		expect(await get('nav_alice', '?time_planner=7')).toMatchObject({ planner: '7', courses: [] });
		expect((await get('nav_alice', '?time_planner=abc')).planner).toBe('unlimited');
		expect(await get(null)).toMatchObject({ status: 302 });
	});
});
