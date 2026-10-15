import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compileMo, setupCourses, type CoursesEnv } from '../../../../tests/fixtures/courses/setup.js';
import * as f from './files.js';

let env: CoursesEnv;
beforeAll(async () => {
	env = await setupCourses();
});
afterAll(() => env.cleanup());

describe('ids and paths', () => {
	it('accepts legacy ids and refuses others', () => {
		for (const id of ['a', 'A-b_c.d', '01_x']) expect(f.idChecker(id)).toBe(true);
		for (const id of ['', '.', '..', 'a/b', 'a b', 'é', 3, '$common']) expect(f.idChecker(id)).toBe(false);
	});
	it('builds safe paths', () => {
		expect(f.coursePath('fx', 'course.yaml')).toBe(join(env.dir, 'fx', 'course.yaml'));
		expect(() => f.coursePath('fx', '../../etc')).toThrow('Unsafe path');
		expect(f.tasksDir()).toBe(env.dir);
	});
});

describe('yaml', () => {
	it('parses YAML 1.1 booleans but keeps dates as strings', () => {
		expect(f.parseYaml('a: yes\nb: 2014-07-16\nc: on\nd: !!str x')).toEqual({
			a: true,
			b: '2014-07-16',
			c: true,
			d: 'x'
		});
	});
	it('reads y/n as strings like PyYAML (JWK keys of an LTI key set)', () => {
		expect(f.parseYaml('n: abc\ne: AQAB\ny: n\nY: N\nz: No\nw: OFF')).toEqual({
			n: 'abc',
			e: 'AQAB',
			y: 'n',
			Y: 'N',
			z: false,
			w: false
		});
	});
	it('dumps in the legacy style', () => {
		const out = f.dumpYaml({
			name: 'x',
			ctx: 'l1\t\nl2   \n',
			d: '2024-01-01',
			yy: 'yes',
			nul: null,
			list: [{ title: 'a', tasks_list: ['t'] }]
		});
		expect(out).toContain('ctx: |\n    l1\n    l2\n');
		expect(out).toContain('d: "2024-01-01"');
		expect(out).toContain('yy: "yes"');
		expect(out).toContain('nul: null');
		expect(f.parseYaml(out)).toEqual({
			name: 'x',
			ctx: 'l1\nl2\n',
			d: '2024-01-01',
			yy: 'yes',
			nul: null,
			list: [{ title: 'a', tasks_list: ['t'] }]
		});
	});
});

describe('cache and atomic writes', () => {
	it('reloads only when the mtime changes', () => {
		const path = join(env.dir, 'cache.txt');
		f.writeFileAtomic(path, 'one');
		let loads = 0;
		const load = () => f.cachedLoad(path, (b) => (loads++, b.toString()));
		expect(load()).toBe('one');
		expect(load()).toBe('one');
		expect(loads).toBe(1);
		writeFileSync(path, 'two');
		utimesSync(path, new Date(), new Date(Date.now() + 5000));
		expect(load()).toBe('two');
		f.invalidateCache(env.dir);
		expect(load()).toBe('two');
		expect(loads).toBe(3);
		expect(() => f.cachedLoad(join(env.dir, 'nope'), String)).toThrow();
	});
	it('creates parent folders', () => {
		const path = join(env.dir, 'new', 'deep', 'f.yaml');
		f.writeFileAtomic(path, 'x: 1');
		expect(readFileSync(path, 'utf8')).toBe('x: 1');
		expect(existsSync(`${path}.tmp`)).toBe(false);
	});
});

describe('gettext catalogs', () => {
	it('parses both byte orders and skips plural/context entries', () => {
		for (const be of [false, true]) {
			const cat = f.parseMo(compileMo({ '': 'header', Hello: 'Bonjour', 'a\0b': 'x', 'ctx\x04c': 'y' }, be));
			expect([...cat.entries()]).toEqual([['Hello', 'Bonjour']]);
		}
		expect(() => f.parseMo(Buffer.alloc(28))).toThrow('Invalid .mo file');
	});
	it('translates through $i18n/<lang>.mo', () => {
		const dir = join(env.dir, 'i18n');
		mkdirSync(dir);
		writeFileSync(join(dir, 'fr.mo'), compileMo({ Hello: 'Bonjour', Empty: '' }));
		writeFileSync(join(dir, 'de.mo'), 'garbage');
		const tr = f.translator([join(dir, 'none'), dir]);
		expect(tr('fr', 'Hello')).toBe('Bonjour');
		expect(tr('fr', 'Empty')).toBe('Empty');
		expect(tr('fr', '')).toBe('');
		expect(tr('nl', 'Hello')).toBe('Hello');
		expect(tr('de', 'Hello')).toBe('Hello');
		expect(tr('../fr', 'Hello')).toBe('Hello');
		expect(f.translator([])('fr', 'Hello')).toBe('Hello');
	});
});
