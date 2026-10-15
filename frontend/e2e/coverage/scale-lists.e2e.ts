/**
 * Integration tests of the scale features of the lists (docs/performance.md): server-side
 * search and pagination of the course grids (NAV-01/02) and of the upcoming tasks (NAV-20),
 * on-demand loading of the sections of large courses (NAV-10), paginated task history
 * (TASK-10), server-searched choice lists of the submission filters (CSTU-11) and folded
 * sections of the task list editor (CADM-07). The large course is generated here
 * (210 tasks in 3 sections, 60 with a deadline in 3 days).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import { test, expect, withDb } from '../fixtures.js';
import { E2E } from '../setup-data.js';

const TASKS = E2E.tasksDir;
const C = 'e2e_scale_lists';
const STUDENT = 'e2e_student3';
const ids = Array.from({ length: 210 }, (_, i) => `k${String(i).padStart(3, '0')}`);
const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

test.beforeAll(async () => {
	const dir = join(TASKS, C);
	rmSync(dir, { recursive: true, force: true });
	for (const id of ids) {
		mkdirSync(join(dir, id), { recursive: true });
		writeFileSync(
			join(dir, id, 'task.yaml'),
			`name: Task ${id}\nenvironment_type: mcq\nenvironment_id: mcq\nproblems:\n  q1:\n    type: code_single_line\n    name: Q1\n`
		);
	}
	const config = Object.fromEntries(
		ids.map((id, i) => [
			id,
			{ accessibility: i < 60 ? `2020-01-01 00:00:00/${soon}` : true, ...(i === 5 && { categories: ['odd'] }) }
		])
	);
	const toc = ['A', 'B', 'C'].map((title, s) => ({ title, tasks_list: ids.slice(s * 70, s * 70 + 70) }));
	writeFileSync(
		join(dir, 'course.yaml'),
		JSON.stringify({
			name: 'Scale course',
			admins: ['e2e_admin'],
			accessible: true,
			registration: true,
			task_dispenser: 'toc',
			dispenser_data: { toc, config }
		})
	);
	const at = Date.UTC(2026, 0, 1);
	await withDb(async (db) => {
		await db.collection('courses').replaceOne({ _id: C as never }, { students: [STUDENT] }, { upsert: true });
		await db.collection('submissions').deleteMany({ courseid: C });
		await db.collection('submissions').insertMany(
			Array.from({ length: 26 }, (_, i) => ({
				courseid: C,
				taskid: i < 25 ? 'k000' : 'k001',
				username: [STUDENT],
				status: 'done',
				result: 'failed',
				grade: i,
				input: new ObjectId(),
				submitted_on: new Date(at + i * 60_000)
			}))
		);
	});
});
test.afterAll(() => rmSync(join(TASKS, C), { recursive: true, force: true }));

test('NAV-01 the course list is searched and paginated by the server', async ({ page }) => {
	await page.goto('/courselist');
	await expect(page.getByText(/\d+\s+courses/)).toBeVisible();
	const first = await page.locator('article[data-course-id]').first().getAttribute('data-course-id');
	await page.getByRole('link', { name: 'Next' }).click();
	await expect(page).toHaveURL(/page=2/);
	await expect(page.locator('article[data-course-id]').first()).not.toHaveAttribute('data-course-id', first!);
	await page.getByRole('searchbox').fill('scale course');
	await expect(page).toHaveURL(/\?q=scale\+course$/);
	await expect(page.locator('article[data-course-id]')).toHaveCount(1);
	await expect(page.getByText('1 courses')).toBeVisible();
});

test('NAV-02 my courses are filtered, searched and paginated by the server', async ({ loginAs }) => {
	const page = await loginAs('superadmin');
	await page.goto('/mycourses');
	await page.getByRole('link', { name: 'Next' }).click();
	await expect(page).toHaveURL(/page=2/);
	await page.getByRole('link', { name: 'Hidden', exact: true }).click();
	await expect(page).toHaveURL(/\?filter=hidden$/);
	await page.getByRole('searchbox').fill(C);
	await expect(page).toHaveURL(new RegExp(`filter=hidden&q=${C}`));
	await expect(page.getByText('No course found.')).toBeVisible();
	await page.getByRole('link', { name: 'All', exact: true }).click();
	await expect(page.locator(`article[data-course-id="${C}"]`)).toContainText('Administrator');
});

test('NAV-10 NAV-12 large courses load the tasks of a section when it is opened', async ({ loginAs }) => {
	const page = await loginAs(STUDENT);
	await page.goto(`/course/${C}`);
	await expect(page.getByRole('link', { name: 'Task k069' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Task k139' })).toBeVisible();
	// The third section exceeds the budget of the page: sent closed, without its tasks.
	await expect(page.getByRole('link', { name: 'Task k140' })).toHaveCount(0);
	const third = page.locator('details').filter({ has: page.getByRole('heading', { name: 'C', exact: true }) });
	await expect(third.locator('summary')).toContainText('0 / 70');
	await third.locator('summary').click();
	await expect(page.getByRole('link', { name: 'Task k209' })).toBeVisible();
	// The category filter uses the counts of every section.
	await page.getByRole('button', { name: 'odd' }).click();
	await expect(page.locator('details').getByRole('link', { name: /Task k/ })).toHaveCount(1);
	await expect(third).toHaveCount(0);
});

test('NAV-20 the upcoming tasks are paginated', async ({ loginAs }) => {
	const page = await loginAs(STUDENT);
	await page.goto('/coming_tasks?time_planner=7');
	const course = page.locator('section', { hasText: 'Scale course' });
	await expect(course.getByText('60', { exact: true })).toBeVisible();
	await page.getByRole('link', { name: 'Next' }).click();
	await expect(page).toHaveURL(/time_planner=7&page=2/);
	await expect(page.getByRole('link', { name: 'Task k059' })).toBeVisible();
});

test('TASK-10 the history shows the latest submissions and loads older ones on demand', async ({ loginAs }) => {
	const page = await loginAs(STUDENT);
	await page.goto(`/course/${C}/k000`);
	const history = page.getByTestId('history');
	await expect(history.locator('[data-submission]')).toHaveCount(20);
	await expect(
		page.locator('section', { hasText: 'Submission history' }).getByText('25', { exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Load older submissions' }).click();
	await expect(history.locator('[data-submission]')).toHaveCount(25);
	await expect(page.getByRole('button', { name: 'Load older submissions' })).toHaveCount(0);
});

test('CSTU-11 long choice lists of the submission filters are searched on the server', async ({ loginAs }) => {
	const page = await loginAs('e2e_admin');
	await page.goto(`/admin/${C}/submissions`);
	await page.locator('summary', { hasText: 'Filters' }).click();
	await page.getByRole('combobox', { name: 'Tasks' }).fill('k001');
	await page.getByRole('option', { name: 'Task k001' }).click();
	await page.getByRole('button', { name: 'Filter', exact: true }).click();
	await expect(page).toHaveURL(/tasks=k001/);
	await expect(page.getByText('1 submissions selected')).toBeVisible();
	// The selection is shown with its label after the reload (the filter panel stays open).
	await expect(page.getByText('Task k001')).toBeVisible();
});

test('CADM-07 the task list editor folds the sections of large courses', async ({ loginAs }) => {
	const page = await loginAs('e2e_admin');
	await page.goto(`/admin/${C}/tasks`);
	await expect(page.getByRole('textbox', { name: 'Section title' }).first()).toHaveValue('A');
	await expect(page.getByRole('link', { name: 'Edit task' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Show' }).first().click();
	await expect(page.getByRole('link', { name: 'Edit task' })).toHaveCount(70);
});
