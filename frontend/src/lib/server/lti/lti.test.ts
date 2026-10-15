import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jwtVerify } from 'jose';
import { ObjectId } from 'mongodb';
import { flush, ltiEvent, settle, setupLti, type LtiEnv } from '../../../../tests/fixtures/lti/setup.js';
import { result } from '../../../../tests/fixtures/task/setup.js';
import { launch11 as signed11, registration, resourceClaims } from '../../../../e2e/lti/mock/platform.js';
import { services } from '../app.js';
import type { Session } from '../auth/session.js';
import { getCourse, saveCourse } from '../courses/course.js';
import type { LtiData } from '../db/types.js';
import { plugins, resetPlugins } from '../plugins/index.js';
import {
	bindToken,
	bindTarget,
	externalUrl,
	findClient,
	ltiOrigins,
	realname,
	registrationConflict,
	toolConfig
} from './common.js';
import { launch11, useNonce } from './lti11.js';
import { CLAIM, DL_CLAIM, jwks, launch13, oidcLogin } from './lti13.js';
import { drain, enqueue, MAX_ATTEMPTS, sendAgs } from './outcomes.js';
import * as pages from './pages.js';

let env: LtiEnv;
const T = 'http://tool';
const PID = 'https://platform.example/tool-client-1/dep-1';

/** Stores an LTI session (optionally logged in as `username`); returns it with its token. */
async function ltiSession(lti: Partial<LtiData>, username?: string): Promise<{ session: Session; token: string }> {
	const session = env.sessions.create(true);
	session.doc.lti = {
		version: '1.1',
		email: '',
		username: 'lms-user-1',
		realname: 'LMS',
		roles: [],
		task: ['lti_test', 'mcq1'],
		redir_url: '/lti/task',
		consumer_key: 'ltikey',
		context_label: 'C',
		context_title: 'T',
		...lti
	};
	if (username) Object.assign(session.doc, { loggedin: true, username, realname: username, email: `${username}@x` });
	await env.sessions.commit(session);
	return { session, token: env.sessions.sign(session.doc._id) };
}

/** A logged-in normal (cookie) session. */
function userSession(username: string): Session {
	const s = env.sessions.create();
	Object.assign(s.doc, { loggedin: true, username, realname: username });
	return s;
}

/** Waits until the mock LMS received a request on `path` (the grading callback is asynchronous). */
async function logged(path: string, timeout = 6000) {
	for (let waited = 0; waited < timeout && !env.mock.log.some((l) => l.path === path); waited += 50) await flush(50);
}

/** Waits until both passback queues are empty. */
async function queuesEmpty(timeout = 6000) {
	for (let waited = 0; waited < timeout; waited += 50) {
		if (!(await env.db.c.lisOutcomes.countDocuments()) && !(await env.db.c.ltiGrades.countDocuments())) return;
		await flush(50);
	}
	throw new Error('queues not empty');
}

beforeAll(async () => {
	env = await setupLti();
	env.backend.queue = { running: [], waiting: [] };
});
afterAll(() => env.cleanup());
beforeEach(async () => {
	for (const c of [
		'submissions',
		'user_tasks',
		'users',
		'courses',
		'lis_outcome_queue',
		'lti_grade_queue',
		'lti_launch'
	])
		await env.db.db.collection(c).deleteMany({});
	await env.db.c.users.insertMany(
		['alice', 'bob', 'superadmin'].map((u) => ({
			username: u,
			realname: u.toUpperCase(),
			email: `${u}@x.org`,
			language: 'en',
			bindings: {}
		}))
	);
	// The mock LMS listens on http://localhost.
	Object.assign(services().config, { ltiConfig: registration(env.mock), raw: { lti_allow_private_urls: true } });
	env.mock.log.length = 0;
	resetPlugins();
});

describe('LTI 1.1 launch (LTI-02, LTI-03)', () => {
	const URL1 = `${T}/lti/lti_test/mcq1`;
	const launch = async (
		extra: Record<string, string | undefined> = {},
		form = signed11(URL1, 'ltikey', 'ltisecret', extra)
	) => {
		const ev = ltiEvent(URL1, { form });
		return { r: await settle(() => launch11(ev, 'lti_test', 'mcq1')), ev };
	};

	it('LTI-02 a signed launch creates a fresh LTI session and redirects to the login step; replays are refused', async () => {
		// Duplicates left by the legacy non-unique index are purged before the unique index is created.
		const ts = new Date();
		await env.db.c.nonce.insertMany([
			{ timestamp: ts, nonce: 'dup', expiration: ts },
			{ timestamp: ts, nonce: 'dup', expiration: ts }
		]);
		const form = signed11(URL1, 'ltikey', 'ltisecret', {
			lis_person_name_full: undefined,
			lis_person_name_given: 'Ada',
			lis_person_name_family: 'Lovelace',
			roles: 'Instructor, Learner'
		});
		const { r, ev } = await launch({}, form);
		expect(r.status).toBe(302);
		expect(r.location).toMatch(/^\/lti\/login\?session_id=[0-9a-f]{24}\.[\w-]{43}$/);
		const doc = ev.locals.session.doc;
		expect(doc).toMatchObject({ is_lti: true, loggedin: false });
		expect(doc.lti).toMatchObject({
			version: '1.1',
			username: 'lms-user-1',
			realname: 'Ada Lovelace',
			roles: ['Instructor', 'Learner'],
			task: ['lti_test', 'mcq1'],
			consumer_key: 'ltikey',
			outcome_service_url: 'http://lms.example/outcome',
			outcome_result_id: 'sourcedid-1',
			context_title: 'LMS course',
			tool_name: 'MockLMS'
		});
		expect(doc.lti!.redir_url).toBe(`/lti/task?session_id=${r.location!.split('=')[1]}`);
		expect(await env.sessions.commit(ev.locals.session)).toBeNull(); // no cookie
		expect((await launch({}, form)).r.status).toBe(403);
		expect(await env.db.c.nonce.indexExists('nonce_1_timestamp_1')).toBe(true);
		expect(await useNonce('dup', ts.getTime() / 1000)).toBe(true);
	});

	it('LTI-02 rejects bad signatures (403), missing user_id (400), unknown courses (404) and missing outcome parameters', async () => {
		expect((await launch({}, { ...signed11(URL1, 'ltikey', 'ltisecret'), oauth_signature: 'x' })).r).toMatchObject({
			status: 403,
			message: "Couldn't validate LTI request"
		});
		expect((await launch({ user_id: undefined })).r.status).toBe(400);
		expect((await launch({ lis_outcome_service_url: undefined })).r.message).toMatch(
			/^In order to send grade back to the TC/
		);
		expect((await settle(() => launch11(ltiEvent(URL1, { form: {} }), 'nope', 'mcq1'))).status).toBe(404);
	});

	it('LTI-02 without grade passback the outcome parameters are not stored; defaults are N/A / Student', async () => {
		const c = getCourse('lti_test');
		saveCourse('lti_test', { ...c.content, lti_send_back_grade: false });
		try {
			const { ev } = await launch({
				roles: undefined,
				context_title: undefined,
				lis_person_name_full: undefined,
				lis_person_contact_email_primary: undefined
			});
			expect(ev.locals.session.doc.lti).toMatchObject({
				roles: ['Student'],
				context_title: 'N/A',
				realname: 'lms-user-1',
				email: ''
			});
			expect(ev.locals.session.doc.lti).not.toHaveProperty('outcome_service_url');
		} finally {
			saveCourse('lti_test', c.content);
		}
	});

	it('LTI-02 uses X-Forwarded-* only when the reverse proxy is configured', () => {
		const ev = ltiEvent(URL1, {
			headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'inginious.example, proxy' }
		});
		expect(externalUrl(ev).href).toBe(URL1);
		services().config.raw = { 'reverse-proxy-config': { enable: true }, lti_allow_private_urls: true };
		expect(externalUrl(ev).href).toBe('https://inginious.example/lti/lti_test/mcq1');
		expect(externalUrl(ltiEvent(URL1)).href).toBe(URL1);
		// The forwarded host replaces the port of the internal URL.
		const internal = ltiEvent('http://localhost:3000/lti/lti_test/mcq1', {
			headers: { 'x-forwarded-host': 'inginious.example' }
		});
		expect(externalUrl(internal).href).toBe('http://inginious.example/lti/lti_test/mcq1');
	});
});

describe('LTI 1.3 (LTI-08, LTI-09, LTI-11)', () => {
	const query = (extra = '') =>
		`iss=${encodeURIComponent('https://platform.example')}&login_hint=u1&target_link_uri=${encodeURIComponent(`${T}/lti1.3/launch`)}&client_id=tool-client-1&lti_message_hint=h${extra}`;
	const oidc = async (path = '/lti1.3/oidc_login', extra = '&lti1p3_new_window=1') => {
		const ev = ltiEvent(`${T}${path}?${query(extra)}`);
		const r = await settle(() => oidcLogin(ev, path.split('/')[3]));
		const loc = new URL(r.location ?? 'http://x');
		return { r, ev, loc, state: loc.searchParams.get('state')!, nonce: loc.searchParams.get('nonce')! };
	};
	const launch = async (
		claims: Record<string, unknown>,
		opts: { state?: string; aud?: string; courseid?: string; taskid?: string; token?: string } = {}
	) => {
		const { state, nonce } = await oidc();
		const token =
			opts.token ??
			(await env.mock.idToken({ aud: opts.aud ?? 'tool-client-1', sub: 'plat-user-1', nonce, ...claims }));
		const ev = ltiEvent(`${T}/lti1.3/launch`, { form: { id_token: token, state: opts.state ?? state } });
		ev.cookies.jar.set(`lti1p3-${state}`, state);
		return { r: await settle(() => launch13(ev, opts.courseid, opts.taskid)), ev, state, token };
	};

	it('LTI-08 checks cookies first, then sets the state cookie, stores the nonce and redirects to the platform', async () => {
		const first = await oidc('/lti1.3/oidc_login', '');
		const html = await (first.r.value as Response).text();
		expect(html).toContain('lti1p3_new_window=1');
		expect(html).toContain('Your browser prohibits to save cookies in the iframes.');
		expect(html).not.toContain('Partitioned');
		// The page only runs its own inline script (CSP hash).
		const script = /<script>(.*)<\/script>/.exec(html)![1];
		const hash = createHash('sha256').update(script).digest('base64');
		expect((first.r.value as Response).headers.get('content-security-policy')).toBe(
			`default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'`
		);
		const { loc, state, nonce, ev } = await oidc();
		expect([...loc.searchParams.keys()]).toEqual([
			'scope',
			'response_type',
			'response_mode',
			'prompt',
			'client_id',
			'redirect_uri',
			'state',
			'nonce',
			'login_hint',
			'lti_message_hint'
		]);
		expect(loc.origin + loc.pathname).toBe(`${env.mock.url}/auth`);
		expect(ev.cookies.jar.get(`lti1p3-${state}`)).toBe(state);
		expect(JSON.parse(ev.cookies.jar.get(`lti1p3-${state}:opts`)!)).toMatchObject({
			httpOnly: true,
			maxAge: 300,
			sameSite: 'lax',
			secure: false
		});
		// Entries expire (TTL index).
		expect(await env.db.c.ltiLaunch.findOne({ key: `lti1p3-nonce-${nonce}` })).toMatchObject({
			value: state,
			expires: expect.any(Date)
		});
		services().config.raw = { 'reverse-proxy-config': { enable: true }, lti_allow_private_urls: true };
		const https = ltiEvent(`${T}/lti1.3/oidc_login?${query()}`, {
			method: 'POST',
			form: Object.fromEntries(new URLSearchParams(query('&lti1p3_new_window=1'))),
			headers: { 'x-forwarded-proto': 'https' }
		});
		await settle(() => oidcLogin(https));
		expect([...https.cookies.jar.values()].some((v) => v.includes('"sameSite":"none"'))).toBe(true);
		const page = await oidcLogin(
			ltiEvent(`${T}/lti1.3/oidc_login?${query()}`, { headers: { 'x-forwarded-proto': 'https' } })
		);
		expect(await page.text()).toContain('Partitioned');
	});

	it('LTI-08 refuses incomplete requests, unknown platforms and unknown courses', async () => {
		expect((await settle(() => oidcLogin(ltiEvent(`${T}/lti1.3/oidc_login?iss=x`)))).status).toBe(400);
		expect(
			(
				await settle(() =>
					oidcLogin(ltiEvent(`${T}/lti1.3/oidc_login?${query().replace('platform.example', 'other')}`))
				)
			).status
		).toBe(400);
		expect((await oidc('/lti1.3/oidc_login/nope')).r.status).toBe(404);
		// Two clients, no client_id: the `default` one.
		const two = registration(env.mock);
		two[env.mock.iss].push({ ...two[env.mock.iss][0], client_id: 'second', default: false });
		services().config.ltiConfig = two;
		expect(findClient(toolConfig(null), env.mock.iss)?.client_id).toBe('tool-client-1');
		expect(findClient(toolConfig(null), env.mock.iss, 'second')?.client_id).toBe('second');
	});

	it('LTI-09 a valid resource launch stores the launch and creates the LTI session; the nonce cannot be reused', async () => {
		const { r, ev, token, state } = await launch(
			resourceClaims(env.mock, { courseid: 'lti_test', taskid: 'mcq2', secret: 's3cr3t' })
		);
		expect(r.location).toMatch(/^\/lti1\.3\/login\?session_id=/);
		const lti = ev.locals.session.doc.lti!;
		expect(lti).toMatchObject({
			version: '1.3',
			username: 'plat-user-1',
			realname: 'Platform User',
			email: 'plat-user@platform.example',
			task: ['lti_test', 'mcq2'],
			platform_instance_id: PID,
			course_secret: 's3cr3t',
			context_title: 'Platform course',
			context_label: 'P101',
			tool_name: 'MockLMS'
		});
		expect(lti.redir_url).toMatch(/^\/lti1\.3\/task\?session_id=/);
		expect((await env.db.c.ltiLaunch.findOne({ key: lti.message_launch_id }))?.value).toMatchObject({
			sub: 'plat-user-1'
		});
		expect(ev.cookies.jar.has(`lti1p3-${state}`)).toBe(false);
		// Replaying the same POST (state cookie re-sent) fails: the nonce was consumed.
		const replay = ltiEvent(`${T}/lti1.3/launch`, { form: { id_token: token, state } });
		replay.cookies.jar.set(`lti1p3-${state}`, state);
		expect((await settle(() => launch13(replay))).message).toBe('Invalid LTI launch (nonce).');
	});

	it('LTI-09 deep-linking launches go to the picker; URL course/task override the custom claim', async () => {
		const deep = {
			[`${CLAIM}deployment_id`]: 'dep-1',
			[`${CLAIM}message_type`]: 'LtiDeepLinkingRequest',
			[`${CLAIM}version`]: '1.3.0',
			[`${DL_CLAIM}deep_linking_settings`]: { deep_link_return_url: 'x' },
			given_name: 'Ada',
			family_name: 'L'
		};
		const { ev } = await launch(deep);
		expect(ev.locals.session.doc.lti).toMatchObject({
			task: ['', ''],
			course_secret: '',
			realname: 'Ada L',
			context_title: 'N/A',
			tool_name: 'N/A'
		});
		expect(ev.locals.session.doc.lti!.redir_url).toMatch(/^\/lti1\.3\/deeplink\?/);
		const { ev: ev2 } = await launch(resourceClaims(env.mock, {}), { courseid: 'lti_test', taskid: 'mcq1' });
		expect(ev2.locals.session.doc.lti).toMatchObject({ task: ['lti_test', 'mcq1'], course_secret: '' });
	});

	it('LTI-09 rejects bad state, tokens, issuers, signatures, deployments and messages', async () => {
		const claims = resourceClaims(env.mock, { courseid: 'lti_test', taskid: 'mcq1' });
		const msg = async (p: Promise<{ r: { message?: string } }>) => (await p).r.message;
		expect(await msg(launch(claims, { state: 'state-forged' }))).toBe('Invalid LTI launch (state).');
		expect(await msg(launch(claims, { token: 'not.a.jwt' }))).toBe('Invalid LTI launch (id_token).');
		expect(await msg(launch(claims, { aud: 'unknown-client' }))).toBe('Invalid LTI launch (issuer).');
		expect(await msg(launch({ ...claims, exp: Math.floor(Date.now() / 1000) - 10 }))).toBe(
			'Invalid LTI launch (signature).'
		);
		expect(await msg(launch({ ...claims, [`${CLAIM}deployment_id`]: 'dep-9' }))).toBe(
			'Invalid LTI launch (deployment).'
		);
		expect(await msg(launch({ ...claims, [`${CLAIM}version`]: '1.1' }))).toBe('Invalid LTI launch (message).');
		expect(await msg(launch(resourceClaims(env.mock, {})))).toBe('Invalid LTI launch (message).');
		// Inline key set and a token signed by another key.
		services().config.ltiConfig = registration(env.mock, { key_set: { keys: [] } });
		expect(await msg(launch(claims))).toBe('Invalid LTI launch (signature).');
		// Without lti_allow_private_urls, the key set of the (http, local) mock is not fetched.
		services().config.ltiConfig = registration(env.mock, { key_set_url: `${env.mock.url}/jwks?private` });
		services().config.raw = {};
		env.mock.log.length = 0;
		expect(await msg(launch(claims))).toBe('Invalid LTI launch (signature).');
		expect(env.mock.log).toEqual([]);
	});

	it('LTI-09 a course cannot redeclare a platform of another source with its own keys', async () => {
		const [test, plain] = [getCourse('lti_test'), getCourse('plain')];
		const forged = registration(env.mock, { key_set: { keys: [] } });
		saveCourse('plain', { ...plain.content, is_lti: true, lti_config: forged });
		try {
			// Global registration shadowed: only the global keys are trusted for course plain.
			expect(registrationConflict('plain', env.mock.iss, forged[env.mock.iss][0])).toBe('configuration.yaml');
			expect(toolConfig(getCourse('plain'))[env.mock.iss]).toEqual(registration(env.mock)[env.mock.iss]);
			// Course against course: both registrations are refused (a launch of plain is unknown).
			services().config.ltiConfig = {};
			saveCourse('lti_test', { ...test.content, lti_config: registration(env.mock) });
			expect(registrationConflict('plain', env.mock.iss, forged[env.mock.iss][0])).toBe('course lti_test');
			expect(toolConfig(getCourse('plain'))).toEqual({});
			expect(toolConfig(getCourse('lti_test'))).toEqual({});
			expect((await oidc('/lti1.3/oidc_login/plain')).r.status).toBe(400);
			// The same platform keys in two courses are accepted (one LMS, several courses).
			saveCourse('plain', { ...plain.content, is_lti: true, lti_config: registration(env.mock) });
			expect(toolConfig(getCourse('plain'))[env.mock.iss]).toHaveLength(1);
		} finally {
			saveCourse('plain', plain.content);
			saveCourse('lti_test', test.content);
		}
	});

	it('LTI-11 JWKS exposes the public key of a registration only, without mutating any configuration', async () => {
		const hash = createHash('md5').update(`${env.mock.iss}tool-client-1`).digest('hex');
		const body = await (await jwks(hash)).json();
		expect(Object.keys(body.keys[0])).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
		expect(body.keys[0]).toMatchObject({ alg: 'RS256', kty: 'RSA', use: 'sig' });
		expect(body.keys[0]).not.toHaveProperty('d');
		expect((await jwks(`lti_test/${hash}`)).status).toBe(200);
		expect((await jwks(`plain/${hash}`)).status).toBe(200);
		expect(getCourse('lti_test').ltiConfig).toEqual({});
		expect((await settle(() => jwks('a/b/bad'))).status).toBe(404);
		expect((await settle(() => jwks('bad'))).status).toBe(404);
		expect((await settle(() => jwks(`nope/${hash}`))).status).toBe(404);
		// Course registration (only `private_key` given), single-dict global form.
		services().config.ltiConfig = { other: { ...registration(env.mock)[env.mock.iss][0], public_key: '' } };
		const c = getCourse('lti_test');
		saveCourse('lti_test', { ...c.content, lti_config: registration(env.mock) });
		try {
			expect(toolConfig(getCourse('lti_test'))).toMatchObject({ other: [{}], [env.mock.iss]: [{}] });
			expect(
				(await (await jwks(createHash('md5').update('othertool-client-1').digest('hex'))).json()).keys[0].kid
			).toBe(body.keys[0].kid);
		} finally {
			saveCourse('lti_test', c.content);
		}
	});
});

describe('LTI login and binding (LTI-03, LTI-04)', () => {
	it('LTI-04 unbound users get a bind link; once bound the login rotates the session and redirects', async () => {
		const { session, token } = await ltiSession({ redir_url: '/lti/task?session_id=old' });
		const ev = ltiEvent(`${T}/lti/login?session_id=${token}`, { session });
		const { bindUrl } = await pages.loginPage(ev);
		expect(bindUrl).toMatch(/^\/lti\/bind\?lti_session_id=[0-9a-f]{24}\.\d+\.[\w-]{43}$/);
		// Bind page in the normal session of the browser.
		const bindEv = () => ltiEvent(`${T}${bindUrl}`, { session: userSession('alice'), form: {} });
		expect(await pages.bindPage(bindEv())).toMatchObject({
			user: { username: 'alice' },
			lti: { username: 'lms-user-1', context_label: 'C' }
		});
		expect(await pages.bindAction(bindEv())).toEqual({ bound: true });
		expect(await pages.bindAction(bindEv())).toEqual({ bound: true }); // idempotent
		expect((await env.db.c.users.findOne({ username: 'alice' }))?.ltibindings).toEqual({
			'lti_test/ltikey': 'lms-user-1'
		});
		// Another account cannot take the same LMS user.
		const other = await pages.bindAction(ltiEvent(`${T}${bindUrl}`, { session: userSession('bob'), form: {} }));
		expect(other).toMatchObject({ status: 400, data: { message: 'Your account is already bound with this context.' } });
		const oldId = session.doc._id;
		const r = await settle(() => pages.loginPage(ev));
		expect(session.doc._id.equals(oldId)).toBe(false);
		expect(session.doc).toMatchObject({ loggedin: true, username: 'alice', realname: 'ALICE', email: 'alice@x.org' });
		expect(r.location).toBe(`/lti/task?session_id=${env.sessions.sign(session.doc._id)}`);
		expect((await settle(() => pages.loginPage(ev))).location).toBe(r.location);
	});

	it('LTI-04 an account bound to another LMS user cannot bind a second one; 1.3 keys drop dots', async () => {
		await env.db.c.users.updateOne(
			{ username: 'bob' },
			{ $set: { ltibindings: { 'https://platformexample/tool-client-1/dep-1': 'someone' } } }
		);
		const { session } = await ltiSession({ version: '1.3', platform_instance_id: PID, username: 'plat-user-1' });
		const url = `${T}/lti1.3/bind?lti_session_id=${bindToken(session.doc._id)}`;
		expect(await pages.bindAction(ltiEvent(url, { session: userSession('bob'), form: {} }))).toMatchObject({
			status: 400
		});
		expect(await pages.bindAction(ltiEvent(url, { session: userSession('alice'), form: {} }))).toEqual({ bound: true });
		expect((await env.db.c.users.findOne({ username: 'alice' }))?.ltibindings).toEqual({
			'https://platformexample/tool-client-1/dep-1': 'plat-user-1'
		});
	});

	it('LTI-04 bind tokens are signed, expire, and need a stored LTI session; the bind page needs a signed-in user', async () => {
		const { session } = await ltiSession({});
		const id = session.doc._id;
		expect((await bindTarget(bindToken(id))).username).toBe('lms-user-1');
		expect((await settle(() => bindTarget(bindToken(id, Date.now() - 3600_000)))).status).toBe(400);
		const tok = bindToken(id);
		expect((await settle(() => bindTarget(tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A')))).status).toBe(400);
		expect((await settle(() => bindTarget(null))).status).toBe(400);
		expect((await settle(() => bindTarget(bindToken(new ObjectId())))).status).toBe(400);
		const anon = await settle(() => pages.bindPage(ltiEvent(`${T}/lti/bind?lti_session_id=${bindToken(id)}`)));
		expect(anon.location).toMatch(/^\/signin\?redirect=/);
	});

	it('LTI-03 pages without LTI data answer 403 "No LTI data available."', async () => {
		expect(await settle(() => pages.loginPage(ltiEvent(`${T}/lti/login`)))).toMatchObject({
			status: 403,
			message: 'No LTI data available.'
		});
		expect(
			(await settle(() => pages.loadLtiTask(ltiEvent(`${T}/lti/task`, { session: userSession('alice') })))).status
		).toBe(403);
	});
});

describe('LTI task page and grade passback (LTI-05, LTI-06, LTI-07, LTI-12)', () => {
	const submit = async (session: Session, path = '/lti/task') => {
		const res = await pages.ltiTaskAction(ltiEvent(`${T}${path}`, { session, form: { '@action': 'submit', q1: '0' } }));
		return (await res.json()) as { status: string; submissionid: string };
	};

	it('LTI-05 loads the task with LTI asset links, registers the user and hides the navigation', async () => {
		const { session, token } = await ltiSession({}, 'alice');
		const data = await pages.loadLtiTask(ltiEvent(`${T}/lti/task?session_id=${token}`, { session }));
		expect(data).toMatchObject({
			courseId: 'lti_test',
			taskId: 'mcq1',
			actionUrl: `/lti/task?session_id=${token}`,
			admin: false,
			webterm: null
		});
		expect(data.context).toContain(`src="/lti/asset/public/pixel.png?session_id=${token}"`);
		expect(data.context).toContain('href="https://example.org/x"');
		expect((await env.db.c.courses.findOne({ _id: 'lti_test' }))?.students).toContain('alice');
		expect(pages.assetUrl('/abs?x', token)).toBe('/abs?x');
		expect(pages.assetUrl('a/b.png?x=1#f', 't')).toBe('/lti/asset/a/b.png?x=1&session_id=t#f');
	});

	it('LTI-05 not logged in → login step; LTI 1.3 secret checked on every endpoint; non-LTI courses refused without registration', async () => {
		const anon = await ltiSession({ version: '1.3', platform_instance_id: PID, course_secret: 's3cr3t' });
		expect(
			(await settle(() => pages.loadLtiTask(ltiEvent(`${T}/lti1.3/task`, { session: anon.session })))).location
		).toMatch(/^\/lti1\.3\/login\?session_id=/);
		const wrong = await ltiSession({ version: '1.3', platform_instance_id: PID, course_secret: 'WRONG' }, 'alice');
		for (const call of [
			() => pages.loadLtiTask(ltiEvent(`${T}/lti/task`, { session: wrong.session })),
			() => pages.ltiTaskAction(ltiEvent(`${T}/lti/task`, { session: wrong.session, form: {} })),
			() => pages.ltiAsset(ltiEvent(`${T}/lti/asset/x`, { session: wrong.session }), 'x')
		] as (() => Promise<unknown>)[])
			expect(await settle(call)).toMatchObject({ status: 403, message: 'Invalid LTI secret' });
		const plain = await ltiSession({ task: ['plain', 'mcq1'] }, 'bob');
		expect((await settle(() => pages.loadLtiTask(ltiEvent(`${T}/lti/task`, { session: plain.session })))).status).toBe(
			403
		);
		expect(await env.db.c.courses.findOne({ _id: 'plain' })).toBeNull();
	});

	it('LTI-06 serves the public files of the session task (leading public/ optional, no traversal)', async () => {
		const { session } = await ltiSession({}, 'alice');
		const ev = () => ltiEvent(`${T}/lti/asset/x`, { session });
		expect(await (await pages.ltiAsset(ev(), 'public/hello.txt')).text()).toBe(
			readFileSync(join(env.dir, 'lti_test/mcq1/public/hello.txt'), 'utf8')
		);
		expect((await pages.ltiAsset(ev(), 'pixel.png')).headers.get('content-type')).toBe('image/png');
		expect((await settle(() => pages.ltiAsset(ev(), '../task.yaml'))).status).toBe(404);
	});

	it('LTI-07 a graded 1.1 submission is tagged and its user-task grade sent to the LIS outcome service', async () => {
		const { session } = await ltiSession(
			{ outcome_service_url: `${env.mock.url}/outcome`, outcome_result_id: 'sid-<1>' },
			'alice'
		);
		const res = await submit(session);
		expect(res.status).toBe('ok');
		expect(plugins()).toBeDefined();
		const sub = await env.db.c.submissions.findOne({});
		expect(sub).toMatchObject({
			lti_version: '1.1',
			outcome_service_url: `${env.mock.url}/outcome`,
			outcome_result_id: 'sid-<1>',
			outcome_consumer_key: 'ltikey'
		});
		env.backend.last.cb.onDone(result(['success', 'ok']));
		await logged('/outcome');
		await queuesEmpty();
		const req = env.mock.log.find((l) => l.path === '/outcome')!;
		expect(req.body).toContain('<sourcedId>sid-&lt;1&gt;</sourcedId>');
		expect(req.body).toContain('<textString>1.0</textString>');
		expect(req.body.startsWith("<?xml version='1.0' encoding='utf-8'?>\n<imsx_POXEnvelopeRequest")).toBe(true);
		expect(req.headers.authorization).toMatch(
			/^OAuth oauth_nonce="\w+", oauth_timestamp="\d+", oauth_version="1.0", oauth_signature_method="HMAC-SHA1", oauth_consumer_key="ltikey", oauth_body_hash="[^"]+", oauth_signature="[^"]+"$/
		);
		expect(req.headers['content-type']).toBe('application/xml');
	});

	it('LTI-07 failing outcome services are retried 6 times then dropped; missing grades/keys are failed attempts', async () => {
		const doc = {
			username: 'alice',
			courseid: 'lti_test',
			taskid: 'mcq1',
			nb_attempt: 0,
			outcome_consumer_key: 'ltikey',
			outcome_result_id: 'r',
			outcome_service_url: `${env.mock.url}/outcome_fail`
		};
		await env.db.c.userTasks.insertOne({
			username: 'alice',
			courseid: 'lti_test',
			taskid: 'mcq1',
			grade: 75,
			submissionid: null,
			succeeded: false,
			tried: 1,
			random: [],
			tokens: { amount: 0, date: new Date() },
			state: ''
		});
		await env.db.c.userTasks.insertOne({
			username: 'alice',
			courseid: 'nope',
			taskid: 'mcq1',
			grade: 1,
			submissionid: null,
			succeeded: false,
			tried: 1,
			random: [],
			tokens: { amount: 0, date: new Date() },
			state: ''
		});
		await env.db.c.lisOutcomes.insertMany([
			doc,
			{ ...doc, username: 'nobody' },
			{ ...doc, outcome_consumer_key: 'gone', outcome_service_url: `${env.mock.url}/outcome` },
			{ ...doc, courseid: 'nope', nb_attempt: 5 }
		]);
		await Promise.all([drain(), drain()]);
		await queuesEmpty();
		const fails = env.mock.log.filter((l) => l.path === '/outcome_fail');
		expect(fails).toHaveLength(MAX_ATTEMPTS);
		expect(fails[0].body).toContain('<textString>0.75</textString>');
		expect(env.mock.log.filter((l) => l.path === '/outcome')).toHaveLength(0);
		// Without lti_allow_private_urls, the (http, local) outcome service is never contacted.
		services().config.raw = {};
		await env.db.c.lisOutcomes.insertOne({ ...doc, outcome_service_url: `${env.mock.url}/outcome` });
		await drain();
		await queuesEmpty();
		expect(env.mock.log.filter((l) => l.path === '/outcome')).toHaveLength(0);
	});

	it('LTI-12 a graded 1.3 submission posts a score to the AGS line item with a client-assertion token', async () => {
		const claims = { iss: env.mock.iss, aud: 'tool-client-1', sub: 'plat-user-1', ...resourceClaims(env.mock, {}) };
		await env.db.c.ltiLaunch.insertOne({ key: 'lti1p3-launch-x', value: claims, context: [] });
		const { session } = await ltiSession(
			{ version: '1.3', platform_instance_id: PID, course_secret: 's3cr3t', message_launch_id: 'lti1p3-launch-x' },
			'alice'
		);
		expect((await submit(session, '/lti1.3/task')).status).toBe('ok');
		expect(await env.db.c.submissions.findOne({})).toMatchObject({
			lti_version: '1.3',
			message_launch_id: 'lti1p3-launch-x'
		});
		env.backend.last.cb.onDone(result(['failed', 'no'], { grade: 40 }));
		await logged('/token');
		await queuesEmpty();
		const tokenReq = env.mock.log.find((l) => l.path === '/token')!;
		const form = new URLSearchParams(tokenReq.body);
		expect(form.get('grant_type')).toBe('client_credentials');
		expect(form.get('scope')).toBe(
			'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem https://purl.imsglobal.org/spec/lti-ags/scope/score'
		);
		const { payload, protectedHeader } = await jwtVerify(
			form.get('client_assertion')!,
			createPublicKey(env.mock.tool.publicPem),
			{ audience: `${env.mock.url}/token` }
		);
		expect(payload).toMatchObject({ iss: 'tool-client-1', sub: 'tool-client-1' });
		expect(protectedHeader).toMatchObject({ alg: 'RS256', typ: 'JWT' });
		const score = env.mock.log.find((l) => l.path === '/lineitems/1/lineitem/scores')!;
		expect(score.headers).toMatchObject({
			authorization: 'Bearer mock-access-token',
			'content-type': 'application/vnd.ims.lis.v1.score+json'
		});
		expect(JSON.parse(score.body)).toMatchObject({
			scoreGiven: 40,
			scoreMaximum: 100,
			activityProgress: 'Completed',
			gradingProgress: 'FullyGraded',
			userId: 'plat-user-1'
		});
	});

	it('LTI-12 entries that can never succeed are dropped at once; failing score endpoints are retried', async () => {
		const claims = {
			iss: env.mock.iss,
			aud: 'tool-client-1',
			sub: 'u',
			...resourceClaims(env.mock, {}, {}, 'lineitem_fail')
		};
		await env.db.c.ltiLaunch.insertMany([
			{ key: 'k-fail', value: claims, context: [] },
			{ key: 'k-noscope', value: { iss: env.mock.iss }, context: [] },
			{ key: 'k-unknown', value: { ...claims, iss: 'other' }, context: [] }
		]);
		expect(
			await sendAgs(
				{ username: 'a', courseid: 'lti_test', taskid: 'mcq1', nb_attempt: 0, message_launch_id: 'k-noscope' },
				1
			)
		).toBeNull();
		expect(
			await sendAgs(
				{ username: 'a', courseid: 'lti_test', taskid: 'mcq1', nb_attempt: 0, message_launch_id: 'k-unknown' },
				1
			)
		).toBe(false);
		services().config.ltiConfig = registration(env.mock, { auth_token_url: `${env.mock.url}/nothing` });
		expect(
			await sendAgs(
				{ username: 'a', courseid: 'lti_test', taskid: 'mcq1', nb_attempt: 0, message_launch_id: 'k-fail' },
				1
			)
		).toBe(false);
		services().config.ltiConfig = registration(env.mock);
		await env.db.c.userTasks.insertOne({
			username: 'alice',
			courseid: 'lti_test',
			taskid: 'mcq1',
			grade: 100,
			submissionid: null,
			succeeded: true,
			tried: 1,
			random: [],
			tokens: { amount: 0, date: new Date() },
			state: ''
		});
		await env.db.c.ltiGrades.insertMany([
			{ username: 'alice', courseid: 'lti_test', taskid: 'mcq1', nb_attempt: 4, message_launch_id: 'k-fail' },
			{ username: 'alice', courseid: 'lti_test', taskid: 'mcq1', nb_attempt: 0, message_launch_id: 'k-noscope' }
		]);
		await drain();
		await queuesEmpty();
		expect(env.mock.log.filter((l) => l.path === '/lineitems/1/lineitem_fail/scores')).toHaveLength(2);
	});

	it('LTI-05 passback off: submissions are not tagged', async () => {
		const c = getCourse('lti_test');
		saveCourse('lti_test', { ...c.content, lti_send_back_grade: false });
		try {
			const { session } = await ltiSession({}, 'alice');
			expect((await submit(session)).status).toBe('ok');
			expect(await env.db.c.submissions.findOne({})).not.toHaveProperty('lti_version');
			expect(pages.ltiTags(session.doc.lti!, getCourse('lti_test'))).toEqual({});
		} finally {
			saveCourse('lti_test', c.content);
		}
	});
});

describe('LTI 1.3 deep linking (LTI-10)', () => {
	const deepClaims = (data: unknown = 'opaque') => ({
		iss: env.mock.iss,
		aud: ['tool-client-1'],
		[`${CLAIM}deployment_id`]: 'dep-1',
		[`${DL_CLAIM}deep_linking_settings`]: {
			deep_link_return_url: `${env.mock.url}/dlreturn`,
			...(data !== undefined && { data })
		}
	});
	const deepSession = async (username?: string, pid = PID) => {
		await env.db.c.ltiLaunch.insertOne({ key: 'dl-1', value: deepClaims(), context: [] });
		return ltiSession(
			{ version: '1.3', platform_instance_id: pid, task: ['', ''], message_launch_id: 'dl-1' },
			username
		);
	};
	const select = (session: Session, form: Record<string, string>) =>
		settle(() => pages.deepLinkSelect(ltiEvent(`${T}/lti1.3/deeplink`, { session, form })));

	it('LTI-10 lists the administered LTI courses and returns a signed deep-linking response', async () => {
		const { session } = await deepSession('superadmin');
		const data = await pages.deepLinkData(ltiEvent(`${T}/lti1.3/deeplink`, { session }));
		expect(data.courses).toEqual([
			{
				id: 'lti_test',
				name: '[LTI] LTI test course',
				tasks: [
					{ id: 'mcq1', name: 'LTI MCQ 1' },
					{ id: 'mcq2', name: 'LTI MCQ 2' }
				]
			}
		]);
		const { value } = await select(session, { courseid: 'lti_test', taskid: 'mcq1' });
		expect(value!.url).toBe(`${env.mock.url}/dlreturn`);
		const { payload, protectedHeader } = await jwtVerify(value!.jwt, createPublicKey(env.mock.tool.publicPem), {
			issuer: 'tool-client-1',
			audience: env.mock.iss
		});
		expect(protectedHeader.kid).toBeTruthy();
		expect(payload).toMatchObject({
			[`${CLAIM}message_type`]: 'LtiDeepLinkingResponse',
			[`${CLAIM}deployment_id`]: 'dep-1',
			[`${DL_CLAIM}data`]: 'opaque',
			[`${DL_CLAIM}content_items`]: [
				{
					type: 'ltiResourceLink',
					title: 'LTI MCQ 1',
					url: `${T}/lti1.3/launch`,
					custom: { courseid: 'lti_test', taskid: 'mcq1', secret: 's3cr3t' }
				}
			]
		});
	});

	it('LTI-10 creates and saves a missing deployment secret', async () => {
		const c = getCourse('lti_test');
		try {
			const { session } = await deepSession('superadmin', `${PID}x`);
			const { value } = await select(session, { courseid: 'lti_test', taskid: 'mcq2' });
			const secret = getCourse('lti_test').ltiSecrets[`${PID}x`];
			expect(secret).toMatch(/^[0-9a-f]{32}$/);
			expect(JSON.stringify((await jwtVerify(value!.jwt, createPublicKey(env.mock.tool.publicPem))).payload)).toContain(
				secret
			);
		} finally {
			saveCourse('lti_test', c.content);
		}
	});

	it('LTI-10 refuses non-admins, unknown tasks, unbound and non deep-linking sessions', async () => {
		const { session } = await deepSession('alice');
		expect((await pages.deepLinkData(ltiEvent(`${T}/lti1.3/deeplink`, { session }))).courses).toEqual([]);
		expect((await select(session, { courseid: 'lti_test', taskid: 'mcq1' })).status).toBe(403);
		const admin = await ltiSession(
			{ version: '1.3', platform_instance_id: PID, message_launch_id: 'dl-1' },
			'superadmin'
		);
		expect((await select(admin.session, { courseid: 'lti_test', taskid: 'nope' })).status).toBe(404);
		services().config.ltiConfig = {};
		expect((await select(admin.session, { courseid: 'lti_test', taskid: 'mcq1' })).status).toBe(400);
		const anon = await ltiSession({ version: '1.3', message_launch_id: 'dl-1' });
		expect(
			(await settle(() => pages.deepLinkData(ltiEvent(`${T}/lti1.3/deeplink`, { session: anon.session })))).location
		).toMatch(/^\/lti1\.3\/login/);
		const resource = await ltiSession({ version: '1.3', message_launch_id: 'missing' }, 'superadmin');
		expect(
			(await settle(() => pages.deepLinkData(ltiEvent(`${T}/lti1.3/deeplink`, { session: resource.session })))).status
		).toBe(403);
	});
});

describe('helpers', () => {
	it('LTI-02 realname fallbacks', () => {
		expect(realname('Full', 'G', 'F', 'e', 'id')).toBe('Full');
		expect(realname('', 'G', 'F', 'e', 'id')).toBe('G F');
		expect(realname('', 'G', '', 'e', 'id')).toBe('e');
		expect(realname('', '', 'F', '', 'id')).toBe('F');
		expect(realname('', 'G', '', '', 'id')).toBe('G');
		expect(realname()).toBe('');
	});

	it('LTI-01 LTI-03 LMS origins allowed to frame the LTI pages', () => {
		const course = getCourse('lti_test');
		services().config.ltiConfig = { ...registration(env.mock), 'not a url': { auth_login_url: 'ftp://x' } };
		services().config.raw = { lti_frame_ancestors: ['https://*.lms.example'] };
		saveCourse('lti_test', {
			...course.content,
			lti_config: { 'https://course.example': [{ auth_login_url: 'https://auth.course.example:8443/login' }] }
		});
		try {
			const configured = [
				'https://*.lms.example',
				'https://platform.example',
				env.mock.url,
				'https://course.example',
				'https://auth.course.example:8443'
			];
			const lti11 = (extra: Partial<LtiData>) => ({ version: '1.1', ...extra }) as LtiData;
			// LTI 1.3 and pages without a session: the configured platforms only.
			expect(ltiOrigins({ version: '1.3' } as LtiData, '/lti1.3/task')).toEqual(configured);
			expect(ltiOrigins(null, '/lti1.3/oidc_login')).toEqual(configured);
			// LTI 1.1: the consumer named by the launch, any https origin when unknown.
			const known = lti11({ tool_url: 'http://lms.example/x', outcome_service_url: 'https://lms.example:444/o' });
			expect(ltiOrigins(known, '/lti/task')).toEqual([...configured, 'http://lms.example', 'https://lms.example:444']);
			expect(ltiOrigins(lti11({ tool_url: 'N/A' }), '/lti/task')).toEqual([...configured, 'https:']);
			expect(ltiOrigins(undefined, '/lti/lti_test/mcq1')).toEqual([...configured, 'https:']);
			services().config.raw = { lti_frame_ancestors: 'https://one.example' };
			expect(ltiOrigins(null, '/lti1.3/task')[0]).toBe('https://one.example');
		} finally {
			saveCourse('lti_test', course.content);
		}
	});

	it('LTI-07 database errors of the passback are logged, never thrown', async () => {
		const find = vi.spyOn(env.db.c.lisOutcomes, 'find').mockImplementation(() => {
			throw new Error('database down');
		});
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await drain();
			expect(log).toHaveBeenCalledWith('LTI grade passback: Error: database down');
		} finally {
			find.mockRestore();
			log.mockRestore();
		}
	});

	it('LTI-07 LTI-12 submissions without their LMS identifiers are not queued', async () => {
		const base = { username: ['alice'], courseid: 'lti_test', taskid: 'mcq1' };
		await enqueue({ submission: { ...base, lti_version: '1.3' } } as never);
		await enqueue({ submission: { ...base, lti_version: '1.1', outcome_service_url: 'http://x' } } as never);
		expect(await env.db.c.ltiGrades.countDocuments()).toBe(0);
		expect(await env.db.c.lisOutcomes.countDocuments()).toBe(0);
	});
});
