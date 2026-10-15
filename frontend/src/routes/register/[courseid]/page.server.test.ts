/** Unit tests of /register/<courseid> (NAV-06, NAV-07). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { navEvent, outcome, setupNav, type NavEnv } from '../../../../tests/fixtures/nav/setup.js';
import { actions, load } from './+page.server.js';

let env: NavEnv;
beforeAll(async () => (env = await setupNav()));
afterAll(() => env.cleanup());
beforeEach(() => env.db.c.courses.deleteMany({}));

const get = (u: string | null, courseid: string) => outcome(() => load(navEvent(u, { params: { courseid } })));
const post = (u: string, courseid: string, fields: Record<string, string> = {}) =>
	outcome(() => actions.default(navEvent(u, { params: { courseid }, fields })));
const students = async (id: string) => (await env.db.c.courses.findOne({ _id: id }))?.students;

describe('/register/<courseid>', () => {
	it('NAV-06 registers with the course password', async () => {
		expect(await get('nav_bob', 'nav_pwd')).toEqual({ id: 'nav_pwd', name: 'NAV Password course', password: true });
		expect(await post('nav_bob', 'nav_pwd', { register_password: 'wrong' })).toMatchObject({
			status: 400,
			data: { message: 'Invalid password.' }
		});
		expect(await post('nav_bob', 'nav_pwd')).toMatchObject({ status: 400 });
		expect(await students('nav_pwd')).toBeUndefined();
		expect(await post('nav_bob', 'nav_pwd', { register_password: 's3cret' })).toEqual({
			status: 303,
			location: '/course/nav_pwd'
		});
		expect(await students('nav_pwd')).toEqual(['nav_bob']);
		expect(await get('nav_bob', 'nav_pwd')).toEqual({ status: 303, location: '/course/nav_pwd' });
		expect(await post('nav_bob', 'nav_pwd', { register_password: 's3cret' })).toMatchObject({ status: 400 });
	});

	it('NAV-06 redirects when registration is impossible and 404s unknown courses', async () => {
		expect(await get('nav_alice', 'nav_open')).toMatchObject({ password: false });
		for (const id of ['nav_regclosed', 'nav_closed', 'nav_lti'])
			expect(await get('nav_alice', id)).toEqual({ status: 303, location: `/course/${id}` });
		expect(await get('superadmin', 'nav_open')).toMatchObject({ status: 303 });
		expect(await get('nav_alice', 'nonexist')).toEqual({ status: 404, message: "This course doesn't exist." });
		expect(await get(null, 'nav_open')).toMatchObject({ status: 302, location: expect.stringContaining('/signin') });
	});

	it('NAV-07 applies the registration ACLs', async () => {
		expect(await get('nav_carol', 'nav_acl')).toMatchObject({ id: 'nav_acl' });
		expect(await get('nav_bob', 'nav_acl')).toMatchObject({ id: 'nav_acl' });
		expect(await get('nav_alice', 'nav_acl')).toMatchObject({ status: 303 });
		expect(await get('nav_bob', 'nav_deny')).toMatchObject({ status: 303 });
		expect(await get('nav_carol', 'nav_deny')).toMatchObject({ status: 303 });
		expect(await get('nav_alice', 'nav_deny')).toMatchObject({ id: 'nav_deny' });
		expect(await get('nav_dave', 'nav_bind')).toMatchObject({ id: 'nav_bind' });
		expect(await get('nav_alice', 'nav_bind')).toMatchObject({ status: 303 });
		expect(await post('nav_alice', 'nav_bind')).toMatchObject({ status: 400 });
	});
});
