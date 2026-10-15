/**
 * Integration tests of the course lists: /courselist (NAV-01), /mycourses
 * (NAV-02, NAV-03, NAV-04/CADM-01, NAV-21) and the upcoming tasks page (NAV-20).
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, withDb } from '../fixtures.js';
import { register, setupNav } from './helpers.js';
import { E2E } from '../setup-data.js';

const TASKS = E2E.tasksDir;
let ids: Record<string, string>;
test.beforeAll(async () => {
	ids = await setupNav('lists', [
		'nav_open',
		'nav_pwd',
		'nav_closed',
		'nav_acl',
		'nav_lti',
		'nav_archive',
		'nav_combi',
		'nav_broken'
	]);
	await register(ids.nav_open, 'nav_alice');
	await register(ids.nav_combi, 'nav_alice');
	await register(ids.nav_closed, 'nav_alice');
	await withDb((db) =>
		db.collection('users').updateMany({ username: { $in: ['nav_alice', 'nav_bob'] } }, { $set: { pinned_courses: [] } })
	);
});

/** Card of a course on /courselist. */
const card = (page: import('@playwright/test').Page, id: string) => page.locator(`article[data-course-id="${id}"]`);

test('NAV-01 anonymous visitors see the open courses with their badges', async ({ page }) => {
	// Many courses exist in the test environment: the server-side search (name or id) finds the ones of this file.
	await page.goto('/courselist?q=_lists');
	await expect(page.getByRole('heading', { name: 'Course list', level: 1 })).toBeVisible();
	await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toBeVisible();
	for (const id of [ids.nav_open, ids.nav_pwd, ids.nav_acl, ids.nav_lti]) await expect(card(page, id)).toBeVisible();
	for (const id of [ids.nav_closed, ids.nav_archive, ids.nav_broken]) await expect(card(page, id)).toHaveCount(0);
	await expect(card(page, ids.nav_pwd).getByText('Password required')).toBeVisible();
	await expect(card(page, ids.nav_pwd).getByRole('link', { name: /Register/ })).toHaveAttribute(
		'href',
		`/register/${ids.nav_pwd}`
	);
	await expect(card(page, ids.nav_acl).getByText('Registration closed')).toBeVisible();
	await expect(card(page, ids.nav_acl).getByRole('link')).toHaveCount(0);
	await expect(card(page, ids.nav_lti).getByText('External platform')).toBeVisible();
	await expect(card(page, ids.nav_lti).getByRole('link')).toHaveAttribute('href', 'https://lms.example.org/course/1');
	await expect(card(page, ids.nav_lti).getByRole('link')).toHaveAttribute('target', '_blank');
	await expect(card(page, ids.nav_open).locator('strong', { hasText: 'NAV open course' })).toBeVisible();
	await page.getByRole('searchbox').fill('password');
	await expect(card(page, ids.nav_open)).toHaveCount(0);
	await expect(page).toHaveURL(/\?q=password$/);
});

test('NAV-01 logged-in users get their ACL badges and the My courses hint', async ({ loginAs }) => {
	const page = await loginAs('nav_carol');
	await page.goto('/courselist?q=_lists');
	await expect(page.getByText('Public courses')).toBeVisible();
	await expect(card(page, ids.nav_acl).getByText('Registration open')).toBeVisible();
	await expect(card(page, ids.nav_open).getByText('Registration open')).toBeVisible();
});

test('NAV-02 a student sees his open registered courses, filters and searches them', async ({ loginAs }) => {
	const page = await loginAs('nav_alice');
	await page.goto('/mycourses');
	// Only the courses of this file (other files register nav_alice elsewhere).
	const items = page.locator('article[data-course-id$="_lists"]');
	await expect(items).toHaveCount(2);
	await expect(page.locator(`article[data-course-id="${ids.nav_open}"]`)).toContainText('Student');
	await expect(page.locator(`article[data-course-id="${ids.nav_open}"]`)).toContainText('0 / 6 tasks succeeded');
	await page.getByRole('searchbox').fill('OPEN');
	await expect(items).toHaveCount(1);
	await page.getByRole('searchbox').fill('zzz');
	await expect(items).toHaveCount(0);
});

test('NAV-02 staff roles and course states are shown, superadmins see every course', async ({ loginAs }) => {
	const page = await loginAs('superadmin');
	await page.goto('/mycourses?q=_lists');
	await expect(page.locator(`article[data-course-id="${ids.nav_closed}"]`)).toContainText(
		/Administrator\s*Hidden course/
	);
	await expect(page.locator(`article[data-course-id="${ids.nav_archive}"]`)).toContainText(/Archive - .*2026/);
	await expect(page.locator(`article[data-course-id="${ids.nav_lti}"]`)).toContainText('LTI course');
	await page.getByRole('link', { name: 'LTI', exact: true }).click();
	await expect(page).toHaveURL(/q=_lists&filter=lti/);
	await expect(page.locator(`article[data-course-id="${ids.nav_open}"]`)).toHaveCount(0);
	await expect(page.locator(`article[data-course-id="${ids.nav_lti}"]`)).toBeVisible();
	const tutor = await loginAs('nav_tutor');
	await tutor.goto('/mycourses?q=_lists');
	await expect(tutor.locator(`article[data-course-id="${ids.nav_open}"]`)).toContainText('Tutor');
});

test('NAV-02 empty state for a user without course', async ({ loginAs }) => {
	const page = await loginAs('nav_eve');
	await page.goto('/mycourses');
	await expect(page.getByText('You are not registered to any course')).toBeVisible();
	await expect(page.getByText('No submissions')).toBeVisible();
});

test('NAV-03 a student pins and unpins a course', async ({ loginAs }) => {
	const page = await loginAs('nav_alice');
	await page.goto('/mycourses');
	const open = page.locator(`article[data-course-id="${ids.nav_open}"]`);
	await open.getByRole('button', { name: 'Pin' }).click();
	await expect(open.getByRole('button', { name: 'Unpin' })).toBeVisible();
	expect(await withDb((db) => db.collection('users').findOne({ username: 'nav_alice' }))).toMatchObject({
		pinned_courses: [ids.nav_open]
	});
	await page.reload();
	// Pinned courses come first.
	await expect(page.locator('article[data-course-id]').first()).toHaveAttribute('data-course-id', ids.nav_open);
	await page.getByRole('link', { name: 'Pinned', exact: true }).click();
	await expect(page.locator('article[data-course-id]')).toHaveCount(1);
	await open.getByRole('button', { name: 'Unpin' }).click();
	await expect(open).toHaveCount(0);
	expect((await withDb((db) => db.collection('users').findOne({ username: 'nav_alice' })))!.pinned_courses).toEqual([]);
});

test('NAV-03 unknown or foreign courses cannot be pinned, nor more than 6', async ({ loginAs, baseURL }) => {
	const page = await loginAs('nav_bob');
	const post = (courseid: string) =>
		page.request.post('/mycourses?/pin', {
			form: { courseid },
			headers: { origin: baseURL!, 'x-sveltekit-action': 'true' }
		});
	expect((await (await post('doesnotexist')).json()).status).toBe(404);
	expect((await (await post(ids.nav_closed)).json()).status).toBe(404);
	expect((await withDb((db) => db.collection('users').findOne({ username: 'nav_bob' })))!.pinned_courses).toEqual([]);
	const admin = await loginAs('superadmin');
	await withDb((db) =>
		db.collection('users').updateOne(
			{ username: 'superadmin' },
			{
				$set: {
					pinned_courses: [ids.nav_open, ids.nav_pwd, ids.nav_closed, ids.nav_acl, ids.nav_lti, ids.nav_archive]
				}
			}
		)
	);
	await admin.goto(`/mycourses?q=${ids.nav_combi}`);
	await admin.locator(`article[data-course-id="${ids.nav_combi}"]`).getByRole('button', { name: 'Pin' }).click();
	await expect(admin.getByText('You are not allowed to have more than 6 pinned courses.')).toBeVisible();
	await withDb((db) => db.collection('users').updateOne({ username: 'superadmin' }, { $set: { pinned_courses: [] } }));
});

test('NAV-04 CADM-01 a superadmin creates a new hidden course, invalid or existing ids are refused', async ({
	loginAs
}) => {
	const id = 'e2e_navnew_lists';
	rmSync(join(TASKS, id), { recursive: true, force: true });
	const page = await loginAs('superadmin');
	await page.goto('/mycourses');
	await page.locator('summary', { hasText: 'Create new course' }).click();
	await page.getByPlaceholder('New course id').fill(id);
	await page.getByRole('button', { name: 'Create new course' }).click();
	await expect(page.getByText('Course created.')).toBeVisible();
	expect(readFileSync(join(TASKS, id, 'course.yaml'), 'utf8')).toBe(`accessible: false\nname: ${id}\n`);
	for (const bad of [ids.nav_open, 'bad id']) {
		await page.getByPlaceholder('New course id').fill(bad);
		await page.getByRole('button', { name: 'Create new course' }).click();
		await expect(page.getByText('Failed to create the course.').last()).toBeVisible();
	}
	expect(readFileSync(join(TASKS, ids.nav_open, 'course.yaml'), 'utf8')).toContain('NAV Open course');
	await page.goto(`/mycourses?q=${id}`);
	await expect(page.locator(`article[data-course-id="${id}"]`)).toContainText(/Administrator\s*Hidden course/);
	rmSync(join(TASKS, id), { recursive: true, force: true });
	const student = await loginAs('nav_alice');
	await student.goto('/mycourses');
	await expect(student.getByText('Create new course')).toHaveCount(0);
	expect(existsSync(join(TASKS, 'bad id'))).toBe(false);
});

test('NAV-21 last tried exercises list the latest attempts with their outcome', async ({ loginAs }) => {
	await withDb((db) =>
		db.collection('submissions').insertMany([
			{
				courseid: ids.nav_open,
				taskid: 't2',
				username: ['nav_alice'],
				status: 'error',
				submitted_on: new Date(Date.now() - 2000)
			},
			{
				courseid: ids.nav_open,
				taskid: 't3',
				username: ['nav_alice'],
				status: 'done',
				result: 'success',
				submitted_on: new Date(Date.now() - 1000)
			}
		])
	);
	const page = await loginAs('nav_alice');
	await page.goto('/mycourses');
	const links = page.locator('section', { hasText: 'Continue where you left off' }).getByRole('link');
	await expect(links).toHaveText([
		/NAV Open course\s*T3 weight zero\s*Succeeded/,
		/NAV Open course\s*T2 hard\s*Internal error/
	]);
	await page.goto(`/course/${ids.nav_open}`);
	await expect(page.locator('section', { hasText: 'Last tried exercises' }).getByRole('link')).toHaveText([
		/^\s*T3 weight zero/,
		/^\s*T2 hard/
	]);
});

test('NAV-20 SITE-15 the upcoming tasks page lists the open tasks with a deadline', async ({ loginAs }) => {
	// The upcoming_tasks plugin is enabled in e2e/config.yaml (its 404 when disabled is unit-tested).
	const page = await loginAs('nav_alice');
	expect((await page.goto('/coming_tasks'))!.status()).toBe(200);
	await expect(page.getByRole('main')).toContainText(/soft/i);
	// The menu entry and the page title use the same words.
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Upcoming Tasks');
	await page.goto('/mycourses');
	await expect(page.getByRole('link', { name: 'Upcoming Tasks' }).first()).toBeVisible();
});
