/** Unit tests of /group/<courseid> (NAV-16), including the access rules. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ObjectId } from 'mongodb';
import { navEvent, outcome, setupNav, type NavEnv } from '../../../../tests/fixtures/nav/setup.js';
import { actions, load } from './+page.server.js';

let env: NavEnv;
let ids: Record<string, string>;
beforeAll(async () => (env = await setupNav()));
afterAll(() => env.cleanup());
beforeEach(async () => {
	for (const c of ['courses', 'audiences', 'groups']) await env.db.db.collection(c).deleteMany({});
	await env.db.c.courses.insertMany([
		{ _id: 'nav_open', students: ['nav_alice', 'nav_bob', 'nav_dave', 'ghost'] },
		{ _id: 'nav_pwd', students: ['nav_bob', 'nav_alice'] }
	]);
	await env.db.c.users.updateOne({ username: 'nav_dave' }, { $unset: { realname: 1, email: 1 } });
	const tp1 = (
		await env.db.c.audiences.insertOne({
			courseid: 'nav_open',
			description: 'TP1',
			students: ['nav_alice'],
			tutors: []
		} as never)
	).insertedId as ObjectId;
	const groups = [
		{ courseid: 'nav_open', description: 'Group A', size: 2, students: [], audiences: [] },
		{ courseid: 'nav_open', description: 'Group B (TP1 only)', size: 1, students: [], audiences: [tp1] },
		{ courseid: 'nav_open', description: 'Group Full', size: 1, students: ['nav_dave'], audiences: [] },
		{ courseid: 'nav_pwd', description: 'PWD group', size: 5, students: ['ghost'], audiences: [] }
	];
	const res = await env.db.c.groups.insertMany(groups as never);
	ids = Object.fromEntries(groups.map((g, i) => [g.description, String(res.insertedIds[i])]));
});

const get = (u: string | null, courseid = 'nav_open') => outcome(() => load(navEvent(u, { params: { courseid } })));
const post = (action: 'join' | 'leave', u: string, groupid = '', courseid = 'nav_open') =>
	outcome(() => actions[action](navEvent(u, { params: { courseid }, fields: { groupid } })));
const members = async (d: string) => (await env.db.c.groups.findOne({ description: d }))?.students;

describe('/group/<courseid>', () => {
	it('NAV-16 shows the allowed groups', async () => {
		const alice = await get('nav_alice');
		expect(alice).toMatchObject({ choice: true, hasGroups: true, mine: null, canUnregister: true, grade: 0 });
		expect(alice.groups.map((g: { description: string; available: number }) => [g.description, g.available])).toEqual([
			['Group A', 2],
			['Group B (TP1 only)', 1],
			['Group Full', 0]
		]);
		expect(alice.groups[2].members).toEqual([{ username: 'nav_dave', realname: '', email: '' }]);
		expect((await get('nav_bob')).groups.map((g: { description: string }) => g.description)).not.toContain(
			'Group B (TP1 only)'
		);
		expect(await get('nav_bob', 'nav_pwd')).toMatchObject({ choice: false, mine: null, hasGroups: true });
		expect((await get('nav_alice', 'nav_pwd')).groups[0].members).toEqual([
			{ username: 'ghost', realname: '', email: '' }
		]);
	});

	it('NAV-16 refuses staff, unregistered users and unknown courses', async () => {
		expect(await get('superadmin')).toEqual({
			status: 403,
			message: "You can't access this page as a member of the staff."
		});
		expect(await get('nav_tutor')).toMatchObject({ status: 403 });
		expect(await get('nav_alice', 'nav_closed')).toEqual({
			status: 403,
			message: 'You are not registered to this course.'
		});
		expect(await get('nav_carol')).toMatchObject({ status: 403 });
		expect(await get('nav_alice', 'nonexist')).toMatchObject({ status: 404 });
		expect(await get(null)).toMatchObject({ status: 302 });
	});

	it('NAV-16 joins and leaves groups with server-side checks', async () => {
		expect(await post('join', 'nav_alice', ids['Group A'])).toBeUndefined();
		expect(await members('Group A')).toEqual(['nav_alice']);
		expect((await get('nav_alice')).mine.description).toBe('Group A');
		// Full group: refused, the current group is kept (legacy dropped it).
		expect(await post('join', 'nav_alice', ids['Group Full'])).toMatchObject({
			status: 400,
			data: { message: "Couldn't register to the specified group." }
		});
		expect(await members('Group A')).toEqual(['nav_alice']);
		// Audience restriction and other courses are enforced.
		expect(await post('join', 'nav_bob', ids['Group B (TP1 only)'])).toMatchObject({ status: 400 });
		expect(await post('join', 'nav_alice', ids['PWD group'])).toMatchObject({ status: 400 });
		expect(await post('join', 'nav_alice', 'notanid')).toMatchObject({ status: 400 });
		expect(await post('leave', 'nav_alice')).toBeUndefined();
		expect(await members('Group A')).toEqual([]);
		expect(await post('leave', 'nav_alice')).toMatchObject({
			status: 400,
			data: { message: "You're not registered in a group." }
		});
		expect(await post('join', 'nav_bob', ids['PWD group'], 'nav_pwd')).toEqual({
			status: 403,
			message: 'You are not allowed to change group.'
		});
	});
});
