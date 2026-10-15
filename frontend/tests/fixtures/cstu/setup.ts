/**
 * Test support of the people & results administration (CSTU): copies the
 * `cstu_course` fixture as courses `cstu` and `cstu_other` (other staff) into
 * a temporary tasks directory, installs services with a throw-away database,
 * a fake backend and seeds users. Also helpers to seed submissions.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { Double, ObjectId } from 'mongodb';
import { setServices, type Services } from '../../../src/lib/server/app.js';
import { createTestDatabase } from '../../../src/lib/server/testing/db.js';
import type { Database } from '../../../src/lib/server/db/index.js';
import { resetPlugins } from '../../../src/lib/server/plugins/index.js';

const FIXTURE = join(import.meta.dirname, '../../../e2e/fixtures/courses/cstu_course');

/** Seeded users (inactive: `cstu_ghost`). */
export const CSTU_USERS = [
	'superadmin',
	'cstu_admin',
	'cstu_tutor',
	'cstu_bob',
	'cstu_eve',
	'cstu_dan',
	'other_tutor',
	'cstu_ghost'
].map((username) => ({
	username,
	realname:
		username === 'cstu_dan'
			? '=HYPERLINK("x")'
			: username.replace(/^\w+_/, '').replace(/^./, (c) => c.toUpperCase()) + ' Cstu',
	email: `${username}@x.org`,
	password: 'x',
	bindings: {},
	language: 'en',
	...(username === 'cstu_ghost' && { activate: 'hash' })
}));

/** A prepared environment. */
export interface CstuEnv {
	dir: string;
	db: Database;
	newJob: ReturnType<typeof vi.fn>;
	cleanup: () => Promise<void>;
}

/** Installs the environment (courses `cstu`, `cstu_other`, LTI copy `cstu_lti`). */
export async function setupCstu(): Promise<CstuEnv> {
	const dir = mkdtempSync(join(tmpdir(), 'inginious-cstu-'));
	const yaml = readFileSync(join(FIXTURE, 'course.yaml'), 'utf8')
		.replace('- e2e_admin', '- cstu_admin')
		.replace('- e2e_tutor', '- cstu_tutor');
	for (const [id, content] of [
		['cstu', yaml],
		['cstu_other', yaml.replace('- cstu_tutor', '- other_tutor').replace('- cstu_admin', '- other_admin')],
		['cstu_lti', yaml.replace('is_lti: false', 'is_lti: true')]
	]) {
		cpSync(FIXTURE, join(dir, id), { recursive: true });
		writeFileSync(join(dir, id, 'course.yaml'), content);
	}
	const tdb = await createTestDatabase();
	await tdb.database.c.users.insertMany(CSTU_USERS.map((u) => ({ ...u })) as never);
	const newJob = vi.fn(() => 'job-1');
	setServices({
		config: { tasksDirectory: dir, superadmins: ['superadmin'], isTosDefined: false, raw: {} },
		db: tdb.database,
		backend: { newJob, killJob: vi.fn(), jobQueueInfo: () => undefined, queue: null }
	} as unknown as Services);
	resetPlugins();
	return {
		dir,
		db: tdb.database,
		newJob,
		cleanup: async () => {
			await tdb.drop();
			rmSync(dir, { recursive: true, force: true });
			setServices(null);
		}
	};
}

/** Inserts a submission (input stored in GridFS) and returns its id. */
export async function addSub(
	db: Database,
	s: {
		courseid?: string;
		taskid?: string;
		username: string[];
		result?: string;
		grade?: number;
		date?: string;
		status?: 'done' | 'waiting' | 'error';
		tests?: Record<string, unknown>;
		input?: Record<string, unknown>;
		archive?: Uint8Array;
	}
): Promise<ObjectId> {
	const input = await db.putInput(s.input ?? { answer: '42', '@lang': 'en' });
	const doc = {
		courseid: s.courseid ?? 'cstu',
		taskid: s.taskid ?? 'answer',
		username: s.username,
		input,
		status: s.status ?? 'done',
		submitted_on: new Date(s.date ?? '2026-10-10T10:00:00Z'),
		grade: new Double(s.grade ?? 0),
		result: s.result ?? 'failed',
		tests: s.tests ?? {},
		problems: { answer: ['failed', 'Hidden *feedback*'] },
		text: 'Global **text**',
		...(s.archive && { archive: await db.putFile(s.archive) })
	};
	return (await db.c.submissions.insertOne(doc as never)).insertedId as ObjectId;
}
