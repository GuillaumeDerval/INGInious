/**
 * Tests of the session store against a throw-away MongoDB database (AUTH-04).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectId } from 'mongodb';
import { createTestDatabase, type TestDatabase } from '../testing/db.js';
import { SessionStore } from './session.js';
import type { SessionConfig } from '../config.js';

const cfg: SessionConfig = {
	secretKey: 'test-secret',
	timeout: 3600,
	cookieName: 'inginious_session_id',
	cookiePath: '/',
	sameSite: 'lax',
	httpOnly: true,
	secure: true
};

/** Extracts the cookie value of a Set-Cookie header. */
const cookieValue = (header: string | null) => decodeURIComponent(header!.split(';')[0].split('=')[1]);

let t: TestDatabase;
let store: SessionStore;
beforeAll(async () => {
	t = await createTestDatabase();
	store = new SessionStore(t.database, cfg);
});
afterAll(() => t.drop());

describe('signing', () => {
	it('signs and verifies session ids in constant time', () => {
		const id = new ObjectId();
		const token = store.sign(id);
		expect(token).toMatch(/^[0-9a-f]{24}\.[A-Za-z0-9_-]{43}$/);
		expect(store.verify(token)?.equals(id)).toBe(true);
	});

	it('rejects forged, malformed or foreign tokens', () => {
		const id = new ObjectId();
		const token = store.sign(id);
		const other = new SessionStore(t.database, { ...cfg, secretKey: 'other' });
		expect(store.verify(other.sign(id))).toBeNull();
		expect(store.verify(id.toHexString())).toBeNull();
		expect(store.verify(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).toBeNull();
		expect(store.verify(undefined)).toBeNull();
		expect(store.verify(null)).toBeNull();
	});
});

describe('lifecycle', () => {
	it('creates anonymous sessions lazily (no write until dirty)', async () => {
		const s = await store.load(undefined);
		expect(s.stored).toBe(false);
		expect(s.doc).toMatchObject({
			permanent: true,
			is_lti: false,
			loggedin: false,
			auth_storage: {},
			code_indentation: '4'
		});
		expect(await store.commit(s)).toBeNull();
		expect(await t.database.c.sessions.countDocuments({ _id: s.doc._id })).toBe(0);
	});

	it('stores dirty sessions with a sliding expiration and a signed cookie', async () => {
		const s = await store.load(undefined);
		s.doc.language = 'fr';
		store.markDirty(s);
		const header = await store.commit(s);
		const doc = await t.database.c.sessions.findOne({ _id: s.doc._id });
		expect(doc?.language).toBe('fr');
		expect(doc!.expiration!.getTime()).toBeGreaterThan(Date.now() + 3500_000);
		expect(header).toMatch(/^inginious_session_id=[^;]+; Path=\/; Expires=.+; HttpOnly; Secure; SameSite=Lax$/);
		const value = cookieValue(header);
		expect(store.verify(value)?.equals(s.doc._id)).toBe(true);
		// Loading it back: fresh session, no need to rewrite.
		const again = await store.load(value);
		expect(again.stored).toBe(true);
		expect(again.dirty).toBe(false);
		expect(again.doc.language).toBe('fr');
	});

	it('refreshes stale expirations and sessions without expiration', async () => {
		const id = new ObjectId();
		await t.database.c.sessions.insertOne({
			_id: id,
			permanent: true,
			is_lti: false,
			loggedin: false,
			auth_storage: {},
			expiration: new Date(Date.now() + 1000_000)
		});
		expect((await store.load(store.sign(id))).dirty).toBe(true);
		const id2 = new ObjectId();
		await t.database.c.sessions.insertOne({
			_id: id2,
			permanent: true,
			is_lti: false,
			loggedin: false,
			auth_storage: {}
		});
		expect((await store.load(store.sign(id2))).dirty).toBe(true);
	});

	it('drops expired and unknown sessions', async () => {
		const id = new ObjectId();
		await t.database.c.sessions.insertOne({
			_id: id,
			permanent: true,
			is_lti: false,
			loggedin: true,
			auth_storage: {},
			expiration: new Date(Date.now() - 1000)
		});
		const s = await store.load(store.sign(id));
		expect(s.doc._id.equals(id)).toBe(false);
		expect(await t.database.c.sessions.countDocuments({ _id: id })).toBe(0);
		expect((await store.load(store.sign(new ObjectId()))).stored).toBe(false);
	});

	it('accepts signed LTI tokens only for LTI sessions and sets no cookie', async () => {
		const lti = store.create(true);
		expect(await store.commit(lti)).toBeNull();
		const token = store.sign(lti.doc._id);
		expect((await store.load(null, token)).doc._id.equals(lti.doc._id)).toBe(true);
		// A normal session is never loaded from ?session_id=
		const normal = store.create();
		store.markDirty(normal);
		await store.commit(normal);
		expect((await store.load(null, store.sign(normal.doc._id))).stored).toBe(false);
		// Unsigned session ids are refused.
		expect((await store.load(null, lti.doc._id.toHexString())).stored).toBe(false);
	});

	it('rotates the id at login and destroys at logout', async () => {
		const s = store.create();
		store.markDirty(s);
		await store.commit(s);
		const oldId = s.doc._id;
		await store.rotate(s);
		await store.commit(s);
		expect(s.doc._id.equals(oldId)).toBe(false);
		expect(await t.database.c.sessions.countDocuments({ _id: oldId })).toBe(0);
		expect(await t.database.c.sessions.countDocuments({ _id: s.doc._id })).toBe(1);
		const unsaved = store.create();
		await store.rotate(unsaved);
		expect(unsaved.dirty).toBe(true);
		const id = s.doc._id;
		await store.destroy(s);
		expect(await t.database.c.sessions.countDocuments({ _id: id })).toBe(0);
		expect(s.stored).toBe(false);
		expect(await store.commit(s)).toMatch(/^inginious_session_id=; Path=\/; Expires=Thu, 01 Jan 1970/);
	});
});
