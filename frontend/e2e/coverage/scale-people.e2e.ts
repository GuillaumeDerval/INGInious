/**
 * Integration tests of the server-side pagination and search of the people
 * administration (CSTU-01/02/04/07/09/16), built for courses with thousands of
 * students, audiences, groups and tasks: every list is searched on the server
 * and sent one page at a time. Each test works on its own copy of `cstu_course`.
 */
import { test, expect, installCourse, withDb } from '../fixtures.js';

let n = 0;
/** Installs a fresh course copy with `count` generated students (`<course>_uNN`, real name "Pupil NN"). */
async function course(name: string, count = 0): Promise<{ c: string; users: string[] }> {
	const c = installCourse('cstu_course', `e2e_scale_${name}_${Date.now() % 100000}${n++}`);
	const users = Array.from({ length: count }, (_, i) => `${c}_u${String(i + 1).padStart(2, '0')}`);
	await withDb(async (db) => {
		if (count)
			await db.collection('users').insertMany(
				users.map((username, i) => ({
					username,
					realname: `Pupil ${String(i + 1).padStart(2, '0')}`,
					email: `${username}@x.org`,
					bindings: {},
					language: 'en'
				}))
			);
		await db.collection('courses').insertOne({ _id: c as never, students: [...users, 'e2e_student1'] });
	});
	return { c, users };
}

test('CSTU-01 the student list is paginated and searched on the server; "unregister all" follows the search', async ({
	page,
	loginAs
}) => {
	const { c } = await course('students', 55);
	await loginAs('e2e_admin');
	await page.goto(`/admin/${c}/students`);
	await expect(page.getByText('Number of students : 56')).toBeVisible();
	const rows = page.locator('tbody tr');
	await expect(rows).toHaveCount(50);
	await expect(page.getByText('1 / 2')).toBeVisible();
	await page.getByRole('link', { name: 'Next' }).click();
	await expect(rows).toHaveCount(6);
	await expect(page).toHaveURL(/page=2/);
	// The search goes back to the first page of the matching students (name, username or email).
	await page.getByRole('searchbox', { name: 'Search' }).fill('pupil 0');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page.getByText('9 results')).toBeVisible();
	await expect(rows).toHaveCount(9);
	await page.getByTitle('More actions').click();
	await page.getByRole('button', { name: 'Unregister the 9 matching students' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
	await expect(page.getByText('Number of students : 47')).toBeVisible();
	const doc = await withDb((db) => db.collection('courses').findOne({ _id: c as never }));
	expect(doc!.students).toHaveLength(47);
	expect(doc!.students).not.toContain(`${c}_u05`);
});

test('CSTU-04 audiences are paginated and searched on the server', async ({ page, loginAs }) => {
	const { c } = await course('audiences');
	const ids = await withDb(async (db) =>
		Object.values(
			(
				await db.collection('audiences').insertMany(
					Array.from({ length: 25 }, (_, i) => ({
						courseid: c,
						description: `Lab ${i + 1}`,
						students: ['e2e_student1'],
						tutors: []
					}))
				)
			).insertedIds
		).map(String)
	);
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/students?tab=audiences`);
	const rows = page.locator('tbody tr');
	await expect(rows).toHaveCount(20);
	// Natural order: Lab 1, Lab 2, ..., Lab 25.
	await expect(rows.first()).toContainText('Lab 1');
	await expect(rows.nth(1)).toContainText('Lab 2');
	await expect(page.getByRole('link', { name: 'Submissions of all audiences' })).toHaveAttribute(
		'href',
		`/admin/${c}/submissions?audiences=${ids.join(',')}`
	);
	await page.getByRole('link', { name: 'Next' }).click();
	await expect(rows).toHaveCount(5);
	await page.getByRole('searchbox', { name: 'Search' }).fill('lab 2');
	await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
	await expect(page.getByText('7 results')).toBeVisible();
	await expect(page).toHaveURL(/tab=audiences/);
	await page.getByRole('searchbox', { name: 'Search' }).fill('nothing');
	await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
	await expect(page.getByText('Nothing matches your search.')).toBeVisible();
});

test('CSTU-07 groups are paginated and searched (description or member); the picker offers registered students only', async ({
	page,
	loginAs
}) => {
	const { c } = await course('groups', 3);
	await withDb((db) =>
		db.collection('groups').insertMany(
			Array.from({ length: 30 }, (_, i) => ({
				courseid: c,
				description: `Team ${i + 1}`,
				size: 2,
				students: i === 29 ? ['e2e_student1'] : [],
				audiences: []
			}))
		)
	);
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/students?tab=groups`);
	await expect(page.getByRole('article')).toHaveCount(24);
	await expect(page.getByText('Ungrouped students')).toContainText('3');
	await page.getByRole('link', { name: 'Next' }).click();
	await expect(page.getByRole('article')).toHaveCount(6);
	await page.getByRole('searchbox', { name: 'Search' }).fill('e2e_student1');
	await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
	await expect(page.getByRole('article')).toHaveCount(1);
	await expect(page.getByRole('article', { name: 'Team 30' })).toBeVisible();
	const picker = async (q: string) =>
		(await (await page.request.get(`/admin/${c}/students/students.json?q=${q}`)).json()).map(
			(o: { value: string }) => o.value
		);
	expect(await picker('e2e_student')).toEqual(['e2e_student1']);
	expect(await picker('Pupil 0')).toEqual([`${c}_u01`, `${c}_u02`, `${c}_u03`]);
});

test('CSTU-09 the student page filters the tasks by status and searches them', async ({ page, loginAs }) => {
	const { c } = await course('student');
	await withDb((db) =>
		db.collection('user_tasks').insertOne({
			courseid: c,
			username: 'e2e_student1',
			taskid: 'answer',
			tried: 2,
			succeeded: true,
			grade: 100,
			submissionid: null,
			state: ''
		})
	);
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/student/e2e_student1`);
	const rows = page.locator('tbody tr');
	const all = await rows.count();
	expect(all).toBeGreaterThan(2);
	await page.getByRole('link', { name: 'Succeeded', exact: true }).click();
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText('Answer task');
	await page.getByRole('link', { name: 'All', exact: true }).click();
	await expect(rows).toHaveCount(all);
	await page.getByRole('searchbox', { name: 'Search' }).fill('answer');
	await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
	await expect(page.getByText('1 results')).toBeVisible();
	await page.getByRole('link', { name: 'Not viewed', exact: true }).click();
	await expect(page.getByText('Nothing matches your search.')).toBeVisible();
});

test('CSTU-16 the progress tab of the statistics lists the tasks one page at a time', async ({ page, loginAs }) => {
	const { c } = await course('progress');
	await loginAs('e2e_tutor');
	await page.goto(`/admin/${c}/stats`);
	await expect(page.getByText('Success rate')).toBeVisible();
	await page.getByRole('link', { name: 'Student progress' }).click();
	await expect(page).toHaveURL(/tab=progress/);
	await expect(page.getByRole('row', { name: /Answer task/ })).toContainText(/0\s*0\s*0\s*0/);
	await expect(page.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
		'href',
		`/admin/${c}/students/progress.csv`
	);
});
