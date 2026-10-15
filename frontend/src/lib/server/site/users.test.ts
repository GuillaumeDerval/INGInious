import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { siteEnv, type SiteEnv } from '../../../../tests/site/env.js';
import { verifyPassword } from '../auth/passwords.js';
import { activateUser, createUser, listUsers, PAGE_SIZE } from './users.js';
import { attempt } from '../attempt.js';

let env: SiteEnv;
beforeAll(async () => (env = await siteEnv()));
afterAll(() => env.cleanup());
beforeEach(() => env.db.c.users.deleteMany({}));

const doc = (i: number, extra = {}) => ({
	username: `user${i}`,
	realname: i ? `Real ${i}` : '',
	email: `u${i}@x.org`,
	language: 'en',
	bindings: {},
	...extra
});

describe('SITE-01 listUsers', () => {
	it('paginates in natural order and clamps the page', async () => {
		await env.db.c.users.insertMany(Array.from({ length: 23 }, (_, i) => doc(i)));
		const p1 = await listUsers(1);
		expect([p1.rows.length, p1.pages, p1.rows[0].username]).toEqual([PAGE_SIZE, 3, 'user0']);
		expect((await listUsers(3)).rows.map((r) => r.username)).toEqual(['user20', 'user21', 'user22']);
		expect((await listUsers(99)).page).toBe(3);
		expect((await listUsers(NaN)).page).toBe(1);
		expect((await listUsers(-4)).page).toBe(1);
	});
	it('searches (regex-escaped) and exposes bindings and pending accounts', async () => {
		await env.db.c.users.insertMany([
			doc(1, { bindings: { github: ['42', {}] }, activate: 'x' }),
			doc(2, { realname: 'A.*', bindings: { gh: [] } }),
			{ username: 'raw', language: 'en' } as never
		]);
		const { rows } = await listUsers(1, 'real 1');
		expect(rows).toEqual([
			{ username: 'user1', realname: 'Real 1', email: 'u1@x.org', pending: true, bindings: { github: '42' } }
		]);
		expect((await listUsers(1, '.*')).rows.map((r) => r.username)).toEqual(['user2']);
		expect((await listUsers(1, 'raw')).rows[0]).toMatchObject({
			realname: '',
			email: '',
			pending: false,
			bindings: {}
		});
		expect((await listUsers(1, 'nobody')).pages).toBe(1);
	});
});

describe('SITE-02 createUser', () => {
	const f = { username: 'newbie', realname: 'New', email: 'New@EXAMPLE.org', password: 'secret1' };
	it('creates an activated account with an argon2id hash', async () => {
		expect(await createUser(f)).toBeNull();
		const u = await env.db.c.users.findOne({ username: 'newbie' });
		expect(u).toMatchObject({
			email: 'New@example.org',
			language: 'en',
			bindings: {},
			tos_accepted: false,
			pinned_courses: []
		});
		expect(await verifyPassword(u!.password, 'secret1')).toBe(true);
		expect(await createUser({ ...f, username: 'other' })).toBe('User could not be created.');
		expect(await createUser({ ...f, email: 'bad' })).toBe('Invalid email format.');
		expect(await createUser({ ...f, username: 'x' })).toBe('Invalid username format.');
		expect(await createUser({ ...f, realname: ' ' })).toBe('Name is too short.');
		expect(await createUser({ ...f, password: '123' })).toBe('Password too short.');
	});
});

describe('SITE-04 activateUser', () => {
	it('activates pending accounts only', async () => {
		await env.db.c.users.insertMany([doc(1, { activate: 'h' }), doc(2)]);
		expect(await activateUser('user1')).toBe(true);
		expect((await env.db.c.users.findOne({ username: 'user1' }))?.activate).toBeUndefined();
		expect(await activateUser('user2')).toBe(false);
		expect(await activateUser('ghost')).toBe(false);
	});
});

describe('attempt', () => {
	it('returns the value or the fallback', () => {
		expect(
			attempt(
				() => 1,
				() => 2
			)
		).toBe(1);
		expect(
			attempt(
				() => {
					throw new Error();
				},
				() => 2
			)
		).toBe(2);
	});
});
