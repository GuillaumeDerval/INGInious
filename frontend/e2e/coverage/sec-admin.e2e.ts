/**
 * Integration tests of the access rules of the course administration and of the
 * course plugins: same answer for unknown and foreign course ids (CADM-02), stored
 * course structure (CADM-07), staff views of users related to the course only
 * (CSTU-09), tasks listed by the contest and scoreboard pages (SITE-13/14), contest
 * settings and simple grader endpoint refused to the wrong callers (SITE-14/18).
 */
import { readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { Page } from '@playwright/test';
import { test, expect, installCourse, withDb } from '../fixtures.js';
import { E2E } from '../setup-data.js';

const TASKS = E2E.tasksDir;
/** Parses the course.yaml of an installed course (YAML 1.1 like PyYAML). */
const courseYaml = (c: string) => parse(readFileSync(join(TASKS, c, 'course.yaml'), 'utf8'), { version: '1.1' });
let n = 0;
/** Installs a fresh copy of a fixture course, merging `patch` into its course.yaml. */
function course(fixture: string, patch: Record<string, unknown> = {}): string {
	const c = installCourse(fixture, `e2e_secc_${Date.now() % 100000}${n++}`);
	writeFileSync(join(TASKS, c, 'course.yaml'), stringify({ ...courseYaml(c), ...patch }));
	return c;
}
/** Registers students in a course. */
const register = (c: string, students: string[]) =>
	withDb((db) => db.collection('courses').updateOne({ _id: c as never }, { $set: { students } }, { upsert: true }));
/** Raw HTML of a page (server rendering, data payload included). */
const html = async (page: Page, url: string) => (await page.request.get(url)).text();
/** Posts a form action like `use:enhance` (JSON answer, same origin). */
const act = async (page: Page, url: string, form: Record<string, string>) => {
	const res = await page.request.post(url, {
		form,
		headers: { origin: new URL(page.url()).origin, 'x-sveltekit-action': 'true', accept: 'application/json' }
	});
	return { status: res.status(), text: await res.text() };
};

test('CADM-02 unknown and foreign course ids answer the same status to non-superadmins', async ({ page, loginAs }) => {
	const foreign = course('site_contest');
	const missing = `e2e_secc_missing_${Date.now()}`;
	await loginAs('e2e_tutor');
	for (const c of [foreign, missing])
		for (const path of ['tasks', 'students', 'settings']) {
			expect((await page.request.get(`/admin/${c}/${path}`)).status(), `${c}/${path}`).toBe(403);
		}
	await loginAs('superadmin');
	expect((await page.request.get(`/admin/${missing}/tasks`)).status()).toBe(404);
	expect((await page.request.get(`/admin/${foreign}/tasks`)).status()).toBe(200);
	// Anonymous visitors are sent to the sign-in page in both cases.
	await page.context().clearCookies();
	for (const c of [foreign, missing]) {
		const res = await page.request.get(`/admin/${c}/tasks`, { maxRedirects: 0 });
		expect(res.headers().location).toMatch(/^\/signin/);
	}
});

test('CADM-07 the saved structure keeps only the keys of the course.yaml format', async ({ page, loginAs }) => {
	const c = course('cov_admin');
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/tasks`);
	const structure = {
		toc: [{ title: 'S', id: 'x', other: 1, config: { closed: true, other: 2 }, tasks_list: ['task1'] }],
		config: { task1: { weight: 3, other: 'x', submission_limit: { amount: 2, period: 1, other: 1 } } },
		other: 'dropped'
	};
	const data = JSON.stringify({ structure, created: [], deleted: [], wiped: [] });
	expect((await act(page, `/admin/${c}/tasks?/save`, { data })).text).toContain('Changes saved.');
	expect(courseYaml(c).dispenser_data).toEqual({
		toc: [{ title: 'S', config: { closed: true }, tasks_list: ['task1'] }],
		config: { task1: { weight: 3, submission_limit: { amount: 2, period: 1 } } },
		imported: false
	});
});

test('CSTU-09 course staff only see the users related to their course', async ({ page, loginAs }) => {
	const c = course('cov_admin');
	await register(c, ['e2e_student1']);
	await withDb((db) =>
		db.collection('submissions').insertOne({
			courseid: c,
			taskid: 'task1',
			username: ['e2e_student2'],
			status: 'done',
			result: 'success',
			grade: 100,
			submitted_on: new Date()
		})
	);
	await loginAs('e2e_tutor');
	const student = (u: string) => page.request.get(`/admin/${c}/student/${u}`);
	const csv = (u: string) => page.request.get(`/admin/${c}/students/student.csv?username=${u}`);
	// Registered student, former student with a submission, staff member: shown.
	for (const u of ['e2e_student1', 'e2e_student2', 'e2e_admin']) {
		expect((await student(u)).status(), u).toBe(200);
		expect((await csv(u)).status(), u).toBe(200);
	}
	// The member picker only offers the registered students.
	const options = await (await page.request.get(`/admin/${c}/students/students.json`)).json();
	expect(options.map((o: { value: string }) => o.value)).toEqual(['e2e_student1']);
	// A user of the platform unrelated to the course, an unknown user: 404.
	for (const u of ['e2e_student3', 'nobody_secc']) {
		expect((await student(u)).status(), u).toBe(404);
		expect((await csv(u)).status(), u).toBe(404);
	}
});

test('SITE-14 contest tasks are listed to students once the contest started, hidden tasks never', async ({
	page,
	loginAs
}) => {
	const settings = (start: string) => ({
		contest_settings: { enabled: true, start, end: '2099-01-01 00:00:00+00:00', blackout: 0, penalty: 30 },
		toc_data: { toc: [{ title: 'Problems', tasks_list: ['mcq1', 'code1'] }], config: { mcq1: {}, code1: {} } }
	});
	const future = course('site_contest', { tutors: ['e2e_tutor'], dispenser_data: settings('2098-01-01 00:00:00') });
	const started = course('site_contest', { tutors: ['e2e_tutor'], dispenser_data: settings('2020-01-01 00:00:00') });
	// A task outside the contest structure.
	cpSync(join(TASKS, started, 'mcq1'), join(TASKS, started, 'hidden1'), { recursive: true });
	for (const c of [future, started]) await register(c, ['e2e_student1']);
	await loginAs('e2e_student1');
	expect(await html(page, `/contest/${future}`)).not.toMatch(/"(mcq1|code1)"/);
	const student = await html(page, `/contest/${started}`);
	expect(student).toMatch(/"mcq1"/);
	expect(student).not.toContain('"hidden1"');
	await loginAs('e2e_admin');
	expect(await html(page, `/contest/${future}`)).toMatch(/"mcq1"/);
	expect(await html(page, `/contest/${started}`)).toContain('"hidden1"');
	// The contest settings are reserved to course admins: tutors are refused.
	await loginAs('e2e_tutor');
	expect((await page.request.get(`/contest/${started}/admin`)).status()).toBe(403);
	expect((await act(page, `/contest/${started}/admin`, { start: '2020-01-01 00:00:00' })).status).toBe(403);
});

test('SITE-13 a scoreboard only lists the started tasks to students', async ({ page, loginAs }) => {
	const c = course('cov_admin', { scoreboard: [{ name: 'Board', content: ['task1', 'noconf'] }] });
	await register(c, ['e2e_student1']);
	const sub = (taskid: string, score: number) => ({
		courseid: c,
		taskid,
		username: ['e2e_student1'],
		status: 'done',
		result: 'success',
		grade: 100,
		custom: { score },
		submitted_on: new Date()
	});
	await withDb((db) => db.collection('submissions').insertMany([sub('task1', 4), sub('noconf', 7)]));
	await loginAs('e2e_student1');
	await page.goto(`/scoreboard/${c}/0`);
	await expect(page.getByRole('columnheader', { name: 'Task one' })).toBeVisible();
	await expect(page.getByText('No config')).toHaveCount(0);
	await loginAs('e2e_admin');
	await page.goto(`/scoreboard/${c}/0`);
	await expect(page.getByRole('columnheader', { name: 'No config' })).toBeVisible();
});

test('SITE-18 the simple grader endpoint refuses requests without the API key', async ({ request }) => {
	for (const data of [
		{ taskid: 'mcq1', input: '{}' },
		{ taskid: 'mcq1', input: '{}', api_key: 'wrong' }
	]) {
		const res = await request.post('/external', { form: data });
		expect(res.status()).toBe(403);
		expect(await res.json()).toEqual({ status: 'error', status_message: 'Invalid API key' });
	}
	// CORS preflight of the JSON posts.
	expect((await request.fetch('/external', { method: 'OPTIONS' })).status()).toBe(204);
});
