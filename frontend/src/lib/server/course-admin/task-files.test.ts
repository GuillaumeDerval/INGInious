/** Unit tests of the task files management (CADM-14), security regressions included. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { createFile, deleteFile, download, listFiles, readText, renameFile, saveText, taskFile } from './task-files.js';
import { setup, type CoursesEnv } from './testing/helpers.js';

let env: CoursesEnv;
let dir: string;
beforeAll(async () => {
	env = await setup();
	dir = join(env.dir, 'fx', 'code1');
	writeFileSync(join(env.dir, 'secret.txt'), 'secret');
	symlinkSync(join(env.dir, 'secret.txt'), join(dir, 'link'));
});
afterAll(() => env.cleanup());

describe('task files', () => {
	it('creates files and folders, lists them (files first, task.yaml hidden)', () => {
		createFile('fx', 'code1', 'run');
		createFile('fx', 'code1', ' /dir/sub/ ');
		createFile('fx', 'code1', '/dir/a.txt', new TextEncoder().encode('hello'));
		mkdirSync(join(dir, 'dir', 'sub', 'deep'));
		writeFileSync(join(dir, 'dir', 'task.yaml'), 'x');
		expect(listFiles(dir).map((f) => [f.path, f.depth, f.dir])).toEqual([
			['/link', 0, false],
			['/run', 0, false],
			['/dir/', 0, true],
			['/dir/a.txt', 1, false],
			['/dir/task.yaml', 1, false],
			['/dir/sub/', 1, true],
			['/dir/sub/deep/', 2, true]
		]);
	});
	it('refuses existing, unsafe and protected paths', () => {
		for (const path of ['run', '/../evil', '/task.yaml', '/./task.yaml', '/', '', 'dir/../task.yaml', '/a\0b'])
			expect(() => createFile('fx', 'code1', path)).toThrow('Invalid path');
		expect(() => readText('fx', 'code1', '/./task.yaml')).toThrow('Invalid path');
		expect(() => saveText('fx', 'code1', '/nope', 'x')).toThrow('Invalid path');
		expect(() => saveText('fx', 'code1', '/dir', 'x')).toThrow('Invalid path');
		expect(() => deleteFile('fx', 'code1', '/')).toThrow('Invalid path');
		expect(() => readText('fx', 'code1', '/link')).toThrow('Invalid path');
		expect(() => taskFile('fx', 'code1', '/', true, true)).not.toThrow();
	});
	it('reads and saves text files', () => {
		expect(readText('fx', 'code1', '/dir/a.txt')).toBe('hello');
		saveText('fx', 'code1', '/dir/a.txt', 'bye');
		expect(readText('fx', 'code1', 'dir/a.txt')).toBe('bye');
		writeFileSync(join(dir, 'bin'), Buffer.from([0xff, 0xfe]));
		expect(readText('fx', 'code1', '/bin')).toBeNull();
	});
	it('moves and deletes files and folders', () => {
		renameFile('fx', 'code1', '/dir/a.txt', '/moved/b.txt');
		expect(readFileSync(join(dir, 'moved', 'b.txt'), 'utf8')).toBe('bye');
		expect(() => renameFile('fx', 'code1', '/dir/', '/dir/sub/x')).toThrow('Invalid path');
		expect(() => renameFile('fx', 'code1', '/run', '/moved/b.txt')).toThrow('Invalid path');
		deleteFile('fx', 'code1', '/moved/');
		deleteFile('fx', 'code1', '/bin');
		expect(existsSync(join(dir, 'moved'))).toBe(false);
		expect(existsSync(join(dir, 'bin'))).toBe(false);
	});
	it('downloads files and folders as zip (no symlinks)', () => {
		expect(download('fx', 'code1', '/run')).toEqual({ name: 'run', data: expect.anything() });
		const all = download('fx', 'code1', '/');
		expect(all.name).toBe('code1.zip');
		expect(Object.keys(unzipSync(all.data)).sort()).toEqual(['dir/task.yaml', 'run', 'task.yaml']);
		expect(download('fx', 'code1', '/dir/').name).toBe('dir.zip');
		expect(() => download('fx', 'code1', '/nope')).toThrow('Invalid path');
	});
});
