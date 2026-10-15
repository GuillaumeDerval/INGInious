/**
 * Port of the legacy "git_repo" plugin (SITE-19): every graded submission is
 * written to `<repo_directory>/<courseid>/<taskid>/<user1-user2...>/`
 * (`submitted_on`, `input.yaml`, `result.yaml`, `output/` = grader archive)
 * and committed. Option: `repo_directory` (default "./repo_submissions").
 *
 * Fixes: the hook signature matches `submission_done` (legacy: TypeError, no
 * commit ever), the input is read from GridFS and `result`/`text` are the
 * stored fields; git runs through `execFile` (no shell) with its own
 * identity; archive members are extracted through `safeJoin` and only files
 * and folders are written (nothing outside the target folder, no symlinks). The
 * archive is read with the size limits of security/tgz.ts: when one is exceeded,
 * the members read so far are kept and the submission is committed anyway. Saves are
 * serialised in a promise queue (legacy thread).
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { PluginConfig } from '../../config.js';
import type { PluginRegistry } from '../index.js';
import { services } from '../../app.js';
import { dumpYaml } from '../../courses/files.js';
import { safeJoin } from '../../security/paths.js';
import { tgzMembers } from '../../security/tgz.js';
import { attempt } from '../../attempt.js';
import { pyIsoformat } from '../../db/index.js';
import type { DoneEvent } from '../../submissions/manager.js';

const run = promisify(execFile);

/** Runs git in the repository with a fixed identity. */
const git = (repo: string, ...args: string[]) =>
	run('git', ['-c', 'user.name=INGInious', '-c', 'user.email=inginious@localhost', ...args], { cwd: repo });

/** Creates the repository and registers the `submission_done` hook. */
export async function init(registry: PluginRegistry, opts: PluginConfig): Promise<void> {
	const repo = resolve(String(opts.repo_directory ?? './repo_submissions'));
	mkdirSync(repo, { recursive: true });
	if (!existsSync(join(repo, '.git'))) await git(repo, 'init');
	let queue = Promise.resolve();
	registry.addHook<DoneEvent, void>('submission_done', (event) => {
		queue = queue.then(() => saveSubmission(repo, event)).catch((e) => console.error('Exception in JobSaver:', e));
	});
}

/** Extracts a grader tgz archive under `dir`; members escaping it are skipped. */
async function extractArchive(archive: Uint8Array, dir: string): Promise<void> {
	try {
		for await (const { header, data } of tgzMembers(archive)) {
			// Members resolving outside `dir` are ignored.
			const target = attempt(
				() => safeJoin(dir, header.name),
				() => null
			);
			if (target && header.type === 'directory') mkdirSync(target, { recursive: true });
			else if (target && header.type === 'file') {
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(target, data);
			}
		}
	} catch (e) {
		// Corrupted or oversized archive: the input, result and members already written are still committed.
		console.error('Grader archive not fully extracted:', e);
	}
}

/** SITE-19: writes one submission into the repository and commits it. */
export async function saveSubmission(repo: string, { submission: s, archive }: DoneEvent): Promise<void> {
	const users = s.username.join('-');
	const dir = safeJoin(repo, s.courseid, s.taskid, users);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'submitted_on'), pyIsoformat(s.submitted_on, ' '));
	writeFileSync(join(dir, 'input.yaml'), dumpYaml(await services().db.getInput(s.input)));
	writeFileSync(join(dir, 'result.yaml'), dumpYaml({ result: s.result, text: s.text, problems: s.problems }));
	if (archive) await extractArchive(archive, join(dir, 'output'));
	await git(repo, 'add', '--all', '.');
	await git(
		repo,
		'commit',
		'-m',
		`${s.courseid}/${s.taskid} - ${s._id} - ${users} - ${s.result === 'success' ? 'success' : 'failed'}`
	);
}
