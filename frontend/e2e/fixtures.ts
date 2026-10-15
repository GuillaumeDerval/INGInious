/**
 * Playwright fixtures of the integration suite:
 *  - automatic browser (Chromium) JS coverage for every test;
 *  - `loginAs(username)`: authenticates the page by creating a session document in
 *    the e2e database and adding the matching signed cookie (fast, no UI round-trip;
 *    the real sign-in form has its own tests);
 *  - `page.goto()` / `page.reload()` wait until an application page is hydrated
 *    (`<html data-hydrated>`, routes/+layout.svelte): on a loaded machine, typing or
 *    clicking before hydration would hit the plain HTML page (lost input, posts
 *    without JavaScript) and make tests flaky.
 */
import { test as base, expect, type Page, type Response } from '@playwright/test';
import { cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import MCR from 'monocart-coverage-reports';
import { createHmac } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { coverageOptions } from './coverage-options.mjs';
import { E2E } from './setup-data.js';

/** Directory of the course fixtures used by integration tests. */
const COURSE_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'courses');
/** tasks_directory of e2e/config.yaml (shared with the grading agents of the Colima stack). */
const TASKS_DIR = E2E.tasksDir;

/**
 * Installs a course fixture (e2e/fixtures/courses/<fixture>) into the shared tasks
 * directory under the id `e2e_<fixture>` (or `courseid`), replacing any previous copy.
 * Courses must live in the tasks directory of the grading agents (`E2E.tasksDir`) to be graded.
 * A `shared` course (not modified by the tests, used by several test files running
 * in parallel) is copied over in place, never removed: it is never missing.
 * @returns the course id.
 */
export function installCourse(fixture: string, courseid = `e2e_${fixture}`, { shared = false } = {}): string {
	const target = join(TASKS_DIR, courseid);
	if (!shared) rmSync(target, { recursive: true, force: true });
	cpSync(join(COURSE_FIXTURES, fixture), target, { recursive: true });
	return courseid;
}

/** Removes a course installed by `installCourse`. */
export function removeCourse(courseid: string): void {
	const target = join(TASKS_DIR, courseid);
	if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}

/** Runs `fn` with a connection to the e2e database (seeding / assertions on stored data). */
export async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
	const client = await MongoClient.connect(E2E.mongoUrl);
	try {
		return await fn(client.db(E2E.database));
	} finally {
		await client.close();
	}
}

/** Creates a logged-in session for `username` and returns the cookie value. */
export async function createSessionCookie(username: string): Promise<string> {
	const client = await MongoClient.connect(E2E.mongoUrl);
	try {
		const db = client.db(E2E.database);
		const user = await db.collection('users').findOne({ username });
		if (!user) throw new Error(`Unknown e2e user ${username}`);
		const id = new ObjectId();
		await db.collection('sessions').insertOne({
			_id: id,
			permanent: true,
			is_lti: false,
			loggedin: true,
			auth_storage: {},
			expiration: new Date(Date.now() + 3600_000),
			code_indentation: user.code_indentation ?? '4',
			email: user.email,
			language: user.language ?? 'en',
			realname: user.realname,
			token: null,
			tos_signed: user.tos_accepted ?? false,
			username,
			timezone: 'UTC'
		});
		const mac = createHmac('sha256', E2E.secretKey).update(id.toHexString()).digest('base64url');
		return `${id.toHexString()}.${mac}`;
	} finally {
		await client.close();
	}
}

/**
 * Waits for the hydration of the page loaded by `response` when it is an application
 * page. Pages that already went on (auto-submitted LTI forms, script redirects) have
 * no body anymore and are not waited for; neither is a page that never hydrates.
 */
async function waitForHydration(page: Page, response: Response | null): Promise<void> {
	if (!response?.headers()['content-type']?.startsWith('text/html')) return;
	const body = await response.text().catch(() => '');
	if (!body.includes('__sveltekit_')) return;
	await page
		.locator('html[data-hydrated]')
		.waitFor({ state: 'attached', timeout: 15_000 })
		.catch(() => {});
}

/** Fixtures available in every integration test. */
export const test = base.extend<{ loginAs: (username: string) => Promise<Page>; coverage: void }>({
	page: async ({ page }, use) => {
		const goto = page.goto.bind(page);
		const reload = page.reload.bind(page);
		page.goto = async (url, options) => {
			const response = await goto(url, options);
			await waitForHydration(page, response);
			return response;
		};
		page.reload = async (options) => {
			const response = await reload(options);
			await waitForHydration(page, response);
			return response;
		};
		await use(page);
	},
	coverage: [
		async ({ page }, use) => {
			await page.coverage.startJSCoverage({ resetOnNavigation: false });
			await use();
			const entries = await page.coverage.stopJSCoverage();
			if (entries.length) await MCR(coverageOptions).add(entries);
		},
		{ auto: true }
	],
	loginAs: async ({ page, context, baseURL }, use) => {
		await use(async (username: string) => {
			const value = await createSessionCookie(username);
			await context.addCookies([{ name: 'inginious_session_id', value, url: baseURL! }]);
			return page;
		});
	}
});

export { expect };
