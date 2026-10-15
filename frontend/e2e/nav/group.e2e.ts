/**
 * Integration tests of the student group page (NAV-16).
 */
import type { ObjectId } from 'mongodb';
import { test, expect, withDb } from '../fixtures.js';
import { register, setupNav } from './helpers.js';

let ids: Record<string, string>;
test.beforeAll(async () => {
	ids = await setupNav('group', ['nav_open', 'nav_pwd', 'nav_closed']);
	await register(ids.nav_open, 'nav_alice', 'nav_bob', 'nav_dave');
	await register(ids.nav_pwd, 'nav_bob');
	await withDb(async (db) => {
		await db.collection('groups').deleteMany({ courseid: { $in: [ids.nav_open, ids.nav_pwd] } });
		await db.collection('audiences').deleteMany({ courseid: ids.nav_open });
		const tp1 = (
			await db
				.collection('audiences')
				.insertOne({ courseid: ids.nav_open, description: 'TP1', students: ['nav_alice'], tutors: [] })
		).insertedId as ObjectId;
		await db.collection('groups').insertMany([
			{ courseid: ids.nav_open, description: 'Group A', size: 2, students: [], audiences: [] },
			{ courseid: ids.nav_open, description: 'Group B (TP1 only)', size: 1, students: [], audiences: [tp1] },
			{ courseid: ids.nav_open, description: 'Group Full', size: 1, students: ['nav_dave'], audiences: [] },
			{ courseid: ids.nav_pwd, description: 'PWD group', size: 3, students: [], audiences: [] }
		]);
	});
});

test('NAV-16 a student joins and quits a group allowed for his audience', async ({ loginAs }) => {
	const page = await loginAs('nav_alice');
	await page.goto(`/group/${ids.nav_open}`);
	await expect(page.getByText('(available : 2)')).toBeVisible();
	await expect(page.getByText('Group B (TP1 only)')).toBeVisible();
	await expect(page.getByText('Dave Nav')).toBeVisible();
	await page.locator('section', { hasText: 'Group A' }).getByRole('button', { name: 'Join in' }).click();
	await expect(page.getByText('My group : Group A')).toBeVisible();
	expect(
		(await withDb((db) => db.collection('groups').findOne({ courseid: ids.nav_open, description: 'Group A' })))!
			.students
	).toEqual(['nav_alice']);
	await page.goto(`/course/${ids.nav_open}`);
	await expect(page.getByRole('link', { name: 'Group : Group A' }).first()).toBeVisible();
	await page.goto(`/group/${ids.nav_open}`);
	await page.getByRole('button', { name: 'Quit group' }).click();
	await expect(page.getByText(/You're not registered to a group/)).toBeVisible();
});

test('NAV-16 audience, course and capacity are enforced server-side', async ({ loginAs, baseURL }) => {
	const bob = await loginAs('nav_bob');
	await bob.goto(`/group/${ids.nav_open}`);
	await expect(bob.getByText('Group B (TP1 only)')).toHaveCount(0);
	const gid = async (d: string) =>
		String(
			(await withDb((db) =>
				db.collection('groups').findOne({ description: d, courseid: { $in: [ids.nav_open, ids.nav_pwd] } })
			))!._id
		);
	const join = async (groupid: string, courseid = ids.nav_open) => {
		const res = await bob.request.post(`/group/${courseid}?/join`, {
			form: { groupid },
			headers: { origin: baseURL!, 'x-sveltekit-action': 'true' }
		});
		return (await res.json()).status ?? res.status();
	};
	expect(await join(await gid('Group B (TP1 only)'))).toBe(400);
	expect(await join(await gid('PWD group'))).toBe(400);
	expect(await join(await gid('Group Full'))).toBe(400);
	expect(await join('notanid')).toBe(400);
	expect(await join(await gid('PWD group'), ids.nav_pwd)).toBe(403);
	await bob.goto(`/group/${ids.nav_pwd}`);
	await expect(
		bob.getByText("You're not yet registered to a group. Please contact the course administrator for more information.")
	).toBeVisible();
	await expect(bob.getByRole('button', { name: 'Join in' })).toHaveCount(0);
});

test('NAV-16 staff and unregistered users cannot use the group page', async ({ loginAs }) => {
	const admin = await loginAs('superadmin');
	expect((await admin.goto(`/group/${ids.nav_open}`))!.status()).toBe(403);
	await expect(admin.getByText("You can't access this page as a member of the staff.")).toBeVisible();
	const alice = await loginAs('nav_alice');
	expect((await alice.goto(`/group/${ids.nav_closed}`))!.status()).toBe(403);
	await expect(alice.getByText('You are not registered to this course.')).toBeVisible();
});
