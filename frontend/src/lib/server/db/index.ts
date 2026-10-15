/**
 * MongoDB access layer.
 *
 * Opens one shared `MongoClient`, exposes typed collections (same names and
 * document shapes as the legacy mongoengine models) and creates the same indexes
 * as mongoengine does, so a database initialised by either frontend is
 * identical. GridFS (bucket "fs", like mongoengine's FileField) stores submission
 * inputs (BSON-encoded dicts) and archives.
 */
import { MongoClient, GridFSBucket, ObjectId, type Db, type Collection, type IndexDescription } from 'mongodb';
import { BSON, Binary, Double, Long } from 'mongodb';

/** GridFS chunk size used by pymongo (255 KiB). */
const GRIDFS_CHUNK = 255 * 1024;

import type {
	UserDoc,
	SessionDoc,
	SubmissionDoc,
	UserTaskDoc,
	CourseClassDoc,
	AudienceDoc,
	GroupDoc,
	NonceDoc,
	LisOutcomeDoc,
	LtiGradeDoc,
	LtiLaunchDoc,
	DbVersionDoc
} from './types.js';

/** Database version expected by this frontend (legacy `inginious.DB_VERSION`). */
export const DB_VERSION = 20;

/** Collection names (legacy mongoengine names) of the typed accessors, with their document types. */
const COLLECTIONS = {
	users: 'users',
	sessions: 'sessions',
	submissions: 'submissions',
	userTasks: 'user_tasks',
	courses: 'courses',
	audiences: 'audiences',
	groups: 'groups',
	nonce: 'nonce',
	lisOutcomes: 'lis_outcome_queue',
	ltiGrades: 'lti_grade_queue',
	ltiLaunch: 'lti_launch',
	dbVersion: 'db_version'
} as const;

/** Document type of each typed collection. */
interface Docs {
	users: UserDoc;
	sessions: SessionDoc;
	submissions: SubmissionDoc;
	userTasks: UserTaskDoc;
	courses: CourseClassDoc;
	audiences: AudienceDoc;
	groups: GroupDoc;
	nonce: NonceDoc;
	lisOutcomes: LisOutcomeDoc;
	ltiGrades: LtiGradeDoc;
	ltiLaunch: LtiLaunchDoc;
	dbVersion: DbVersionDoc;
}

/** Typed accessors to every collection used by the frontend. */
export type Collections = { [K in keyof Docs]: Collection<Docs[K]> };

/** Indexes created by mongoengine for each collection (see the `meta` of the models). */
const INDEXES: Record<string, IndexDescription[]> = {
	users: [{ key: { username: 1 } }, { key: { email: 1 } }],
	sessions: [{ key: { expiration: 1 }, expireAfterSeconds: 0 }],
	submissions: [
		{ key: { username: 1 } },
		{ key: { courseid: 1 } },
		{ key: { courseid: 1, taskid: 1 } },
		{ key: { submitted_on: -1 } },
		{ key: { status: 1 } }
	],
	user_tasks: [
		{ key: { username: 1, courseid: 1, taskid: 1 }, unique: true },
		{ key: { username: 1, courseid: 1 } },
		{ key: { courseid: 1, taskid: 1 } },
		{ key: { courseid: 1 } },
		{ key: { username: 1 } }
	],
	audiences: [{ key: { courseid: 1 } }],
	groups: [{ key: { courseid: 1 } }],
	// The (timestamp, nonce) index is not recreated here: legacy migrations made it
	// unique and recreating it with other options would fail; the LTI module owns
	// the replay-protection index (lib/server/lti/lti11.ts).
	nonce: [{ key: { expiration: 1 }, expireAfterSeconds: 0 }],
	// OIDC nonces and launches expire (anonymous oidc_login calls cannot grow the collection forever).
	lti_launch: [{ key: { expires: 1 }, expireAfterSeconds: 0 }]
};

/** A connected database with its collections and GridFS bucket. */
export class Database {
	readonly c: Collections;
	readonly fs: GridFSBucket;

	/** @param db a connected driver database handle. */
	constructor(readonly db: Db) {
		this.fs = new GridFSBucket(db, { bucketName: 'fs' });
		this.c = Object.fromEntries(
			Object.entries(COLLECTIONS).map(([k, name]) => [k, db.collection(name)])
		) as Collections;
	}

	/**
	 * Creates the legacy indexes and checks/initialises the database version,
	 * like the legacy `get_app` (which refuses to start on a version mismatch).
	 */
	async init(): Promise<void> {
		for (const [name, indexes] of Object.entries(INDEXES)) {
			await this.db.collection(name).createIndexes(indexes);
		}
		const version = await this.c.dbVersion.findOne({ db_version: { $exists: true } });
		if (!version) await this.c.dbVersion.insertOne({ db_version: DB_VERSION });
		else if (version.db_version !== DB_VERSION) {
			throw new Error(`Database version ${version.db_version} != ${DB_VERSION}: run inginious-database-update first`);
		}
	}

	/**
	 * Stores raw bytes in GridFS and returns the new file id. The chunks and the
	 * `fs.files` document are written by hand to match pymongo/mongoengine exactly
	 * (no `filename`/`metadata` keys, Int64 `length`, 255 KiB chunks).
	 */
	async putFile(data: Uint8Array): Promise<ObjectId> {
		const id = new ObjectId();
		const chunks = [];
		for (let off = 0, n = 0; off < data.length; off += GRIDFS_CHUNK, n++) {
			chunks.push({ files_id: id, n, data: new Binary(data.subarray(off, off + GRIDFS_CHUNK)) });
		}
		if (chunks.length) await this.db.collection('fs.chunks').insertMany(chunks);
		await this.db
			.collection('fs.files')
			.insertOne({ _id: id, chunkSize: GRIDFS_CHUNK, length: Long.fromNumber(data.length), uploadDate: new Date() });
		return id;
	}

	/** Reads a whole GridFS file. */
	async getFile(id: ObjectId): Promise<Uint8Array> {
		return Buffer.concat(await Array.fromAsync(this.fs.openDownloadStream(id)));
	}

	/** Deletes a GridFS file, ignoring files that do not exist anymore. */
	async deleteFile(id: ObjectId): Promise<void> {
		try {
			await this.fs.delete(id);
		} catch {
			/* already deleted */
		}
	}

	/** Stores a submission input dict, BSON-encoded like mongoengine's `Submission.set_input`. */
	async putInput(input: Record<string, unknown>): Promise<ObjectId> {
		return this.putFile(BSON.serialize(input));
	}

	/**
	 * Reads a submission input dict (legacy `Submission.get_input`). Binary values become Uint8Array.
	 * A missing or unreadable input file throws (exports and replays must not lose it silently),
	 * unless `orEmpty`: then it is logged and read as an empty input, so that the pages showing the
	 * submission still work.
	 */
	async getInput(id: ObjectId, { orEmpty = false } = {}): Promise<Record<string, unknown>> {
		try {
			return BSON.deserialize(await this.getFile(id), { promoteBuffers: true }) as Record<string, unknown>;
		} catch (e) {
			if (!orEmpty) throw e;
			console.error(`Cannot read the input ${id} of a submission:`, e);
			return {};
		}
	}
}

let client: MongoClient | null = null;
let current: Database | null = null;

/**
 * Connects to MongoDB (once per process) and returns the shared database.
 * @param url connection string, e.g. "mongodb://localhost:27017".
 * @param name database name.
 */
export async function connectDatabase(url: string, name: string): Promise<Database> {
	if (current) return current;
	client = new MongoClient(url, { ignoreUndefined: true });
	await client.connect();
	const database = new Database(client.db(name));
	await database.init();
	current = database;
	return current;
}

/** Closes the shared connection (tests, graceful shutdown). */
export async function closeDatabase(): Promise<void> {
	await client?.close();
	client = null;
	current = null;
}

/** Parses an ObjectId given as a 24-hex-digit string; null when malformed (never throws). */
export function parseId(id: unknown): ObjectId | null {
	return typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

/** A number stored as a BSON double even when integral (legacy float fields such as `grade`, `random`). */
export function dbl(x: number): number {
	return new Double(x) as unknown as number;
}

/**
 * Python `datetime.isoformat(sep)` of an aware UTC date, as stored/exported by
 * legacy (`+00:00` offset, microseconds omitted when zero); `sep = ' '` gives `str(datetime)`.
 */
export function pyIsoformat(d: Date, sep = 'T'): string {
	const ms = d.getUTCMilliseconds();
	return d
		.toISOString()
		.replace('T', sep)
		.replace(/\.\d{3}Z$/, ms ? `.${String(ms).padStart(3, '0')}000+00:00` : '+00:00');
}
