/**
 * Test helper: gives each test file its own throw-away database on the MongoDB
 * of the Colima stack (MONGO_TEST_URL, default mongodb://localhost:27017).
 * Excluded from coverage (test support code).
 */
import { MongoClient } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { Database } from '../db/index.js';

/** URL of the MongoDB server used by tests. */
export const MONGO_TEST_URL = process.env.MONGO_TEST_URL ?? 'mongodb://localhost:27017';

/** A temporary database and the function that drops it. */
export interface TestDatabase {
	database: Database;
	client: MongoClient;
	drop: () => Promise<void>;
}

/** Prefix of the throw-away databases (followed by the creation time in seconds). */
const PREFIX = 'INGInious_unit_';

/**
 * Drops the test databases older than one hour (left behind by interrupted
 * runs; too many databases exhaust MongoDB's open files). Run once per test run
 * by the server project's global setup.
 */
export async function dropStaleTestDatabases(): Promise<void> {
	const client = await MongoClient.connect(MONGO_TEST_URL);
	try {
		const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
		const limit = Date.now() / 1000 - 3600;
		for (const { name } of databases) {
			const created = Number(name.slice(PREFIX.length).split('_')[0]);
			if (name.startsWith(PREFIX) && !(created > limit)) await client.db(name).dropDatabase();
		}
	} finally {
		await client.close();
	}
}

/** Creates an empty, initialised database named `INGInious_unit_<seconds>_<random>`. */
export async function createTestDatabase(): Promise<TestDatabase> {
	const client = new MongoClient(MONGO_TEST_URL, { ignoreUndefined: true });
	await client.connect();
	const name = `${PREFIX}${Math.floor(Date.now() / 1000)}_${randomBytes(4).toString('hex')}`;
	const database = new Database(client.db(name));
	await database.init();
	return {
		database,
		client,
		drop: async () => {
			await client.db(name).dropDatabase();
			await client.close();
		}
	};
}
