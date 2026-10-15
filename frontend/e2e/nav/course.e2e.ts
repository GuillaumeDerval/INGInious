/**
 * Integration tests of the course page and the course access rules:
 * NAV-05..15 (access, registration, ACL, unregistration, task list, grade,
 * category filter, combinatory test, dispenser settings, preview).
 */
import { test, expect, withDb } from '../fixtures.js';
import { register, setupNav } from './helpers.js';

let ids: Record<string, string>;
test.beforeAll(async () => {
	ids = await setupNav('course', [
		'nav_open',
		'nav_pwd',
		'nav_closed',
		'nav_future',
		'nav_regclosed',
		'nav_acl',
		'nav_deny',
		'nav_bind',
		'nav_lti',
		'nav_archive',
		'nav_combi',
		'nav_preview',
		'nav_previewreg',
		'nav_broken'
	]);
	await register(ids.nav_open, 'nav_alice', 'nav_carol');
	await register(ids.nav_combi, 'nav_alice', 'nav_bob');
	await register(ids.nav_pwd, 'nav_carol');
	await withDb(async (db) => {
		await db.collection('user_tasks').deleteMany({ courseid: ids.nav_open });
		const grades: [string, number, boolean][] = [
			['t1', 100, true],
			['t2', 50, false],
			['textra', 100, false],
			['tpast', 100, false],
			['tfuture', 100, false]
		];
		await db.collection('user_tasks').insertMany(
			grades.map(([taskid, grade, succeeded]) => ({
				username: 'nav_alice',
				courseid: ids.nav_open,
				taskid,
				grade,
				succeeded,
				tried: 1
			}))
		);
	});
});

test('NAV-05 unavailable courses answer 403 with the legacy explanation, unknown ones 404', async ({ loginAs }) => {
	const page = await loginAs('nav_alice');
	for (const fx of ['nav_closed', 'nav_future', 'nav_regclosed', 'nav_acl', 'nav_bind', 'nav_archive']) {
		expect((await page.goto(`/course/${ids[fx]}`))!.status()).toBe(403);
		await expect(page.getByText('This course is closed.')).toBeVisible();
	}
	expect((await page.goto(`/course/${ids.nav_lti}`))!.status()).toBe(403);
	expect((await page.goto('/course/nonexist'))!.status()).toBe(404);
	await expect(page.getByText('Course not found.')).toBeVisible();
	expect((await page.goto(`/course/${ids.nav_broken}`))!.status()).toBe(404);
	await page.goto(`/course/${ids.nav_pwd}`);
	await expect(page).toHaveURL(new RegExp(`/register/${ids.nav_pwd}$`));
	const admin = await loginAs('superadmin');
	await admin.goto(`/course/${ids.nav_closed}`);
	await expect(admin.getByText(/currently invisible for students/)).toBeVisible();
	expect((await admin.goto(`/course/${ids.nav_archive}`))!.status()).toBe(200);
});

test('NAV-06 a student registers with the course password', async ({ loginAs }) => {
	const page = await loginAs('nav_bob');
	await page.goto(`/register/${ids.nav_pwd}`);
	await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password');
	await page.getByLabel('Password').fill('wrong');
	await page.getByRole('button', { name: 'Enroll in the course' }).click();
	await expect(page.getByText('Invalid password.')).toBeVisible();
	await page.getByLabel('Password').fill('s3cret');
	await page.getByRole('button', { name: 'Enroll in the course' }).click();
	await expect(page).toHaveURL(new RegExp(`/course/${ids.nav_pwd}$`));
	expect((await withDb((db) => db.collection('courses').findOne({ _id: ids.nav_pwd as never })))!.students).toContain(
		'nav_bob'
	);
	await page.goto(`/register/${ids.nav_pwd}`);
	await expect(page).toHaveURL(new RegExp(`/course/${ids.nav_pwd}$`));
	expect((await page.goto('/register/nonexist'))!.status()).toBe(404);
	await page.goto(`/register/${ids.nav_regclosed}`);
	await expect(page.getByText('This course is closed.')).toBeVisible();
});

test('NAV-07 registration ACLs accept or refuse users', async ({ loginAs }) => {
	const carol = await loginAs('nav_carol');
	await carol.goto(`/register/${ids.nav_acl}`);
	await expect(carol.getByRole('button', { name: 'Enroll in the course' })).toBeVisible();
	await carol.goto(`/register/${ids.nav_deny}`);
	await expect(carol.getByText('This course is closed.')).toBeVisible();
	const dave = await loginAs('nav_dave');
	await dave.goto(`/course/${ids.nav_bind}`);
	await expect(dave).toHaveURL(new RegExp(`/register/${ids.nav_bind}$`));
	await dave.getByRole('button', { name: 'Enroll in the course' }).click();
	await expect(dave).toHaveURL(new RegExp(`/course/${ids.nav_bind}$`));
});

test('NAV-08 a student unregisters after confirmation, keeping his submissions', async ({ loginAs }) => {
	const page = await loginAs('nav_carol');
	await page.goto(`/course/${ids.nav_open}`);
	await page.getByRole('button', { name: 'Unregister from this course' }).click();
	await expect(
		page.getByText('This will keep your submissions saved but will remove you from your group.', { exact: false })
	).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await page.getByRole('button', { name: 'Unregister from this course' }).click();
	await page.getByRole('button', { name: 'Unregister', exact: true }).click();
	await expect(page).toHaveURL(/\/mycourses$/);
	expect(
		(await withDb((db) => db.collection('courses').findOne({ _id: ids.nav_open as never })))!.students
	).not.toContain('nav_carol');
	await page.goto(`/course/${ids.nav_pwd}`);
	await expect(page.getByRole('button', { name: 'Unregister from this course' })).toHaveCount(0);
});

test('NAV-09 the course page shows description, grade, links and breadcrumb', async ({ loginAs }) => {
	const page = await loginAs('nav_alice');
	await page.goto(`/course/${ids.nav_open}`);
	await expect(page.getByRole('heading', { name: 'NAV Open course', level: 1 })).toBeVisible();
	await expect(page.getByText('This is the')).not.toBeVisible();
	await page.getByText('About this course').click();
	await expect(page.getByText('item one')).toBeVisible();
	await expect(page.getByRole('main').getByRole('link', { name: 'My courses' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Group management' }).first()).toBeVisible();
	const tutor = await loginAs('nav_tutor');
	await tutor.goto(`/course/${ids.nav_open}`);
	await expect(tutor.getByRole('link', { name: 'Course administration' }).first()).toHaveAttribute(
		'href',
		`/admin/${ids.nav_open}`
	);
	await expect(tutor.getByRole('button', { name: 'Unregister from this course' })).toHaveCount(0);
});

test('NAV-10 the table of contents shows sections, states and hidden tasks', async ({ loginAs }) => {
	const page = await loginAs('nav_alice');
	await page.goto(`/course/${ids.nav_open}`);
	await expect(page.getByRole('heading', { name: 'Part 1' })).toBeVisible();
	await expect(page.getByText('Hidden if empty')).toHaveCount(0);
	await expect(page.getByRole('link', { name: /T past/ })).toContainText('deadline reached');
	await expect(page.getByRole('link', { name: /T3 weight zero/ })).toBeHidden();
	await page.getByText('Advanced').click();
	await expect(page.getByRole('link', { name: /T3 weight zero/ })).toBeVisible();
	for (const hidden of ['T never', 'T future', 'T extra'])
		await expect(page.getByRole('link', { name: new RegExp(hidden) })).toHaveCount(0);
	await expect(page.getByRole('link', { name: /T1 easy/ }).getByRole('progressbar')).toHaveAttribute('value', '100');
	// A section without visible task (not "Hidden if empty") explains it instead of counting 0 / 0.
	const soon = page.locator('details', { has: page.getByRole('heading', { name: 'Coming soon' }) });
	await expect(soon).toContainText('No task available yet');
	await expect(soon.getByText('0 / 0')).toHaveCount(0);
});

test('NAV-11 the course grade is the weighted average of the started tasks', async ({ loginAs }) => {
	const page = await loginAs('nav_alice');
	await page.goto(`/course/${ids.nav_open}`);
	await expect(page.getByRole('progressbar', { name: 'Current grade' })).toHaveAttribute('value', '77');
	await expect(page.getByText('1 / 6 tasks succeeded')).toBeVisible();
	await page.goto(`/group/${ids.nav_open}`);
	await expect(page.getByRole('progressbar', { name: 'Current grade' })).toHaveAttribute('value', '77');
});

test('NAV-12 tasks are filtered by category', async ({ loginAs }) => {
	const page = await loginAs('nav_alice');
	await page.goto(`/course/${ids.nav_open}`);
	const chips = page.getByRole('group', { name: 'Filter tasks by category' });
	await expect(chips.getByRole('button')).toHaveText(['All', 'easy', 'hard']);
	await chips.getByRole('button', { name: 'hard' }).click();
	await expect(page.getByRole('link', { name: /T2 hard/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /T1 easy/ })).toHaveCount(0);
	await chips.getByRole('button', { name: 'All' }).click();
	await expect(page.getByRole('link', { name: /T1 easy/ })).toBeVisible();
	await page.goto(`/course/${ids.nav_preview}`);
	await expect(page.getByRole('group', { name: 'Filter tasks by category' })).toHaveCount(0);
});

test('NAV-13 combinatory tests show the stable random draw of each student', async ({ loginAs }) => {
	const draw = async (user: string) => {
		const page = await loginAs(user);
		await page.goto(`/course/${ids.nav_combi}`);
		await expect(page.getByRole('main').getByRole('link', { name: /Combi/ }).first()).toBeVisible();
		const hrefs = await page
			.getByRole('main')
			.locator('a')
			.evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
		return hrefs.filter((h) => /\/c\d$/.test(h)).map((h) => h.split('/').pop());
	};
	expect(await draw('nav_alice')).toEqual(['c3', 'c4', 'c6']);
	expect(await draw('nav_bob')).toEqual(['c1', 'c3', 'c6']);
	expect(await draw('superadmin')).toEqual(['c1', 'c2', 'c5']);
});

test('NAV-14 per-task settings drive weights and deadlines', async ({ loginAs }) => {
	const page = await loginAs('nav_alice');
	await page.goto(`/course/${ids.nav_open}`);
	await expect(page.getByRole('link', { name: /T2 hard/ })).toContainText('Weight: 3');
	await expect(page.getByRole('link', { name: /T soft deadline/ })).not.toContainText('deadline reached');
	await expect(page.getByRole('link', { name: /T soft deadline/ })).toContainText(/2099/);
});

test('NAV-15 visitors preview courses that allow it', async ({ page, loginAs }) => {
	expect((await page.goto(`/course/${ids.nav_preview}`))!.status()).toBe(200);
	await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toBeVisible();
	await expect(page.getByRole('main').getByRole('progressbar')).toHaveCount(0);
	await page.goto(`/course/${ids.nav_open}`);
	await expect(page).toHaveURL(/\/signin/);
	const alice = await loginAs('nav_alice');
	await alice.goto(`/course/${ids.nav_preview}`);
	await expect(alice.getByRole('link', { name: 'Enroll in the course' })).toHaveCount(0);
	await alice.goto(`/course/${ids.nav_previewreg}`);
	await expect(alice.getByRole('link', { name: 'Enroll in the course' })).toHaveAttribute(
		'href',
		`/register/${ids.nav_previewreg}`
	);
});
