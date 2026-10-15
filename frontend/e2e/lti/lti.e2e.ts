/**
 * Integration tests of the LTI area (LTI-01..14): real LTI 1.1 launches signed
 * with an independent OAuth1 helper and LTI 1.3 launches issued by a mock
 * platform (jose keys), both posted cross-site from the mock LMS pages; DB
 * effects and the grade requests received by the mock are asserted.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { Page } from '@playwright/test';
import { createSessionCookie, expect, installCourse, removeCourse, test, withDb } from '../fixtures.js';
import { launch11, registration, resourceClaims, startMockLms, type MockLms } from './mock/platform.js';
import { E2E } from '../setup-data.js';

const C = 'e2e_lti_main';
const COURSE_YAML = join(E2E.tasksDir, C, 'course.yaml');
const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/';
let mock: MockLms;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
	mock = await startMockLms();
	installCourse('lti_main', C);
	const course = parse(readFileSync(COURSE_YAML, 'utf8'));
	writeFileSync(
		COURSE_YAML,
		stringify({
			...course,
			admins: ['e2e_admin'],
			lti_config: registration(mock),
			lti_secrets: { [`${mock.iss}/tool-client-1/dep-1`]: 's3cr3t' }
		})
	);
});
test.afterAll(() => mock.close());

/** LTI 1.1 launch auto-posted by a mock LMS page (cross-site browser POST). */
async function launch1(
	page: Page,
	baseURL: string,
	user: string,
	extra: Record<string, string | undefined> = {},
	task = 'mcq1'
) {
	const url = `${baseURL}/lti/${C}/${task}`;
	await page.goto(
		mock.page(
			url,
			launch11(url, 'ltikey', 'ltisecret', { user_id: user, lis_outcome_service_url: `${mock.url}/outcome`, ...extra })
		)
	);
}

/** LTI 1.3 launch: OIDC login (cookie check page), mock authorization, id_token form_post. */
async function launch13(page: Page, baseURL: string, claims: Record<string, unknown>, user = 'plat-user-1') {
	mock.nextClaims = claims;
	const q = new URLSearchParams({
		iss: mock.iss,
		login_hint: user,
		target_link_uri: `${baseURL}/lti1.3/launch/${C}`,
		client_id: 'tool-client-1',
		lti_deployment_id: 'dep-1'
	});
	await page.goto(`${baseURL}/lti1.3/oidc_login/${C}?${q}`);
}

/** Binds an LMS user to an INGInious account directly in the database. */
const bind = (username: string, field: string, lmsUser: string) =>
	withDb((db) => db.collection('users').updateOne({ username }, { $set: { [`ltibindings.${field}`]: lmsUser } }));

test('LTI-01 consumer keys and 1.3 registrations come from course.yaml; non-LTI courses ignore them', async ({
	request,
	baseURL
}) => {
	const url = `${baseURL}/lti/${C}/mcq1`;
	expect((await request.post(url, { form: launch11(url, 'ltikey', 'wrong'), maxRedirects: 0 })).status()).toBe(403);
	expect((await request.post(url, { form: launch11(url, 'ltikey', 'ltisecret'), maxRedirects: 0 })).status()).toBe(302);
	const hash = createHash('md5').update(`${mock.iss}tool-client-1`).digest('hex');
	expect((await request.get(`${baseURL}/lti1.3/jwks/${C}/${hash}`)).status()).toBe(200);
	expect((await request.get(`${baseURL}/lti1.3/jwks/${hash}`)).status()).toBe(404);
});

test('LTI-02 a cross-site signed launch reaches the login step; replays, GET and bad signatures are refused', async ({
	page,
	request,
	baseURL
}) => {
	await launch1(page, baseURL!, 'lms-unbound');
	await expect(page).toHaveURL(/\/lti\/login\?session_id=/);
	await expect(page.getByRole('link', { name: 'Bind your INGInious account' })).toBeVisible();
	const url = `${baseURL}/lti/${C}/mcq1`;
	const form = launch11(url, 'ltikey', 'ltisecret');
	expect((await request.post(url, { form, maxRedirects: 0 })).status()).toBe(302);
	expect((await request.post(url, { form, maxRedirects: 0 })).status()).toBe(403);
	expect((await request.get(url)).status()).toBe(405);
	expect(
		(
			await request.post(url, {
				form: launch11(url, 'ltikey', 'ltisecret', { oauth_signature_method: 'PLAINTEXT' }),
				maxRedirects: 0
			})
		).status()
	).toBe(403);
	expect(
		(
			await request.post(url, { form: launch11(url, 'ltikey', 'ltisecret', { user_id: undefined }), maxRedirects: 0 })
		).status()
	).toBe(400);
});

test('LTI-03 LTI sessions live in signed URL tokens only; normal session ids are not accepted as session_id', async ({
	page,
	context,
	baseURL
}) => {
	await launch1(page, baseURL!, 'lms-unbound-2');
	const token = new URL(page.url()).searchParams.get('session_id')!;
	expect(token).toMatch(/^[0-9a-f]{24}\.[\w-]{43}$/);
	expect((await context.cookies()).filter((c) => c.name === 'inginious_session_id')).toHaveLength(0);
	const doc = await withDb((db) => db.collection('sessions').findOne({ 'lti.username': 'lms-unbound-2' }));
	expect(doc).toMatchObject({ is_lti: true, loggedin: false, lti: { version: '1.1', task: [C, 'mcq1'] } });
	const normal = await createSessionCookie('e2e_student1');
	expect((await page.goto(`${baseURL}/lti/login?session_id=${normal}`))!.status()).toBe(403);
	expect((await page.goto(`${baseURL}/lti/login?session_id=${token.slice(0, 24)}`))!.status()).toBe(403);
});

test('LTI-04 the LMS user binds an INGInious account in a new tab and the iframe continues to the task', async ({
	page,
	context,
	baseURL
}) => {
	await launch1(page, baseURL!, 'lms-bind-1');
	await context.addCookies([
		{ name: 'inginious_session_id', value: await createSessionCookie('e2e_student3'), url: baseURL! }
	]);
	const [popup] = await Promise.all([
		context.waitForEvent('page'),
		page.getByRole('link', { name: 'Bind your INGInious account' }).click()
	]);
	await expect(popup.getByText('E2E Student3 [e2e_student3]')).toBeVisible();
	await expect(popup.getByText('C101 - LMS course')).toBeVisible();
	await popup.getByRole('button', { name: 'Bind my account' }).click();
	await expect(popup.getByText(/Your account is now bound/)).toBeVisible();
	await expect(page).toHaveURL(/\/lti\/task\?session_id=/, { timeout: 15_000 });
	const user = await withDb((db) => db.collection('users').findOne({ username: 'e2e_student3' }));
	expect(user?.ltibindings).toMatchObject({ [`${C}/ltikey`]: 'lms-bind-1' });
	// The next launch of the same LMS user logs in directly.
	await launch1(page, baseURL!, 'lms-bind-1');
	await expect(page).toHaveURL(/\/lti\/task\?/);
});

test('LTI-05 LTI-06 LTI-07 a bound student submits through LTI 1.1; assets load and the grade is sent back', async ({
	page,
	baseURL
}) => {
	await bind('e2e_student1', `${C}/ltikey`, 'lms-s1');
	const assets: number[] = [];
	page.on('response', (r) => r.url().includes('/lti/asset/') && assets.push(r.status()));
	await launch1(page, baseURL!, 'lms-s1', { lis_result_sourcedid: 'sid-s1' });
	await expect(page).toHaveURL(/\/lti\/task\?session_id=/);
	await expect(page.getByRole('heading', { name: 'LTI MCQ 1' })).toBeVisible();
	await expect.poll(() => assets).toContain(200);
	await expect(page.getByRole('link', { name: 'relative link' })).toHaveAttribute(
		'href',
		/^\/lti\/asset\/public\/hello\.txt\?session_id=/
	);
	await page.getByText('Right', { exact: true }).click();
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect
		.poll(
			async () =>
				(await withDb((db) => db.collection('submissions').findOne({ courseid: C, username: 'e2e_student1' })))?.status,
			{ timeout: 30_000 }
		)
		.toBe('done');
	const sub = await withDb((db) => db.collection('submissions').findOne({ courseid: C, username: 'e2e_student1' }));
	expect(sub).toMatchObject({
		lti_version: '1.1',
		outcome_result_id: 'sid-s1',
		outcome_consumer_key: 'ltikey',
		grade: 100
	});
	expect((await withDb((db) => db.collection('courses').findOne({ _id: C as never })))?.students).toContain(
		'e2e_student1'
	);
	await expect
		.poll(() => mock.log.filter((l) => l.path === '/outcome' && l.body.includes('sid-s1')).length, { timeout: 15_000 })
		.toBe(1);
	const outcome = mock.log.find((l) => l.body.includes('sid-s1'))!;
	expect(outcome.body).toContain('<textString>1.0</textString>');
	expect(outcome.headers.authorization).toMatch(/oauth_body_hash=/);
	expect(await withDb((db) => db.collection('lis_outcome_queue').countDocuments({ username: 'e2e_student1' }))).toBe(0);
});

test('LTI-08 LTI-09 LTI-12 an LTI 1.3 launch goes through OIDC, logs the bound user in and posts the score', async ({
	page,
	baseURL
}) => {
	await bind('e2e_student2', `${mock.iss.replace(/\./g, '')}/tool-client-1/dep-1`, 'plat-user-1');
	await launch13(page, baseURL!, resourceClaims(mock, { courseid: C, taskid: 'mcq2', secret: 's3cr3t' }));
	await expect(page).toHaveURL(/\/lti1\.3\/task\?session_id=/);
	await expect(page.getByRole('heading', { name: 'LTI MCQ 2' })).toBeVisible();
	const launchDoc = await withDb((db) => db.collection('lti_launch').findOne({ 'value.sub': 'plat-user-1' }));
	expect(launchDoc?.key).toMatch(/^lti1p3-launch-/);
	await page.getByText('Right', { exact: true }).click();
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect
		.poll(() => mock.log.filter((l) => l.path === '/lineitems/1/lineitem/scores').length, { timeout: 30_000 })
		.toBe(1);
	const score = JSON.parse(mock.log.find((l) => l.path === '/lineitems/1/lineitem/scores')!.body);
	expect(score).toMatchObject({
		scoreGiven: 100,
		scoreMaximum: 100,
		userId: 'plat-user-1',
		gradingProgress: 'FullyGraded'
	});
	expect(mock.log.some((l) => l.path === '/token')).toBe(true);
	expect(
		await withDb((db) =>
			db.collection('submissions').findOne({ courseid: C, taskid: 'mcq2', username: 'e2e_student2' })
		)
	).toMatchObject({ lti_version: '1.3' });
});

test('LTI-09 a wrong deployment secret is refused on every LTI page', async ({ page, baseURL }) => {
	// Bound user (as in LTI-08, not relying on it): the launch goes on to the task page, which checks the secret.
	await bind('e2e_student2', `${mock.iss.replace(/\./g, '')}/tool-client-1/dep-1`, 'plat-user-1');
	await launch13(page, baseURL!, resourceClaims(mock, { courseid: C, taskid: 'mcq1', secret: 'WRONG' }));
	await expect(page.getByText('Invalid LTI secret')).toBeVisible();
	const token = new URL(page.url()).searchParams.get('session_id');
	expect((await page.goto(`${baseURL}/lti/task?session_id=${token}`))!.status()).toBe(403);
});

test('LTI-10 a bound course admin picks a task and the signed deep-linking response is auto-posted to the platform', async ({
	page,
	baseURL
}) => {
	await bind('e2e_admin', `${mock.iss.replace(/\./g, '')}/tool-client-1/dep-1`, 'plat-admin');
	const deep = {
		[`${CLAIM}deployment_id`]: 'dep-1',
		[`${CLAIM}message_type`]: 'LtiDeepLinkingRequest',
		[`${CLAIM}version`]: '1.3.0',
		'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings': {
			deep_link_return_url: `${mock.url}/dlreturn`,
			accept_types: ['ltiResourceLink'],
			data: 'opaque'
		}
	};
	await launch13(page, baseURL!, deep, 'plat-admin');
	await expect(page).toHaveURL(/\/lti1\.3\/deeplink\?session_id=/);
	await page.getByLabel('Course').selectOption(C);
	await page.getByLabel('Task').selectOption('mcq2');
	await page.getByRole('button', { name: 'Select' }).click();
	// The page auto-submits the signed response to the platform (an LTI platform origin,
	// allowed by the `form-action` of the LTI pages).
	await expect(page.getByText('Deep link received')).toBeVisible();
	const jwt = new URLSearchParams(mock.log.find((l) => l.path === '/dlreturn')!.body).get('JWT')!;
	const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
	expect(claims['https://purl.imsglobal.org/spec/lti-dl/claim/content_items'][0]).toMatchObject({
		type: 'ltiResourceLink',
		title: 'LTI MCQ 2',
		custom: { courseid: C, taskid: 'mcq2', secret: 's3cr3t' }
	});
});

test('LTI-11 the JWKS publishes the tool public key only', async ({ request, baseURL }) => {
	const hash = createHash('md5').update(`${mock.iss}tool-client-1`).digest('hex');
	const body = await (await request.get(`${baseURL}/lti1.3/jwks/${C}/${hash}`)).json();
	expect(Object.keys(body.keys[0])).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
	expect((await request.get(`${baseURL}/lti1.3/jwks/${C}/0123`)).status()).toBe(404);
	expect((await request.get(`${baseURL}/lti1.3/jwks/nope/${hash}`)).status()).toBe(404);
});

test('LTI-13 an LTI course with grade passback is not usable from the normal web application by students', async ({
	loginAs,
	baseURL
}) => {
	const page = await loginAs('e2e_student1');
	const res = await page.goto(`${baseURL}/course/${C}/mcq1`);
	expect(res!.status()).toBe(403);
	await expect(page.getByText(/must be accessed on an external platform/)).toBeVisible();
});

test('SITE-20 LTI-14 the ltibestsubmission plugin returns the best submission of the LTI session as JSON', async ({
	page,
	request,
	baseURL
}) => {
	const best = async (prefix: string) => {
		const token = new URL(page.url()).searchParams.get('session_id');
		const res = await request.get(`${baseURL}/${prefix}/bestsubmission?session_id=${token}`);
		expect(res.headers()['content-type']).toContain('application/json');
		return res.json();
	};
	// LTI 1.1: student1 (bound in LTI-05) has an evaluated submission of mcq1.
	await launch1(page, baseURL!, 'lms-s1', { lis_result_sourcedid: 'sid-best' });
	await expect(page).toHaveURL(/\/lti\/task\?session_id=/);
	const body = await best('lti');
	expect(body).toMatchObject({
		status: 'success',
		submission: { courseid: C, taskid: 'mcq1', result: 'success', input: { '@username': 'e2e_student1' } },
		question_answer: [{ answer: 'Right', success: true, type: 'mcq' }]
	});
	expect(body.submission).not.toHaveProperty('stdout');
	expect(typeof body.task_context).toBe('string');
	// LTI 1.3 (its own binding key): student2 graded mcq2 in LTI-08.
	await launch13(page, baseURL!, resourceClaims(mock, { courseid: C, taskid: 'mcq2', secret: 's3cr3t' }));
	await expect(page).toHaveURL(/\/lti1\.3\/task\?session_id=/);
	expect(await best('lti1.3')).toMatchObject({ status: 'success', submission: { taskid: 'mcq2' } });
	// Unbound LMS user (still on the login step); no LTI session.
	await launch1(page, baseURL!, 'lms-unbound-best');
	await expect(page).toHaveURL(/\/lti\/login\?session_id=/);
	expect(await best('lti')).toEqual({ status: 'error', message: 'user not bound with lti' });
	expect((await request.get(`${baseURL}/lti/bestsubmission`)).status()).toBe(404);
});

test('LTI-03 an LTI session token does not open the normal UI, even for a bound superadmin', async ({
	page,
	request,
	baseURL
}) => {
	await bind('superadmin', `${C}/ltikey`, 'lms-root-m2');
	await launch1(page, baseURL!, 'lms-root-m2');
	await expect(page).toHaveURL(/\/lti\/task\?session_id=/);
	const token = new URL(page.url()).searchParams.get('session_id');
	expect((await request.get(`${baseURL}/lti/task?session_id=${token}`)).status()).toBe(200);
	for (const path of ['/administrator/users', `/admin/${C}/settings`, '/mycourses']) {
		const res = await request.get(`${baseURL}${path}?session_id=${token}`, { maxRedirects: 0 });
		expect(res.status(), path).toBe(302);
		expect(res.headers().location, path).toMatch(/^\/signin\?redirect=/);
	}
});

test('LTI-09 a course cannot redeclare the platform of another course with its own keys', async ({
	request,
	baseURL
}) => {
	const other = installCourse('lti_main', `${C}_h1`);
	const yaml = join(COURSE_YAML, '..', '..', other, 'course.yaml');
	const forged = registration(mock, { key_set_url: undefined, key_set: { keys: [] } });
	writeFileSync(yaml, stringify({ ...parse(readFileSync(yaml, 'utf8')), lti_config: forged }));
	const login = (course: string) =>
		request.get(
			`${baseURL}/lti1.3/oidc_login/${course}?${new URLSearchParams({ iss: mock.iss, login_hint: 'plat-user-1', target_link_uri: `${baseURL}/lti1.3/launch/${course}`, client_id: 'tool-client-1', lti1p3_new_window: '1' })}`,
			{ maxRedirects: 0 }
		);
	try {
		// Both conflicting course registrations are ignored: no launch can be verified with the forged keys.
		expect((await login(other)).status()).toBe(400);
		expect((await login(C)).status()).toBe(400);
	} finally {
		removeCourse(other);
	}
	expect((await login(C)).status()).toBe(302);
});
