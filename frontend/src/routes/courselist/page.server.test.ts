/** Unit tests of /courselist (NAV-01). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { navEvent, setupNav, type NavEnv } from '../../../tests/fixtures/nav/setup.js';
import { load } from './+page.server.js';

let env: NavEnv;
beforeAll(async () => (env = await setupNav()));
afterAll(() => env.cleanup());

describe('/courselist', () => {
	it('NAV-01 lists the open courses with the badges of the viewer', async () => {
		const anon = (await load(navEvent(null))) as {
			courses: { id: string; autoRegistration: boolean }[];
			loggedIn: boolean;
			nav: unknown[];
		};
		expect(anon.loggedIn).toBe(false);
		expect(anon.nav).toEqual([]);
		expect(anon.courses.map((c) => c.id)).not.toContain('nav_closed');
		const carol = (await load(navEvent('nav_carol'))) as typeof anon;
		expect(carol.loggedIn).toBe(true);
		expect(carol.courses.find((c) => c.id === 'nav_acl')!.autoRegistration).toBe(true);
		await env.db.c.courses.insertOne({ _id: 'nav_open', students: ['nav_carol'] });
		const again = (await load(navEvent('nav_carol'))) as { courses: { id: string; registered: boolean }[] };
		expect(again.courses.find((c) => c.id === 'nav_open')!.registered).toBe(true);
	});
});
