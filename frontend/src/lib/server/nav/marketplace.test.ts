/**
 * Unit tests of the marketplace (NAV-18/19): remote list (mocked fetch),
 * localisation, import (mocked git) and the form action.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRedirect } from '@sveltejs/kit';
import { setupNav, type NavEnv } from '../../../../tests/fixtures/nav/setup.js';
import { parseYaml } from '../courses/files.js';

const git = vi.hoisted(() => ({ impl: (() => {}) as (args: string[]) => void }));
vi.mock('node:child_process', () => ({
	execFile: (_cmd: string, args: string[], _opts: unknown, cb: (e: Error | null, out?: unknown) => void) => {
		try {
			git.impl(args);
			cb(null, { stdout: '', stderr: '' });
		} catch (e) {
			cb(e as Error);
		}
	}
}));

const { importAction, importCourse, marketCourses, pick, MARKETPLACE_URL } = await import('./marketplace.js');

const DEMO = {
	id: 'demo-tasks',
	link: 'https://github.com/UCL-INGI/INGInious-demo-tasks',
	languages: 'English / French',
	license: 'GPL 3.0',
	maintainers: 'UCL',
	authors: 'Somebody',
	default_language: 'en',
	name: { en: 'Demo tasks', fr: 'Tâches de démo' },
	short_desc: { fr: 'Court' },
	description: { de: 'Beschreibung' }
};

let env: NavEnv;
const fetchMock = vi.fn();
beforeAll(async () => {
	env = await setupNav();
	vi.stubGlobal('fetch', fetchMock);
});
afterAll(() => env.cleanup());
beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockResolvedValue({ json: async () => [DEMO] });
	// A fake clone: a repository with a course.yaml (legacy toc format) and a .git folder.
	git.impl = (args) => {
		const dir = args[args.length - 1];
		mkdirSync(join(dir, '.git'), { recursive: true });
		writeFileSync(
			join(dir, 'course.yaml'),
			'name: Demo\ndescription: Hello\ntoc: [{title: A, tasks_list: [t1]}]\nadmins: [x]\n'
		);
	};
});

describe('marketplace list', () => {
	it('NAV-18 fetches and validates the remote list', async () => {
		expect(await marketCourses()).toEqual([DEMO]);
		expect(fetchMock.mock.calls[0][0]).toBe(MARKETPLACE_URL);
		fetchMock.mockResolvedValue({ json: async () => [{ id: 'x' }] });
		expect(await marketCourses()).toEqual([]);
		fetchMock.mockRejectedValue(new Error('offline'));
		expect(await marketCourses()).toEqual([]);
	});

	it('NAV-18 localises fields with fallbacks', () => {
		expect(pick(DEMO, 'name', 'fr')).toBe('Tâches de démo');
		expect(pick(DEMO, 'name', 'de')).toBe('Demo tasks');
		expect(pick(DEMO, 'short_desc', 'en')).toBe('Court');
		expect(pick(DEMO, 'description', 'en')).toBe('Beschreibung');
		expect(pick({ ...DEMO, short_desc: {} }, 'short_desc', 'en')).toBe('');
	});
});

describe('import', () => {
	it('NAV-18 clones and rewrites course.yaml, removing .git', async () => {
		expect(await importCourse(DEMO, 'navmkt1', 'superadmin')).toBeNull();
		const dir = join(env.dir, 'navmkt1');
		expect(existsSync(join(dir, '.git'))).toBe(false);
		expect(parseYaml(readFileSync(join(dir, 'course.yaml'), 'utf8'))).toEqual({
			description: 'Hello',
			admins: ['superadmin'],
			accessible: false,
			tags: {},
			name: 'Demo - navmkt1',
			task_dispenser: 'toc',
			dispenser_data: { config: {}, toc: [{ title: 'A', tasks_list: ['t1'] }] }
		});
	});

	it('NAV-18 starts from scratch without a valid course.yaml', async () => {
		git.impl = (args) => {
			mkdirSync(args[args.length - 1], { recursive: true });
			writeFileSync(join(args[args.length - 1], 'course.yaml'), '');
		};
		await importCourse(DEMO, 'navmkt2', 'superadmin');
		expect(parseYaml(readFileSync(join(env.dir, 'navmkt2', 'course.yaml'), 'utf8'))).toEqual({
			description: '',
			admins: ['superadmin'],
			accessible: false,
			tags: {},
			name: 'navmkt2'
		});
	});

	it('NAV-18 refuses bad ids, existing courses, non-https links and failed clones', async () => {
		expect(await importCourse(DEMO, 'nav_open', 'superadmin')).toBe('Course with id nav_open already exists.');
		expect(await importCourse({ ...DEMO, link: 'ssh://evil/x' }, 'navmkt3', 'superadmin')).toBe(
			"Couldn't clone course into your instance"
		);
		git.impl = (args) => {
			mkdirSync(args[args.length - 1], { recursive: true });
			throw new Error('fatal');
		};
		expect(await importCourse(DEMO, 'navmkt4', 'superadmin')).toBe("Couldn't clone course into your instance");
		expect(existsSync(join(env.dir, 'navmkt4'))).toBe(false);
	});
});

describe('importAction', () => {
	const event = (fields: Record<string, string>, superadmin = true) =>
		({
			locals: { user: { username: 'superadmin', superadmin }, session: { doc: {} } },
			url: new URL('http://x/marketplace'),
			request: new Request('http://x/marketplace', { method: 'POST', body: new URLSearchParams(fields) })
		}) as never;

	it('NAV-18/19 imports then redirects, or reports errors', async () => {
		const target = (id: string) => `/course/${id}`;
		expect(await importAction(event({ new_courseid: 'bad id' }), 'demo-tasks', target)).toMatchObject({
			status: 400,
			data: { message: 'Course with invalid name: bad id' }
		});
		expect(await importAction(event({ courseid: 'zzz', new_courseid: 'navmkt5' }), null, target)).toMatchObject({
			data: { message: 'User returned an invalid form.' }
		});
		expect(await importAction(event({ courseid: 'demo-tasks', new_courseid: 'nav_open' }), null, target)).toMatchObject(
			{ data: { message: 'Course with id nav_open already exists.' } }
		);
		try {
			await importAction(event({ courseid: 'demo-tasks', new_courseid: 'navmkt6' }), null, target);
			expect.unreachable();
		} catch (e) {
			expect(isRedirect(e) && e.location).toBe('/course/navmkt6');
		}
		expect(await importAction(event({}), null, target)).toMatchObject({
			data: { message: 'Course with invalid name: ' }
		});
		expect(await importAction(event({ new_courseid: 'navmkt9' }), null, target)).toMatchObject({
			data: { message: 'User returned an invalid form.' }
		});
		await expect(importAction(event({ new_courseid: 'navmkt7' }, false), 'demo-tasks', target)).rejects.toMatchObject({
			status: 403
		});
	});

	it('rethrows unexpected errors', async () => {
		// A course.yaml that is a directory makes the final write fail.
		git.impl = (args) => mkdirSync(join(args[args.length - 1], 'course.yaml'), { recursive: true });
		await expect(
			importAction(event({ courseid: 'demo-tasks', new_courseid: 'navmkt8' }), null, (id) => id)
		).rejects.toThrow();
	});
});
