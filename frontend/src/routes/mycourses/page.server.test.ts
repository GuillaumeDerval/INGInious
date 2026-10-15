/** Unit tests of /mycourses (NAV-02, NAV-03, NAV-04, CADM-01). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { navEvent, outcome, setupNav, type NavEnv } from '../../../tests/fixtures/nav/setup.js';
import { actions, load } from './+page.server.js';

let env: NavEnv;
beforeAll(async () => (env = await setupNav()));
afterAll(() => env.cleanup());
beforeEach(async () => {
	await env.db.c.courses.deleteMany({});
	await env.db.c.courses.insertOne({ _id: 'nav_open', students: ['nav_alice'] });
	await env.db.c.users.updateMany({}, { $unset: { pinned_courses: 1 } });
});

const pins = async (username: string) => (await env.db.c.users.findOne({ username }))?.pinned_courses;
const pin = (username: string, courseid: string) =>
	outcome(() => actions.pin(navEvent(username, { fields: { courseid } })));

describe('/mycourses', () => {
	it('NAV-02 requires a user and shows his courses', async () => {
		expect(await outcome(() => load(navEvent(null)))).toMatchObject({ status: 302 });
		expect(await outcome(() => load(navEvent('nav_alice', { lti: true })))).toMatchObject({ status: 403 });
		const data = (await load(navEvent('nav_alice'))) as {
			courses: { id: string }[];
			lastTried: unknown[];
			superadmin: boolean;
		};
		expect(data.courses.map((c) => c.id)).toEqual(['nav_open']);
		expect(data).toMatchObject({ lastTried: [], superadmin: false });
	});

	it('NAV-03 pins and unpins own courses only, at most 6', async () => {
		expect(await pin('nav_alice', 'nav_open')).toBeUndefined();
		expect(await pins('nav_alice')).toEqual(['nav_open']);
		const data = (await load(navEvent('nav_alice'))) as { courses: { pinned: boolean }[] };
		expect(data.courses[0].pinned).toBe(true);
		await pin('nav_alice', 'nav_open');
		expect(await pins('nav_alice')).toEqual([]);
		expect(await pin('nav_alice', 'nav_closed')).toMatchObject({ status: 404 });
		expect(await pin('nav_alice', 'doesnotexist')).toMatchObject({ status: 404 });
		expect(await pins('nav_alice')).toEqual([]);
		for (const id of ['nav_open', 'nav_pwd', 'nav_acl', 'nav_deny', 'nav_bind', 'nav_lti']) await pin('superadmin', id);
		expect(await pin('superadmin', 'nav_combi')).toMatchObject({
			status: 400,
			data: { message: 'You are not allowed to have more than 6 pinned courses.' }
		});
		expect(await pins('superadmin')).toHaveLength(6);
	});

	it('NAV-04 CADM-01 lets superadmins create new hidden courses, never overwriting', async () => {
		const create = (username: string, id: string) =>
			outcome(() => actions.create(navEvent(username, { fields: { new_courseid: id } })));
		expect(await create('superadmin', 'navnew')).toEqual({ message: 'Course created.' });
		expect(readFileSync(join(env.dir, 'navnew', 'course.yaml'), 'utf8')).toBe('accessible: false\nname: navnew\n');
		for (const bad of ['navnew', 'nav_open', '../x', 'a b', '', 'a/b'])
			expect(await create('superadmin', bad)).toMatchObject({
				status: 400,
				data: { message: 'Failed to create the course.' }
			});
		expect(readFileSync(join(env.dir, 'nav_open', 'course.yaml'), 'utf8')).toContain('NAV Open course');
		expect(await create('nav_alice', 'navx')).toMatchObject({ status: 403 });
		expect(existsSync(join(env.dir, 'navx'))).toBe(false);
		expect(await outcome(() => actions.create(navEvent('superadmin', { fields: {} })))).toMatchObject({ status: 400 });
		expect(((await load(navEvent('superadmin'))) as { superadmin: boolean }).superadmin).toBe(true);
	});
});
