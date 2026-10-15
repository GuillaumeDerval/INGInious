/** Unit tests of the course page and layout (NAV-05, NAV-08, NAV-09, NAV-12, NAV-15). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { navEvent, outcome, setupNav, type NavEnv } from '../../../../tests/fixtures/nav/setup.js';
import { actions, load } from './+page.server.js';
import { load as layoutLoad } from './+layout.server.js';

let env: NavEnv;
beforeAll(async () => (env = await setupNav()));
afterAll(() => env.cleanup());
beforeEach(async () => {
	for (const c of ['courses', 'audiences', 'groups']) await env.db.db.collection(c).deleteMany({});
	await env.db.c.courses.insertMany([
		{ _id: 'nav_open', students: ['nav_alice'] },
		{ _id: 'nav_pwd', students: ['nav_bob'] }
	]);
});

const get = (u: string | null, courseid: string) => outcome(() => load(navEvent(u, { params: { courseid } })));

describe('/course/<courseid>', () => {
	it('NAV-09 shows the course to a registered student', async () => {
		const data = await get('nav_alice', 'nav_open');
		expect(data).toMatchObject({
			anonymous: false,
			registered: true,
			staff: false,
			succeeded: 0,
			total: 6,
			hidden: false,
			canUnregister: true,
			canRegister: false,
			grade: 0,
			lastTried: []
		});
		expect(data.course).toMatchObject({ id: 'nav_open', name: 'NAV Open course', categories: ['easy', 'hard'] });
		expect(data.course.description).toContain('<strong>NAV open course</strong>');
		expect((await get('superadmin', 'nav_combi')).course.description).toBeNull();
	});

	it('NAV-05 applies the access rules', async () => {
		expect(await get('nav_alice', 'nav_closed')).toEqual({ status: 403, message: 'This course is closed.' });
		expect(await get('nav_alice', 'nav_lti')).toMatchObject({ status: 403 });
		expect(await get('nav_alice', 'nav_pwd')).toEqual({ status: 302, location: '/register/nav_pwd' });
		expect(await get('nav_alice', 'nonexist')).toEqual({ status: 404, message: 'Course not found.' });
		expect(await get('nav_alice', 'nav_broken')).toMatchObject({ status: 404 });
		expect(await get(null, 'nav_open')).toMatchObject({ status: 302 });
		expect(
			await outcome(() => load(navEvent('nav_alice', { params: { courseid: 'nav_open' }, lti: true })))
		).toMatchObject({ status: 403 });
		expect(await get('superadmin', 'nav_closed')).toMatchObject({
			hidden: true,
			registered: true,
			canUnregister: false
		});
		expect(await get('nav_tutor', 'nav_open')).toMatchObject({ registered: true, canUnregister: false });
	});

	it('NAV-15 previews courses for visitors', async () => {
		expect(await get(null, 'nav_preview')).toMatchObject({ anonymous: true, registered: false, canRegister: false });
		expect(await get('nav_alice', 'nav_preview')).toMatchObject({ anonymous: false, canRegister: false });
		expect(await get('nav_alice', 'nav_previewreg')).toMatchObject({ canRegister: true });
	});

	it('NAV-08 unregisters students when allowed', async () => {
		const aud = await env.db.c.audiences.insertOne({
			courseid: 'nav_open',
			description: 'TP1',
			students: ['nav_alice'],
			tutors: []
		} as never);
		await env.db.c.groups.insertOne({
			courseid: 'nav_open',
			description: 'Group A',
			size: 2,
			students: ['nav_alice'],
			audiences: []
		} as never);
		const post = (u: string, courseid: string) =>
			outcome(() => actions.unregister(navEvent(u, { params: { courseid }, fields: { unregister: '' } })));
		expect(await post('nav_bob', 'nav_pwd')).toMatchObject({ status: 403 });
		expect(await post('nav_tutor', 'nav_open')).toMatchObject({ status: 403 });
		expect(await post('nav_alice', 'nav_preview')).toMatchObject({ status: 403 });
		expect(await post('nav_alice', 'nav_open')).toEqual({ status: 303, location: '/mycourses' });
		expect((await env.db.c.courses.findOne({ _id: 'nav_open' }))!.students).toEqual([]);
		expect((await env.db.c.audiences.findOne({ _id: aud.insertedId as ObjectId }))!.students).toEqual([]);
	});

	it('NAV-09 layout adds the course section only when accessible', async () => {
		const nav = (u: string | null, courseid: string, lti = false) =>
			layoutLoad(navEvent(u, { params: { courseid }, lti }) as never) as Promise<{ nav?: { title: string }[] }>;
		expect((await nav('nav_alice', 'nav_open')).nav![0].title).toBe('NAV Open course');
		expect(await nav('nav_alice', 'nav_closed')).toEqual({});
		expect(await nav('nav_alice', 'nonexist')).toEqual({});
		expect((await nav(null, 'nav_preview')).nav).toHaveLength(2);
	});
});
