/**
 * Test helper of the command-line tools: installs the course fixture
 * e2e/fixtures/courses/cli (mcq tasks with recorded submissions) into the tasks
 * directory shared with the grading agents (`E2E.tasksDir`, like the e2e fixtures),
 * under a unique course id written into its recorded submissions.
 * Excluded from coverage (test support code).
 */
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { E2E } from '../../e2e/setup-data.js';

/** tasks_directory of the Colima stack (mounted by the agents). */
export const TASKS_DIR = E2E.tasksDir;

/** An installed copy of the fixture course. */
export interface InstalledCourse {
	courseid: string;
	/** Absolute path of the course folder. */
	dir: string;
	remove: () => void;
}

/** Copies the fixture as `e2e_cli_<prefix>_<random>`; call `remove()` afterwards. */
export function installCliCourse(prefix: string): InstalledCourse {
	const courseid = `e2e_cli_${prefix}_${randomBytes(3).toString('hex')}`;
	const dir = join(TASKS_DIR, courseid);
	cpSync(resolve(import.meta.dirname, '../../e2e/fixtures/courses/cli'), dir, { recursive: true });
	const tests = join(dir, 'mcq', 'test');
	for (const name of readdirSync(tests)) {
		const path = join(tests, name);
		writeFileSync(path, readFileSync(path, 'utf8').replace('courseid: e2e_cli', `courseid: ${courseid}`));
	}
	return { courseid, dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
