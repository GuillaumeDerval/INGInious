/**
 * Integration test of the packaged command-line tools: builds them with
 * cli/vite.config.ts (like `npm run build:cli`) into a temporary folder and runs
 * the bundled commands as Node processes against the real backend (grading the
 * recorded submissions of the cli fixture course, installed into the agents' tasks directory)
 * and a throw-away MongoDB database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { build } from 'vite';
import { MONGO_TEST_URL } from '#lib/server/testing/db.js';
import { installCliCourse, TASKS_DIR, type InstalledCourse } from './testing/fixture.js';

let course: InstalledCourse;
let tmp: string;
/** Output of the build: inside the app, so that the external dependencies resolve to its node_modules. */
const BIN = resolve(import.meta.dirname, `../build-cli-test-${randomBytes(3).toString('hex')}`);

/** Runs a bundled command. @returns its exit code and output. */
function command(name: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((done) =>
		execFile('node', [join(BIN, `${name}.js`), ...args], { cwd: tmp }, (error, stdout, stderr) =>
			done({ code: error ? Number(error.code) : 0, stdout, stderr })
		)
	);
}

beforeAll(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'cli-integration-'));
	course = installCliCourse('integration');
	process.env.CLI_OUT = BIN;
	try {
		await build({ configFile: resolve(import.meta.dirname, 'vite.config.ts'), logLevel: 'silent' });
	} finally {
		delete process.env.CLI_OUT;
	}
}, 60_000);
afterAll(() => {
	course.remove();
	rmSync(tmp, { recursive: true, force: true });
	rmSync(BIN, { recursive: true, force: true });
});

describe('bundled commands', () => {
	it('inginious-autotest grades the recorded submissions through the backend', async () => {
		expect(await command('inginious-autotest', TASKS_DIR, course.dir)).toMatchObject({
			code: 0,
			stdout: `\nAll yaml files in ${course.dir} directory are consistent with the tests\n\n`
		});
		const path = join(course.dir, 'mcq', 'test', 'failed.test');
		writeFileSync(path, readFileSync(path, 'utf8').replace('result: failed', 'result: success'));
		const r = await command('inginious-autotest', TASKS_DIR, course.dir);
		expect(r.code).toBe(66);
		const diff = JSON.parse(r.stdout);
		expect(Object.keys(diff)).toEqual([path]);
		expect(diff[path].result).toEqual(['success', ['failed', expect.stringMatching(/^You have 2 wrong answer/)]]);
	});

	it('inginious-test-task replays the course with the instance configuration', async () => {
		writeFileSync(
			join(tmp, 'configuration.yaml'),
			`backend: tcp://127.0.0.1:2000\ntasks_directory: ${TASKS_DIR}\nsession_parameters: {secret_key: k}\n`
		);
		const r = await command('inginious-test-task', course.courseid, 'mcq');
		expect(r.code).toBe(1); // failed.test was changed by the previous test
		expect(r.stdout).toContain("-> Result doesn't match.");
		expect(r.stdout).toContain('> 1 tests failed in 1 tasks');
		expect((await command('inginious-test-task', '-h')).code).toBe(0);
		expect((await command('inginious-test-task')).code).toBe(2);
	});

	it('inginious-setup writes the configuration and creates the superadmin', async () => {
		const db = `INGInious_unit_${Math.floor(Date.now() / 1000)}_${randomBytes(4).toString('hex')}`;
		const mongo = await MongoClient.connect(MONGO_TEST_URL);
		try {
			const r = await command('inginious-setup', '--default', '--mongo-host', MONGO_TEST_URL, '--mongo-database', db);
			expect(r.code).toBe(0);
			expect(r.stdout).toContain('Superadmin superadmin created.');
			expect(readFileSync(join(tmp, 'configuration.yaml'), 'utf8')).toContain(`database: ${db}`);
			expect(await mongo.db(db).collection('users').countDocuments({ username: 'superadmin' })).toBe(1);
			const again = await command('inginious-setup', '--default', '--mongo-host', '127.0.0.1:1');
			expect(again.code).toBe(1);
			expect(again.stderr).toMatch(/^error: Cannot connect to MongoDB on host 127.0.0.1:1/);
		} finally {
			await mongo.db(db).dropDatabase();
			await mongo.close();
		}
	}, 30_000);
});
