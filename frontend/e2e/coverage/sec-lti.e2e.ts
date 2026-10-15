/**
 * Integration tests of the LTI pages inside the LMS iframes and of the LTI
 * sessions outside the LTI pages, with an own mock platform (its own issuer, so
 * that its registration is independent of e2e/lti): LTI 1.1 and 1.3 launches
 * displayed in an iframe of the platform, the frame ancestors and content
 * security policy of the LTI pages, LTI session tokens on the course
 * administration, and a server that only contacts public https platforms.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { Page } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { expect, installCourse, test, withDb } from '../fixtures.js';
import { appUrl, useApp } from '../auth/helpers.js';
import { launch11, registration, resourceClaims, startMockLms, type MockLms } from '../lti/mock/platform.js';
import { E2E } from '../setup-data.js';

const C = 'e2e_sec_lti';
let mock: MockLms;

// One mock platform and one course configuration for the whole file.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
	mock = await startMockLms();
	mock.iss = 'https://sec-platform.example';
	installCourse('lti_main', C);
	const yaml = join(E2E.tasksDir, C, 'course.yaml');
	writeFileSync(
		yaml,
		stringify({
			...parse(readFileSync(yaml, 'utf8')),
			lti_config: registration(mock),
			lti_secrets: { [`${mock.iss}/tool-client-1/dep-1`]: 's3cr3t' }
		})
	);
});
test.afterAll(() => mock.close());

/** Binds an LMS user to an INGInious account directly in the database. */
const bind = (username: string, field: string, lmsUser: string) =>
	withDb((db) => db.collection('users').updateOne({ username }, { $set: { [`ltibindings.${field}`]: lmsUser } }));

/** Binding key of the users of the mock LTI 1.3 platform. */
const platformKey = () => `${mock.iss.replace(/\./g, '')}/tool-client-1/dep-1`;

/** URL of a page of `origin` (the mock, under one of its names) showing `src` in an iframe. */
function framing(origin: string, src: string): string {
	const id = randomBytes(6).toString('hex');
	mock.pages.set(id, `<!doctype html><iframe src="${src.replace(/&/g, '&amp;')}" width="1000" height="800"></iframe>`);
	return `${origin}/page?id=${id}`;
}

/** URL of the OIDC login initiation of the mock platform for `user` (LTI-08). */
function oidcLogin(base: string, user: string, extra: Record<string, string> = {}): string {
	const query = new URLSearchParams({
		iss: mock.iss,
		login_hint: user,
		target_link_uri: `${base}/lti1.3/launch/${C}`,
		client_id: 'tool-client-1',
		lti_deployment_id: 'dep-1',
		...extra
	});
	return `${base}/lti1.3/oidc_login/${C}?${query}`;
}

/** The iframe of the page (index 1: the main frame is 0). */
const iframe = (page: Page) => page.frames()[1];

test.describe('LMS iframes', () => {
	test('LTI-05 an LTI 1.1 launch is displayed in the LMS iframe; other sites cannot frame the LTI pages', async ({
		page,
		request,
		baseURL
	}) => {
		await bind('e2e_student1', `${C}/ltikey`, 'sec-lms-1');
		const url = `${baseURL}/lti/${C}/mcq1`;
		const fields = launch11(url, 'ltikey', 'ltisecret', {
			user_id: 'sec-lms-1',
			tool_consumer_instance_url: mock.url,
			lis_outcome_service_url: `${mock.url}/outcome`
		});
		await page.goto(framing(mock.url, mock.page(url, fields)));
		await expect(page.frameLocator('iframe').getByRole('heading', { name: 'LTI MCQ 1' })).toBeVisible();
		const task = iframe(page).url();
		expect(task).toMatch(/\/lti\/task\?session_id=/);
		// The LTI pages may be framed by the configured platforms and the consumer of the session only.
		const csp = (await request.get(task)).headers()['content-security-policy'];
		expect(csp).toMatch(new RegExp(`frame-ancestors 'self' .*${mock.url}`));
		expect(csp).not.toMatch(/frame-ancestors[^;]* https:( |$)/);
		// The same page framed by another origin (the mock under another name) is refused by the browser.
		const other = mock.url.replace('localhost', '127.0.0.1');
		await page.goto(framing(other, task));
		await expect.poll(() => iframe(page)?.url()).toMatch(/^chrome-error:/);
		await expect(page.frameLocator('iframe').getByRole('heading', { name: 'LTI MCQ 1' })).toHaveCount(0);
		// The bind page is never framed.
		expect((await request.get(`${baseURL}/lti/bind`)).headers()['content-security-policy']).toContain(
			"frame-ancestors 'self'"
		);
	});

	test('LTI-08 LTI-09 an LTI 1.3 launch goes through the cookie check page inside the LMS iframe', async ({
		page,
		request,
		baseURL
	}) => {
		await bind('e2e_student2', platformKey(), 'sec-plat-1');
		mock.nextClaims = resourceClaims(mock, { courseid: C, taskid: 'mcq2', secret: 's3cr3t' });
		const login = oidcLogin(baseURL!, 'sec-plat-1');
		// The cookie check page only runs its own script and may be framed by the platform.
		const csp = (await request.get(login)).headers()['content-security-policy'];
		expect(csp).toMatch(/^default-src 'none'; script-src 'sha256-[\w+/=]+'; base-uri 'none'; form-action 'none'; /);
		expect(csp).toMatch(new RegExp(`frame-ancestors 'self' .*https://sec-platform.example ${mock.url}`));
		await page.goto(framing(mock.url, login));
		await expect(page.frameLocator('iframe').getByRole('heading', { name: 'LTI MCQ 2' })).toBeVisible();
		expect(iframe(page).url()).toMatch(/\/lti1\.3\/task\?session_id=/);
	});

	test('LTI-03 an LTI session token opens neither the course administration nor its actions', async ({
		page,
		request,
		baseURL
	}) => {
		await bind('superadmin', `${C}/ltikey`, 'sec-root');
		const url = `${baseURL}/lti/${C}/mcq1`;
		await page.goto(mock.page(url, launch11(url, 'ltikey', 'ltisecret', { user_id: 'sec-root' })));
		await expect(page).toHaveURL(/\/lti\/task\?session_id=/);
		const token = new URL(page.url()).searchParams.get('session_id');
		const submission = await withDb(async (db) =>
			String(
				(
					await db.collection('submissions').insertOne({
						courseid: C,
						taskid: 'mcq1',
						username: ['e2e_student1'],
						status: 'done',
						result: 'success',
						grade: 100,
						submitted_on: new Date(),
						input: new ObjectId()
					})
				).insertedId
			)
		);
		for (const path of [
			`/admin/${C}`,
			`/admin/${C}/students`,
			`/admin/${C}/submissions`,
			`/admin/${C}/tasks`,
			`/submission/${submission}`,
			'/queue'
		]) {
			const res = await request.get(`${baseURL}${path}?session_id=${token}`, { maxRedirects: 0 });
			expect(res.status(), path).toBe(302);
			expect(res.headers().location, path).toMatch(/^\/signin\?redirect=/);
		}
		const yaml = join(E2E.tasksDir, C, 'course.yaml');
		const before = readFileSync(yaml, 'utf8');
		const save = await request.post(`${baseURL}/admin/${C}/settings?session_id=${token}`, {
			form: { name: 'Changed through LTI' },
			headers: { origin: baseURL!, accept: 'application/json' }
		});
		expect(await save.json()).toMatchObject({ type: 'redirect', location: expect.stringMatching(/^\/signin\?/) });
		expect(readFileSync(yaml, 'utf8')).toBe(before);
	});
});

test.describe('without private platform URLs', () => {
	// A server with the default configuration: LTI services only reach public https endpoints.
	useApp(17, { lti_allow_private_urls: false });

	test('LTI-09 the key set of a platform on a private http address is not fetched', async ({ page }) => {
		await bind('e2e_student3', platformKey(), 'sec-plat-3');
		mock.nextClaims = resourceClaims(mock, { courseid: C, taskid: 'mcq1', secret: 's3cr3t' });
		mock.log.length = 0;
		await page.goto(oidcLogin(appUrl(17), 'sec-plat-3', { lti1p3_new_window: '1' }));
		await expect(page.getByText('Invalid LTI launch (signature).')).toBeVisible();
		expect(mock.log.map((l) => l.path)).not.toContain('/jwks');
	});
});
