/**
 * Integration tests of the contests plugin (SITE-14).
 */
import { test, expect, installCourse, withDb } from '../fixtures.js';

let course: string;
test.beforeAll(async () => {
	course = installCourse('site_contest');
	await withDb(async (db) => {
		await db
			.collection('courses')
			.updateOne({ _id: course as never }, { $set: { students: ['e2e_student1', 'e2e_student2'] } }, { upsert: true });
		await db.collection('submissions').deleteMany({ courseid: course });
		await db.collection('submissions').insertMany([
			{
				courseid: course,
				taskid: 'mcq1',
				username: ['e2e_student1'],
				result: 'failed',
				status: 'done',
				submitted_on: new Date('2021-01-01T00:00:00Z'),
				grade: 0
			},
			{
				courseid: course,
				taskid: 'mcq1',
				username: ['e2e_student1'],
				result: 'success',
				status: 'done',
				submitted_on: new Date('2021-01-01T01:00:00Z'),
				grade: 100
			}
		]);
	});
});

test('SITE-14 contest scoreboard, course menu and settings', async ({ loginAs, page }) => {
	await loginAs('e2e_student2');
	await page.goto(`/course/${course}`);
	await page.getByRole('link', { name: 'Contest', exact: true }).first().click();
	await expect(page.getByText('The scoreboard will refresh every 30 seconds.')).toBeVisible();
	await expect(page.locator('tbody tr').first()).toContainText(/E2E student1/i);
	await expect(page.getByText('Succeeded').first()).toBeVisible();
	expect((await page.goto(`/contest/${course}/admin`))!.status()).toBe(403);
	await page.context().clearCookies();
	await loginAs('e2e_admin');
	await page.goto(`/contest/${course}/admin`);
	await page.getByLabel('Contest ends').fill('2000-01-01 00:00:00');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Start date should be before end date')).toBeVisible();
	await page.getByLabel('Contest ends').fill('2098-01-01 00:00:00+00:00');
	await page.getByLabel('Penalty for wrong submissions (in minutes)').fill('10');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Changes saved.')).toBeVisible();
	await page.getByLabel('Enable contest plugin').uncheck();
	// Wait for the save itself: the toast of the previous save may still be visible.
	await Promise.all([
		page.waitForResponse((r) => r.request().method() === 'POST'),
		page.getByRole('button', { name: 'Save changes' }).click()
	]);
	expect((await page.goto(`/contest/${course}`))!.status()).toBe(404);
});
