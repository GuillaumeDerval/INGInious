/**
 * Unit tests of the course administration routes (CADM-02..16): rights
 * matrix (real 403s), redirects, user search, and the form actions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { services } from '#lib/server/app.js';
import { parseYaml } from '#lib/server/courses/files.js';
import { plugins, resetPlugins } from '#lib/server/plugins/index.js';
import { fakeEvent, settle, setup, type CoursesEnv } from '#lib/server/course-admin/testing/helpers.js';
import { load as layoutLoad } from './+layout.server.js';
import { load as redirectLoad } from './+page.server.js';
import { GET as searchUser } from './search_user/+server.js';
import { POST as preview } from './preview/+server.js';
import * as settings from './settings/+page.server.js';
import * as tasks from './tasks/+page.server.js';
import * as editor from './edit/task/[taskid]/+page.server.js';
import * as files from './edit/task/[taskid]/files/+page.server.js';
import { GET as download } from './edit/task/[taskid]/files/download/+server.js';
import * as danger from './danger/+page.server.js';

let env: CoursesEnv;
beforeAll(async () => {
	env = await setup();
	await env.db.c.users.insertMany([
		{ username: 'admin1', realname: 'Ada', email: 'a@x', language: 'en', bindings: {} },
		{ username: 'a.b', realname: 'Dot (x)', email: 'd@x', language: 'en', bindings: {} },
		{ username: 'inactive', realname: 'Ina', email: 'i@x', language: 'en', bindings: {}, activate: 'h' }
	]);
});
afterAll(() => env.cleanup());

const P = (taskid?: string) => ({ courseid: 'fx', ...(taskid ? { taskid } : {}) });
const call = (fn: (e: never) => unknown, user: string | null, params = P(), opts = {}) =>
	settle(() => fn(fakeEvent(user, params, opts)) as Promise<unknown>);
const yaml = (...p: string[]) => parseYaml(readFileSync(join(env.dir, 'fx', ...p), 'utf8')) as Record<string, unknown>;

describe('CADM-02 layout, redirect and rights', () => {
	it('builds the admin menu for admins and tutors', async () => {
		plugins().addHook('course_admin_menu', () => ({ label: 'Plugin page', href: '/plugin' }));
		const admin = (await call(layoutLoad as never, 'admin1')).value as {
			nav: { items: { href: string }[] }[];
			admin: boolean;
		};
		const hrefs = (nav: typeof admin.nav) => nav.slice(1, 4).flatMap((s) => s.items.map((i) => i.href));
		expect(hrefs(admin.nav)).toEqual([
			'/admin/fx/settings',
			'/admin/fx/tasks',
			'/admin/fx/danger',
			'/plugin',
			'/admin/fx/students',
			'/admin/fx/students?tab=audiences',
			'/admin/fx/students?tab=groups',
			'/admin/fx/submissions',
			'/admin/fx/stats'
		]);
		expect(admin.nav[0]).toMatchObject({ context: 'Course administration', contextHref: '/course/fx', items: [] });
		const tutor = (await call(layoutLoad as never, 'tutor1')).value as typeof admin;
		expect(hrefs(tutor.nav)).toEqual([
			'/plugin',
			'/admin/fx/students',
			'/admin/fx/students?tab=audiences',
			'/admin/fx/students?tab=groups',
			'/admin/fx/submissions',
			'/admin/fx/stats'
		]);
		expect(tutor.admin).toBe(false);
		resetPlugins();
		expect(await call(layoutLoad as never, 'student')).toMatchObject({ status: 403 });
		expect(await call(layoutLoad as never, null)).toMatchObject({ status: 302 });
		expect(await call(layoutLoad as never, 'admin1', { courseid: 'nope' })).toMatchObject({ status: 404 });
	});
	it('redirects tutors to the tasks and admins to the settings', async () => {
		expect(await call(redirectLoad as never, 'tutor1')).toMatchObject({ status: 302, location: '/admin/fx/tasks' });
		expect(await call(redirectLoad as never, 'root')).toMatchObject({ status: 302, location: '/admin/fx/settings' });
	});
	it('enforces the rights matrix on every page and action', async () => {
		for (const fn of [
			settings.load,
			settings.actions.default,
			tasks.actions.save,
			tasks.actions.dispenser,
			tasks.actions.migrate,
			editor.load,
			editor.actions.save,
			files.load,
			files.actions.create,
			download,
			danger.load,
			danger.actions.archive,
			danger.actions.delete
		])
			expect(await call(fn as never, 'tutor1', P('code1'), { form: {} })).toMatchObject({ status: 403 });
		expect((await call(tasks.load as never, 'tutor1')).value).toBeTruthy();
		expect(await call(searchUser as never, 'student')).toMatchObject({ status: 403 });
	});
});

describe('CADM-03 search_user', () => {
	it('escapes the query and returns activated users only', async () => {
		const search = async (q: string) =>
			(
				(await call(searchUser as never, 'tutor1', P(), { url: `http://x/?q=${encodeURIComponent(q)}` }))
					.value as Response
			).json();
		expect(await search('ad')).toEqual([{ value: 'admin1', label: 'Ada (admin1)' }]);
		expect(await search('(x)')).toEqual([{ value: 'a.b', label: 'Dot (x) (a.b)' }]);
		expect(await search('.*')).toEqual([]);
		expect(await search('ina')).toEqual([]);
		expect((await search('')).length).toBe(2);
		expect(((await call(searchUser as never, 'tutor1')).value as Response).status).toBe(200);
	});
});

describe('CADM-10 rich text preview', () => {
	it('renders RST and #MD Markdown for staff only', async () => {
		const post = (user: string, body: string) =>
			settle(() =>
				preview(
					Object.assign(fakeEvent(user, P()), { request: new Request('http://x', { method: 'POST', body }) }) as never
				)
			);
		expect(await ((await post('tutor1', '#MD\n**bold**')).value as Response).text()).toContain('<strong>bold</strong>');
		expect(await post('student', 'x')).toMatchObject({ status: 403 });
	});
});

describe('CADM-03 settings', () => {
	it('loads and saves the settings', async () => {
		const data = (await call(settings.load as never, 'admin1')).value as {
			values: Record<string, unknown>;
			clients: unknown[];
		};
		expect(data.clients).toEqual([]);
		const ok = await call(settings.actions.default as never, 'admin1', P(), {
			form: { settings: JSON.stringify({ ...data.values, name: 'Renamed' }) }
		});
		expect(ok.value).toEqual({ message: 'Settings saved.' });
		expect(yaml('course.yaml').name).toBe('Renamed');
		const bad = await call(settings.actions.default as never, 'admin1', P(), {
			form: { settings: JSON.stringify({ ...data.values, name: '' }) }
		});
		expect(bad.value).toMatchObject({ status: 400, data: { message: 'Invalid name' } });
		expect(
			(await call(settings.actions.default as never, 'admin1', P(), { form: { settings: '{' } })).value
		).toMatchObject({ status: 400 });
	});
});

describe('CADM-06 tasks', () => {
	it('loads the structure, task names, errors and WebDAV credentials', async () => {
		Object.assign(services().config, { webdavHost: 'https://dav.example' });
		const data = (await call(tasks.load as never, 'admin1')).value as Record<string, unknown>;
		Object.assign(services().config, { webdavHost: undefined });
		expect(data).toMatchObject({
			kind: 'toc',
			dispensers: ['toc', 'combinatory_test'],
			tasks: { code1: 'Code task' },
			legacy: true,
			webdav: { url: 'https://dav.example/fx', username: 'admin1' }
		});
		expect(Object.keys(data.errors as object)).toEqual(['broken']);
		expect(((await call(tasks.load as never, 'tutor1')).value as { webdav: unknown }).webdav).toBeNull();
		// Tutors are not shown an API key that WebDAV would refuse anyway.
		Object.assign(services().config, { webdavHost: 'https://dav.example' });
		expect(((await call(tasks.load as never, 'tutor1')).value as { webdav: unknown }).webdav).toBeNull();
		Object.assign(services().config, { webdavHost: undefined });
	});
	it('runs the admin actions', async () => {
		const structure = { toc: [{ title: 'W', tasks_list: ['code1'] }], config: {} };
		const save = (data: string) => call(tasks.actions.save as never, 'admin1', P(), { form: { data } });
		expect((await save(JSON.stringify({ structure, created: [], deleted: [], wiped: [] }))).value).toEqual({
			message: 'Changes saved.'
		});
		expect((await save(JSON.stringify({ structure, created: [], deleted: ['../x'], wiped: [] }))).value).toMatchObject({
			status: 400,
			data: { message: 'Invalid form' }
		});
		expect((await save('{')).value).toMatchObject({ status: 400 });
		expect((await call(tasks.actions.migrate as never, 'admin1', P(), { form: {} })).value).toEqual({
			message: 'Changes saved.'
		});
		expect(
			(await call(tasks.actions.dispenser as never, 'admin1', P(), { form: { dispenser: 'contest' } })).value
		).toMatchObject({ status: 400, data: { message: 'Invalid task dispenser' } });
		expect(
			(await call(tasks.actions.dispenser as never, 'admin1', P(), { form: { dispenser: 'combinatory_test' } })).value
		).toEqual({ message: 'Changes saved.' });
		expect(yaml('course.yaml')).toMatchObject({ task_dispenser: 'combinatory_test', dispenser_data: {} });
	});
});

describe('CADM-10 task editor', () => {
	it('loads an existing task and saves it', async () => {
		expect(await call(editor.load as never, 'admin1', P('nope'))).toMatchObject({ status: 404 });
		const data = (await call(editor.load as never, 'admin1', P('mcq1'))).value as {
			values: Record<string, unknown>;
			problems: unknown[];
		};
		expect(data.problems).toHaveLength(2);
		const ok = await call(editor.actions.save as never, 'admin1', P('mcq1'), {
			form: { task: JSON.stringify({ values: { ...data.values, name: 'New' }, problems: data.problems }) }
		});
		expect(ok.value).toEqual({ message: 'Task saved.' });
		expect(yaml('mcq1', 'task.yaml').name).toBe('New');
		expect(
			(await call(editor.actions.save as never, 'admin1', P('mcq1'), { form: { task: '{}' } })).value
		).toMatchObject({ status: 400, data: { message: 'Invalid form' } });
		const bad = await call(editor.actions.save as never, 'admin1', P('mcq1'), {
			form: { task: JSON.stringify({ values: { ...data.values, input_random: -1 }, problems: [] }) }
		});
		expect(bad.value).toMatchObject({ status: 400 });
		expect(
			await call(editor.actions.save as never, 'admin1', P('created_by_post'), { form: { task: '{}' } })
		).toMatchObject({ status: 404 });
		expect(existsSync(join(env.dir, 'fx', 'created_by_post'))).toBe(false);
		writeFileSync(join(env.dir, 'fx', 'future', 'task.yaml'), 'name: F\nauthor: [A, B]\nenvironment_type: mcq\n');
		const listed = (await call(editor.load as never, 'admin1', P('future'))).value as {
			values: Record<string, unknown>;
			problems: unknown[];
		};
		expect(listed.values.author).toBe('A, B');
		expect(listed.problems).toEqual([]);
	});
});

describe('CADM-14 task files', () => {
	const act = (name: keyof typeof files.actions, form: Record<string, string | Blob>) =>
		call(files.actions[name] as never, 'admin1', P('code1'), { form });
	it('lists, creates, uploads, edits, moves, deletes and downloads files', async () => {
		expect((await act('create', { path: '/run' })).value).toEqual({ message: 'Changes saved.' });
		expect((await act('create', { path: '/run' })).value).toMatchObject({
			status: 400,
			data: { message: 'Invalid path: /run' }
		});
		expect((await act('upload', { file: new File(['up'], 'up.txt') })).value).toEqual({ message: 'Changes saved.' });
		expect((await act('upload', { path: '/x' })).value).toMatchObject({ status: 400, data: { message: 'No file' } });
		expect((await act('save', { path: '/up.txt', content: 'edited' })).value).toEqual({ message: 'Changes saved.' });
		expect((await act('rename', { path: '/up.txt', new_path: '/d/up2.txt' })).value).toEqual({
			message: 'Changes saved.'
		});
		const page = (await call(files.load as never, 'admin1', P('code1'), { url: 'http://x/?open=%2Fd%2Fup2.txt' }))
			.value as { files: { path: string }[]; opened: unknown };
		expect(page.opened).toEqual({ path: '/d/up2.txt', content: 'edited', error: '' });
		expect(page.files.map((f) => f.path)).toContain('/d/up2.txt');
		const bad = (await call(files.load as never, 'admin1', P('code1'), { url: 'http://x/?open=%2F..%2Fx' })).value as {
			opened: { content: null };
		};
		expect(bad.opened.content).toBeNull();
		expect(((await call(files.load as never, 'admin1', P('code1'))).value as { opened: null }).opened).toBeNull();
		const res = (await call(download as never, 'admin1', P('code1'), { url: 'http://x/?path=%2Fd%2Fup2.txt' }))
			.value as Response;
		expect(res.headers.get('content-disposition')).toBe(`attachment; filename="up2.txt"; filename*=UTF-8''up2.txt`);
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(await res.text()).toBe('edited');
		expect(((await call(download as never, 'admin1', P('code1'), { url: 'http://x/' })).value as Response).status).toBe(
			200
		);
		expect(await call(download as never, 'admin1', P('code1'), { url: 'http://x/?path=%2Fnope' })).toMatchObject({
			status: 404
		});
		expect(await call(download as never, 'admin1', P('..'), { url: 'http://x/?path=%2F' })).toMatchObject({
			status: 404
		});
		expect((await act('delete', { path: '/d/' })).value).toEqual({ message: 'Changes saved.' });
		expect(existsSync(join(env.dir, 'fx', 'code1', 'd'))).toBe(false);
	});
	it('reports unexpected write errors as 500', async () => {
		await act('create', { path: '/f' });
		expect((await act('create', { path: '/f/sub' })).value).toMatchObject({ status: 500 });
	});
});

describe('CADM-15/16 danger zone', () => {
	it('archives and deletes the course after the typed id check', async () => {
		expect(((await call(danger.load as never, 'admin1')).value as { archived: boolean }).archived).toBe(false);
		expect(
			(await call(danger.actions.archive as never, 'admin1', P(), { form: { courseid: 'other' } })).value
		).toMatchObject({ status: 400, data: { message: 'Wrong course id.' } });
		const ok = (await call(danger.actions.archive as never, 'admin1', P(), { form: { courseid: 'fx' } })).value as {
			archive: string;
		};
		expect(ok.archive).toMatch(/^fx_archive_/);
		const again = await call(
			danger.actions.archive as never,
			'admin1',
			{ courseid: ok.archive },
			{ form: { courseid: ok.archive } }
		);
		expect(again.value).toMatchObject({ status: 400 });
		expect(
			(await call(danger.actions.delete as never, 'admin1', P(), { form: { courseid: 'x' } })).value
		).toMatchObject({ status: 400 });
		expect(await call(danger.actions.delete as never, 'admin1', P(), { form: { courseid: 'fx' } })).toMatchObject({
			status: 303,
			location: '/'
		});
		expect(existsSync(join(env.dir, 'fx'))).toBe(false);
		expect(existsSync(join(env.dir, ok.archive))).toBe(true);
	});
});
