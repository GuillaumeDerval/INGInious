/**
 * Tests of inginious-setup: options, --default and interactive answers, MongoDB
 * and backend checks, superadmin creation and the written configuration.yaml
 * (throw-away database on the MongoDB of the Colima stack, real backend).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { loadConfig } from '#lib/server/config.js';
import { verifyPassword } from '#lib/server/auth/passwords.js';
import { MONGO_TEST_URL } from '#lib/server/testing/db.js';
import { timing } from './common.js';
import { main } from './setup.js';

/** Throw-away database name (dropped by the global setup of the server tests if left behind). */
const DB = `INGInious_unit_${Math.floor(Date.now() / 1000)}_${randomBytes(4).toString('hex')}`;
let mongo: MongoClient;
let tmp: string;
let out: string[];

beforeAll(async () => {
	mongo = await MongoClient.connect(MONGO_TEST_URL);
	tmp = mkdtempSync(join(tmpdir(), 'cli-setup-'));
});
afterAll(async () => {
	await mongo.db(DB).dropDatabase();
	await mongo.close();
	rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

/** Runs the command with the given answers, capturing stdout (prompts included) without ANSI codes. */
async function setup(argv: string[], answers = ''): Promise<number> {
	out = [];
	const strip = (m: unknown) => stripVTControlCharacters(String(m));
	vi.spyOn(console, 'log').mockImplementation((m) => void out.push(strip(m)));
	vi.spyOn(process.stdout, 'write').mockImplementation((m) => (out.push(strip(m)), true));
	return main(argv, Readable.from(answers ? [answers] : []));
}

const base = (file: string) => [
	'--file',
	join(tmp, file),
	'--mongo-host',
	MONGO_TEST_URL,
	'--mongo-database',
	DB,
	'--tasks-directory',
	join(tmp, 'tasks'),
	'--backup-directory',
	join(tmp, 'backup')
];

describe('inginious-setup', () => {
	it('writes the configuration and creates the superadmin from options and defaults', async () => {
		expect(await setup([...base('a.yaml'), '--default', '--superadmin-password', 'secret1'])).toBe(0);
		expect(out).toContain('(INFO) Superadmin superadmin created.');
		expect(out.some((l) => /^\(INFO\) Found backend at tcp:\/\/127.0.0.1:2000 with environments/.test(l))).toBe(true);
		const cfg = loadConfig(join(tmp, 'a.yaml'));
		expect(cfg).toMatchObject({
			backend: 'tcp://127.0.0.1:2000',
			mongo: { host: MONGO_TEST_URL, database: DB },
			tasksDirectory: join(tmp, 'tasks'),
			backupDirectory: join(tmp, 'backup'),
			superadmins: ['superadmin'],
			smtp: null,
			webdavHost: undefined
		});
		expect(cfg.session).toMatchObject({ timeout: 86400, secure: false });
		expect(cfg.session.secretKey).toMatch(/^[0-9a-f]{64}$/);
		expect(existsSync(join(tmp, 'tasks')) && existsSync(join(tmp, 'backup'))).toBe(true);
		const user = await mongo.db(DB).collection('users').findOne({ username: 'superadmin' });
		expect(user).toMatchObject({ realname: 'INGInious SuperAdmin', email: 'superadmin@inginious.org' });
		expect(user!.password).toMatch(/^argon2id-\$argon2id\$/);
		expect(await verifyPassword(user!.password, 'secret1')).toBe(true);
	});

	it('asks the questions interactively (empty answers keep the defaults)', async () => {
		// backend, login, name, email, password, https, smtp host, port, sender, webdav.
		const answers = [
			'',
			'admin2',
			'Admin Two',
			'a2@example.org',
			'secret2',
			'yes',
			'smtp.local',
			'',
			'me@x.org',
			'https://dav'
		];
		expect(await setup(base('b.yaml'), answers.join('\n') + '\n')).toBe(0);
		expect(out[0]).toBe('Backend address [tcp://127.0.0.1:2000]: ');
		expect(out).toContain('SMTP port [25]: ');
		const cfg = loadConfig(join(tmp, 'b.yaml'));
		expect(cfg.superadmins).toEqual(['admin2']);
		expect(cfg.session.secure).toBe(true);
		expect(cfg.smtp).toMatchObject({ host: 'smtp.local', port: 25, sendername: 'me@x.org' });
		expect(cfg.webdavHost).toBe('https://dav');
	});

	it('uses the defaults at the end of the input and skips existing users', async () => {
		// Without --file: ./configuration.yaml.
		const argv = base('c.yaml').slice(2).concat('--backend', 'tcp://127.0.0.1:1');
		const [cwd, wait] = [process.cwd(), timing.environmentsMs];
		process.chdir(tmp);
		timing.environmentsMs = 200;
		try {
			expect(await setup(argv)).toBe(0);
		} finally {
			process.chdir(cwd);
			timing.environmentsMs = wait;
		}
		expect(loadConfig(join(tmp, 'configuration.yaml')).backend).toBe('tcp://127.0.0.1:1');
		expect(out).toContain('(WARN) User already exists, skipping creation.');
		expect(out).toContain(
			'(WARN) No answer from the backend at tcp://127.0.0.1:1: check that inginious-backend is running.'
		);
	});

	it('fails on an invalid superadmin account or an unreachable MongoDB', async () => {
		await expect(setup([...base('d.yaml'), '--default', '--superadmin', 'x'])).rejects.toThrow(
			'Invalid username format.'
		);
		expect(existsSync(join(tmp, 'd.yaml'))).toBe(false);
		const ms = timing.mongoMs;
		timing.mongoMs = 300;
		try {
			await expect(setup(['--default', '--mongo-host', '127.0.0.1:1'])).rejects.toThrow(
				/^Cannot connect to MongoDB on host 127.0.0.1:1: /
			);
		} finally {
			timing.mongoMs = ms;
		}
	});

	it('prints its help', async () => {
		await expect(setup(['-h'])).rejects.toMatchObject({ code: 0, message: expect.stringContaining('--smtp-host') });
	});
});
