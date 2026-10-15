/**
 * Global setup of the integration suite: recreates the e2e database with the
 * seed users and clears previous coverage data. Course fixtures are installed
 * as `e2e_*` folders of the shared tasks directory (fixtures.ts installCourse,
 * plus archives made by the tests); they would pile up in the course list of the
 * development server, so the teardown deletes the ones created by this run and
 * the setup deletes stale ones left by interrupted runs. Runs with different
 * `E2E_ID`s may overlap and share these folders: each run leaves a marker in
 * e2e/.generated/running/, and only the last run to finish cleans up (what was
 * created since it started; anything older goes with the stale folders).
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import MCR from 'monocart-coverage-reports';
import { coverageOptions } from './coverage-options.mjs';
import { E2E, E2E_ID, USERS } from './setup-data.js';

/** tasks_directory of e2e/config.yaml (shared with the grading agents). */
const TASKS_DIR = E2E.tasksDir;
/** Age after which an `e2e_*` course folder (or a run marker) is a leftover of an interrupted run. */
const STALE_MS = 6 * 3600_000;
/** Markers of the runs in progress (one file per E2E_ID). */
const RUNNING_DIR = join(dirname(fileURLToPath(import.meta.url)), '.generated', 'running');

/** True when another run (not stale) is in progress. */
function otherRunInProgress(): boolean {
	return readdirSync(RUNNING_DIR).some(
		(id) => id !== E2E_ID && statSync(join(RUNNING_DIR, id)).mtimeMs > Date.now() - STALE_MS
	);
}

/** Deletes the `e2e_*` course folders created at or after `since` (or before `before`). */
function removeTestCourses({ since = Infinity, before = -Infinity }: { since?: number; before?: number }): void {
	for (const name of readdirSync(TASKS_DIR)) {
		if (!name.startsWith('e2e_')) continue;
		const path = join(TASKS_DIR, name);
		const created = statSync(path).birthtimeMs;
		if (created >= since || created < before) rmSync(path, { recursive: true, force: true });
	}
}

export default async function globalSetup(): Promise<() => void> {
	const start = Date.now();
	mkdirSync(RUNNING_DIR, { recursive: true });
	writeFileSync(join(RUNNING_DIR, E2E_ID), String(start));
	removeTestCourses({ before: start - STALE_MS });
	// coverage/e2e itself is wiped by the npm script before the server starts.
	MCR(coverageOptions).cleanCache();
	const client = await MongoClient.connect(E2E.mongoUrl);
	try {
		const db = client.db(E2E.database);
		await db.dropDatabase();
		await db.collection('users').insertMany(USERS.map((u) => ({ ...u })));
	} finally {
		await client.close();
	}
	return () => {
		rmSync(join(RUNNING_DIR, E2E_ID), { force: true });
		if (!otherRunInProgress()) removeTestCourses({ since: start });
	};
}
