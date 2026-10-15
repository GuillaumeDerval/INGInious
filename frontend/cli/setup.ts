/**
 * inginious-setup: minimal replacement of the legacy `inginious-install`
 * (legacy/inginious/frontend/installer.py; docs/cli.md). Asks for the main
 * settings (or takes them from options, `--default` keeping the defaults of the
 * unanswered ones), checks MongoDB (fatal) and the backend (warning), creates the
 * tasks/backup directories and the superadmin account, then writes the
 * configuration.yaml of the frontend with a new session secret.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { MongoClient } from 'mongodb';
import { mongoUrl, type Services } from '#lib/server/app.js';
import { dumpYaml } from '#lib/server/courses/files.js';
import { Database } from '#lib/server/db/index.js';
import { createUser } from '#lib/server/site/users.js';
import { color, connectBackend, parseArgs, run, timing, useServices, waitFor, type OptionSpec } from './common.js';

/** Questions, in order: option name -> prompt, default value and, optionally, the answer it depends on. */
const QUESTIONS: Record<string, { prompt: string; fallback: string; if?: string }> = {
	backend: { prompt: 'Backend address', fallback: 'tcp://127.0.0.1:2000' },
	'mongo-host': {
		prompt: 'MongoDB host (or mongodb://USERNAME:PASSWORD@HOST:PORT/AUTH_DATABASE)',
		fallback: 'localhost'
	},
	'mongo-database': { prompt: 'Database name', fallback: 'INGInious' },
	'tasks-directory': { prompt: 'Tasks directory', fallback: './tasks' },
	'backup-directory': { prompt: 'Backup directory', fallback: './backup' },
	superadmin: { prompt: 'Enter the login of the superadmin', fallback: 'superadmin' },
	'superadmin-name': { prompt: 'Enter the name of the superadmin', fallback: 'INGInious SuperAdmin' },
	'superadmin-email': { prompt: 'Enter the email address of the superadmin', fallback: 'superadmin@inginious.org' },
	'superadmin-password': { prompt: 'Enter the password of the superadmin', fallback: 'superadmin' },
	https: { prompt: 'Do you plan to serve your INGInious instance only in HTTPS?', fallback: 'no' },
	'smtp-host': { prompt: 'SMTP host to send e-mails (empty: no e-mail)', fallback: '' },
	'smtp-port': { prompt: 'SMTP port', fallback: '25', if: 'smtp-host' },
	'smtp-sender': { prompt: 'Sender of the e-mails', fallback: 'INGInious <no-reply@inginious.org>', if: 'smtp-host' },
	'webdav-host': { prompt: 'Public URL of the WebDAV endpoint (empty: disabled)', fallback: '' }
};

const USAGE = `usage: inginious-setup [-h] [--file FILE] [--default] [--<question> VALUE ...]

Creates the configuration file of the INGInious frontend and its superadmin account.

options:
  -h, --help            show this help message and exit
  --file FILE           Path to the configuration file (default: ./configuration.yaml).
  --default             Use the default value of every question not given as an option.
${Object.entries(QUESTIONS)
	.map(([name, q]) => `  --${name} VALUE`.padEnd(24) + `${q.prompt} [${q.fallback}]`)
	.join('\n')}`;

const info = (msg: string) => console.log(color(34, `(INFO) ${msg}`));
const warning = (msg: string) => console.log(color(33, `(WARN) ${msg}`));

/** Checks the MongoDB server and initialises the database. @throws Error when it cannot be reached. */
async function openDatabase(host: string, name: string): Promise<{ client: MongoClient; db: Database }> {
	const client = new MongoClient(mongoUrl(host), { ignoreUndefined: true, serverSelectionTimeoutMS: timing.mongoMs });
	try {
		const { version } = await client.db().admin().serverInfo();
		info(`Found mongodb server running version ${version} on ${host}.`);
		const db = new Database(client.db(name));
		await db.init();
		return { client, db };
	} catch (e) {
		await client.close();
		throw new Error(`Cannot connect to MongoDB on host ${host}: ${(e as Error).message}`, { cause: e });
	}
}

/**
 * Command entry point.
 * @param input where the interactive answers are read (one per line; end of input = defaults).
 * @returns the exit code (0 written, 1 error, 2 bad usage).
 */
export async function main(argv: string[], input: Readable = process.stdin): Promise<number> {
	const spec: OptionSpec = { file: { kind: 'value' }, default: { kind: 'flag' } };
	for (const name of Object.keys(QUESTIONS)) spec[name] = { kind: 'value' };
	const { opts } = parseArgs(argv, spec, USAGE, []);
	const rl = createInterface({ input, terminal: false });
	const lines = rl[Symbol.asyncIterator]();
	/** Prompts like legacy `_ask_with_default`; an empty answer (or the end of the input) keeps the default. */
	const ask = async (prompt: string, fallback: string) => {
		process.stdout.write(`\x1b[4m${prompt} [${fallback}]:\x1b[0m `);
		const line = await lines.next();
		return (line.done ? '' : line.value.trim()) || fallback;
	};
	const a: Record<string, string> = {};
	for (const [name, q] of Object.entries(QUESTIONS))
		if (!q.if || a[q.if])
			a[name] = (opts[name] as string | undefined) ?? (opts.default ? q.fallback : await ask(q.prompt, q.fallback));
	rl.close();
	const { client, db } = await openDatabase(a['mongo-host'], a['mongo-database']);
	try {
		const backend = connectBackend(a.backend);
		if (await waitFor(() => Object.keys(backend.environments).length > 0, timing.environmentsMs))
			info(`Found backend at ${a.backend} with environments ${JSON.stringify(backend.environments)}.`);
		else warning(`No answer from the backend at ${a.backend}: check that inginious-backend is running.`);
		backend.close();
		const [tasks, backup] = [resolve(a['tasks-directory']), resolve(a['backup-directory'])];
		mkdirSync(tasks, { recursive: true });
		mkdirSync(backup, { recursive: true });
		useServices({ db, config: { isTosDefined: false } as Services['config'] });
		const username = a.superadmin;
		if (await db.c.users.findOne({ username })) warning('User already exists, skipping creation.');
		else {
			const error = await createUser({
				username,
				realname: a['superadmin-name'],
				email: a['superadmin-email'],
				password: a['superadmin-password']
			});
			if (error) throw new Error(error);
			info(`Superadmin ${username} created.`);
		}
		const config = {
			backend: a.backend,
			mongo_opt: { host: a['mongo-host'], database: a['mongo-database'] },
			tasks_directory: tasks,
			backup_directory: backup,
			superadmins: [username],
			session_parameters: {
				timeout: 86400,
				secure: /^(y|yes|true|t|1)$/i.test(a.https),
				secret_key: randomBytes(32).toString('hex')
			},
			...(a['smtp-host'] && {
				smtp: { host: a['smtp-host'], port: Number(a['smtp-port']), sendername: a['smtp-sender'] }
			}),
			...(a['webdav-host'] && { webdav_host: a['webdav-host'] })
		};
		const file = (opts.file as string | undefined) ?? 'configuration.yaml';
		writeFileSync(file, dumpYaml(config));
		info(`Successfully written the configuration file ${resolve(file)}`);
		return 0;
	} finally {
		await client.close();
	}
}

/* v8 ignore next -- executed only when run as a command */
if (import.meta.main) process.exitCode = await run(main, process.argv.slice(2));
