/**
 * Tests of the MongoDB layer against a real (throw-away) database: legacy indexes,
 * database version check and GridFS storage format.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { BSON, Long } from 'mongodb';
import { createTestDatabase, MONGO_TEST_URL, type TestDatabase } from '../testing/db.js';
import { ObjectId } from 'mongodb';
import { connectDatabase, closeDatabase, DB_VERSION, Database, parseId, dbl, pyIsoformat } from './index.js';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.drop();
});

describe('Database', () => {
	it('creates the legacy indexes', async () => {
		const names = (await t.database.db.collection('user_tasks').indexes()).map((i) => i.name);
		expect(names).toContain('username_1_courseid_1_taskid_1');
		const sessions = await t.database.db.collection('sessions').indexes();
		expect(sessions.find((i) => i.name === 'expiration_1')?.expireAfterSeconds).toBe(0);
		expect(await t.database.c.dbVersion.findOne()).toMatchObject({ db_version: DB_VERSION });
	});

	it('is idempotent and refuses another database version', async () => {
		await t.database.init();
		expect(await t.database.c.dbVersion.countDocuments()).toBe(1);
		await t.database.c.dbVersion.updateOne({}, { $set: { db_version: 3 } });
		await expect(t.database.init()).rejects.toThrow(/Database version 3/);
		await t.database.c.dbVersion.updateOne({}, { $set: { db_version: DB_VERSION } });
	});

	it('stores files in GridFS exactly like pymongo', async () => {
		const big = new Uint8Array(300 * 1024).map((_, i) => i % 251);
		const id = await t.database.putFile(big);
		const file = await t.database.db.collection('fs.files').findOne({ _id: id });
		expect(Object.keys(file!).sort()).toEqual(['_id', 'chunkSize', 'length', 'uploadDate']);
		expect(file!.chunkSize).toBe(261120);
		const raw = await t.database.db.collection('fs.files').findOne({ _id: id }, { promoteLongs: false });
		expect(raw!.length).toBeInstanceOf(Long);
		expect(await t.database.db.collection('fs.chunks').countDocuments({ files_id: id })).toBe(2);
		expect(await t.database.getFile(id)).toEqual(Buffer.from(big));
		await t.database.deleteFile(id);
		await t.database.deleteFile(id); // already deleted: ignored
		expect(await t.database.db.collection('fs.files').countDocuments({ _id: id })).toBe(0);
	});

	it('stores empty files without chunks', async () => {
		const id = await t.database.putFile(new Uint8Array());
		expect(await t.database.db.collection('fs.chunks').countDocuments({ files_id: id })).toBe(0);
		expect((await t.database.getFile(id)).length).toBe(0);
	});

	it('round-trips BSON submission inputs, binary values included', async () => {
		const input = {
			code: 'print(1)',
			'@lang': 'en',
			file: { filename: 'a.txt', value: Buffer.from('hey') },
			mcq: [0, 2]
		};
		const id = await t.database.putInput(input);
		const back = await t.database.getInput(id);
		expect(back).toEqual(input);
		// Same bytes as Python's bson.BSON.encode would produce for this dict.
		expect(await t.database.getFile(id)).toEqual(Buffer.from(BSON.serialize(input)));
	});

	it('reads a missing or empty input file as an empty input', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await t.database.getInput(new ObjectId())).toEqual({});
		expect(await t.database.getInput(await t.database.putFile(new Uint8Array()))).toEqual({});
		expect(error).toHaveBeenCalledTimes(2);
		error.mockRestore();
	});
});

describe('shared connection', () => {
	it('connects once and closes', async () => {
		const name = t.database.db.databaseName;
		const first = await connectDatabase(MONGO_TEST_URL, name);
		expect(first).toBeInstanceOf(Database);
		expect(await connectDatabase(MONGO_TEST_URL, name)).toBe(first);
		await closeDatabase();
		await closeDatabase();
		expect(await connectDatabase(MONGO_TEST_URL, name)).not.toBe(first);
		await closeDatabase();
	});
});

describe('helpers', () => {
	it('parses ObjectIds without throwing', () => {
		expect(parseId('0123456789abcdef01234567')).toBeInstanceOf(ObjectId);
		expect([parseId('nope'), parseId(3), parseId('0123456789abcdef0123456z')]).toEqual([null, null, null]);
	});
	it('stores integral numbers as doubles', () => {
		expect(BSON.deserialize(BSON.serialize({ x: dbl(1) }), { promoteValues: false }).x._bsontype).toBe('Double');
	});
	it('formats dates like Python isoformat', () => {
		expect(pyIsoformat(new Date('2026-10-14T05:31:16.070Z'))).toBe('2026-10-14T05:31:16.070000+00:00');
		expect(pyIsoformat(new Date('2026-10-14T05:31:16Z'), ' ')).toBe('2026-10-14 05:31:16+00:00');
	});
});
