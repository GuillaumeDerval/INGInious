import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pack } from 'tar-stream';
import { siteEnv, type SiteEnv } from '../../../../../tests/site/env.js';
import { ObjectId } from 'mongodb';
import { PluginRegistry } from '../index.js';
import type { DoneEvent } from '../../submissions/manager.js';
import * as git from './inginious.frontend.plugins.git_repo.js';

let env: SiteEnv;
const repo = join(mkdtempSync(join(tmpdir(), 'site-git-')), 'repo');

/** A tgz with a normal file, a folder and a traversal attempt. */
async function archive(): Promise<Uint8Array> {
	const p = pack();
	p.entry({ name: 'dir', type: 'directory' });
	p.entry({ name: 'dir/out.txt' }, 'hello');
	p.entry({ name: '../evil.txt' }, 'evil');
	p.entry({ name: 'link', type: 'symlink', linkname: '/etc/passwd' });
	p.finalize();
	const chunks: Buffer[] = [];
	for await (const c of p) chunks.push(c as Buffer);
	return gzipSync(Buffer.concat(chunks));
}

beforeAll(async () => (env = await siteEnv()));
afterAll(async () => {
	await env.cleanup();
	rmSync(join(repo, '..'), { recursive: true, force: true });
});

describe('SITE-19 git_repo plugin', () => {
	it('commits each graded submission without extracting outside the folder', async () => {
		const registry = new PluginRegistry();
		await git.init(registry, { plugin_module: 'x', repo_directory: repo });
		await git.init(new PluginRegistry(), { plugin_module: 'x', repo_directory: repo });
		const input = await env.db.putInput({ q: 'yes' });
		const submission = {
			_id: new ObjectId(),
			courseid: 'c',
			taskid: 't',
			username: ['a', 'b'],
			input,
			result: 'success',
			text: 'ok',
			problems: {},
			submitted_on: new Date(),
			status: 'done',
			grade: 100
		};
		await git.saveSubmission(repo, { submission, archive: await archive(), newsub: true } as unknown as DoneEvent);
		const dir = join(repo, 'c', 't', 'a-b');
		expect(readFileSync(join(dir, 'output', 'dir', 'out.txt'), 'utf8')).toBe('hello');
		expect(readFileSync(join(dir, 'input.yaml'), 'utf8')).toContain('q: "yes"');
		expect(readFileSync(join(dir, 'result.yaml'), 'utf8')).toContain('result: success');
		expect(existsSync(join(dir, 'evil.txt')) || existsSync(join(dir, 'output', 'link'))).toBe(false);
		expect(execFileSync('git', ['log', '--format=%s'], { cwd: repo, encoding: 'utf8' })).toContain(
			`c/t - ${submission._id} - a-b - success`
		);
		// Through the hook, failures are logged and do not break the queue.
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		await registry.callHook('submission_done', { submission: { ...submission, result: 'failed' }, archive: null });
		await registry.callHook('submission_done', { submission: { ...submission, courseid: '..' }, archive: null });
		await vi.waitFor(() => expect(error).toHaveBeenCalled());
		await vi.waitFor(() =>
			expect(execFileSync('git', ['log', '--format=%s'], { cwd: repo, encoding: 'utf8' })).toContain('a-b - failed')
		);
		// An unreadable grader archive: the submission is committed without its output.
		const broken = { ...submission, _id: new ObjectId(), username: ['c'] };
		await git.saveSubmission(repo, { submission: broken, archive: Buffer.from('nope') } as unknown as DoneEvent);
		expect(error).toHaveBeenCalledWith('Grader archive not fully extracted:', expect.any(Error));
		expect(execFileSync('git', ['log', '--format=%s'], { cwd: repo, encoding: 'utf8' })).toContain(String(broken._id));
		expect(existsSync(join(repo, 'c', 't', 'c', 'output'))).toBe(false);
	});
});
