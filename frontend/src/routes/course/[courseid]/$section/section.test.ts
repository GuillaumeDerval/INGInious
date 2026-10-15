/** Unit tests of the on-demand loading of the sections of the course page (NAV-10). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { navEvent, outcome, setupNav, type NavEnv } from '../../../../../tests/fixtures/nav/setup.js';
import { GET } from './+server.js';

let env: NavEnv;
beforeAll(async () => {
	env = await setupNav();
	await env.db.c.courses.insertOne({ _id: 'nav_open', students: ['nav_alice'] });
});
afterAll(() => env.cleanup());

const get = (u: string | null, path: string, lti = false) =>
	outcome(async () => {
		const url = `http://localhost/course/nav_open/$section?path=${path}`;
		return (await GET(navEvent(u, { params: { courseid: 'nav_open' }, url, lti }))).json();
	});

describe('/course/<courseid>/$section', () => {
	it('NAV-10 answers the tasks of a terminal section, with the course access rules', async () => {
		expect((await get('nav_alice', '0.1')).map((t: { id: string }) => t.id)).toEqual(['t3']);
		expect(await get('nav_alice', '0')).toMatchObject({ status: 404 });
		expect(await get('nav_alice', '0.1', true)).toMatchObject({ status: 403 });
		expect(await get(null, '0.1')).toMatchObject({ status: 302 });
	});
});
