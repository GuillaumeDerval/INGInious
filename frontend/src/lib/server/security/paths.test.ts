/**
 * Unit tests of the path safety helpers (path traversal protection).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanRelativePath, safeJoin, isValidId, UnsafePathError } from './paths.js';

describe('isValidId', () => {
	it('accepts legacy ids and rejects anything else', () => {
		expect(isValidId('LSINF1252_2024-a')).toBe(true);
		expect(isValidId('v1.2')).toBe(true);
		for (const bad of ['', 'a/b', '.', '..', 'a b', 'é', 42, null]) expect(isValidId(bad)).toBe(false);
	});
});

describe('cleanRelativePath', () => {
	it('normalises harmless paths', () => {
		expect(cleanRelativePath('a/b/../c')).toBe('a/c');
		expect(cleanRelativePath('./a//b/')).toBe('a/b');
		expect(cleanRelativePath('a\\b')).toBe('a/b');
		expect(cleanRelativePath('.')).toBe('');
		expect(cleanRelativePath('')).toBe('');
	});

	it('rejects traversal, absolute paths and NUL bytes', () => {
		for (const bad of ['..', '../x', 'a/../../x', '/etc/passwd', 'C:\\x', 'a\0b', '..\\x']) {
			expect(() => cleanRelativePath(bad), bad).toThrow(UnsafePathError);
		}
	});
});

describe('safeJoin', () => {
	let base: string;
	let outside: string;
	beforeAll(() => {
		const root = mkdtempSync(join(tmpdir(), 'paths-'));
		base = join(root, 'base');
		outside = join(root, 'outside');
		mkdirSync(join(base, 'course', 'task'), { recursive: true });
		mkdirSync(outside);
		writeFileSync(join(outside, 'secret'), 'x');
		symlinkSync(outside, join(base, 'evil'));
		symlinkSync(join(base, 'course'), join(base, 'alias'));
	});

	it('joins paths inside the base directory', () => {
		expect(safeJoin(base, 'course', 'task/run')).toBe(join(base, 'course', 'task', 'run'));
		expect(safeJoin(base, 'course/new/deep/file')).toBe(join(base, 'course', 'new', 'deep', 'file'));
		expect(safeJoin(base)).toBe(base);
		expect(safeJoin(base, 'alias/task')).toBe(join(base, 'alias', 'task'));
	});

	it('rejects traversal and symlink escapes', () => {
		expect(() => safeJoin(base, '../outside/secret')).toThrow(UnsafePathError);
		expect(() => safeJoin(base, 'course', '../../outside')).toThrow(UnsafePathError);
		expect(() => safeJoin(base, 'evil/secret')).toThrow(UnsafePathError);
		expect(() => safeJoin(base, 'evil/notyet/file')).toThrow(UnsafePathError);
	});

	it('works when the base directory does not exist yet', () => {
		expect(safeJoin(join(base, 'missing'), 'x')).toBe(join(base, 'missing', 'x'));
	});
});
