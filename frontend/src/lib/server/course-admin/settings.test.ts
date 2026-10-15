/** Unit tests of the course settings conversion/validation (CADM-03/04/05, LTI-01). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { services } from '../app.js';
import { getCourse } from '../courses/course.js';
import { buildSettings, ltiClients, settingsForm, settingsValues } from './settings.js';
import { setup, type CoursesEnv } from './testing/helpers.js';

let env: CoursesEnv;
beforeAll(async () => {
	env = await setup();
	await env.db.c.users.insertOne({
		username: 'admin1',
		realname: 'Ada Admin',
		email: 'a@x',
		language: 'en',
		bindings: {}
	});
});
afterAll(() => env.cleanup());

const me = { username: 'admin1', superadmin: false } as never;
const keys = generateKeyPairSync('rsa', {
	modulusLength: 1024,
	publicKeyEncoding: { type: 'spki', format: 'pem' },
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const client = {
	default: true,
	client_id: 'cid',
	auth_login_url: 'a',
	auth_token_url: 'b',
	key_set_url: 'c',
	private_key: keys.privateKey,
	public_key: keys.publicKey,
	deployment_ids: ['d1']
};

/** Form values of the fixture course, with overrides. */
const values = async (over: Record<string, unknown> = {}) => ({ ...(await settingsValues(getCourse('fx'))), ...over });
/** Posted (parsed) settings of the fixture course, with overrides. */
const form = async (over: Record<string, unknown> = {}) => settingsForm.parse(await values(over));

describe('settingsValues', () => {
	it('converts course.yaml to form values', async () => {
		const v = await values();
		expect(v).toMatchObject({
			name: 'Fixture course',
			admins: [{ value: 'admin1', label: 'Ada Admin (admin1)' }],
			tutors: [{ value: 'tutor1', label: 'tutor1 (tutor1)' }],
			groups_student_choice: true,
			accessible: true,
			registration_password: 'pwd',
			registration_ac: '',
			registration_ac_accept: true,
			lti_keys: '',
			lti_config: '{}',
			tags: [
				{ id: 'skill', name: 'Skill', description: 'A skill', visible: true, type: '0' },
				{ id: 'orga', name: 'Week 1', description: '', visible: false, type: '0' }
			]
		});
	});
});

describe('settingsValues (LTI)', () => {
	it('shows LTI keys as key:secret lines', async () => {
		const course = {
			...getCourse('fx'),
			content: { name: 'x', lti_keys: { a: 'b', c: 'd' }, registration_ac_list: ['u1', 'u2'] }
		};
		expect(await settingsValues(course)).toMatchObject({
			lti_keys: 'a:b\nc:d',
			registration_ac_list: 'u1\nu2',
			tags: [],
			allow_unregister: true
		});
	});
});

describe('buildSettings', () => {
	it('writes every key with the legacy types and keeps unknown keys', async () => {
		const r = buildSettings(
			getCourse('fx'),
			await form({
				registration_password: '',
				registration_ac: 'username',
				registration_ac_list: 'a\n\n b ',
				accessible: '2025-01-01 10:00:00+00:00/',
				is_lti: true,
				lti_keys: 'k1:s1\nk2:s2',
				lti_config: JSON.stringify({ iss: [client] }),
				lti_secrets: { 'iss/cid/d1': 'abc123' },
				tags: [
					{ id: 'cat', name: 'Cat', description: '', visible: false, type: '2' },
					{ id: '', name: 'dropped' }
				]
			}),
			me
		);
		expect('content' in r && r.content).toMatchObject({
			custom_key: 'kept',
			name: 'Fixture course',
			admins: ['admin1'],
			registration_password: null,
			registration_ac: 'username',
			registration_ac_list: ['a', 'b'],
			accessible: '2025-01-01 10:00:00+00:00/',
			is_lti: true,
			lti_keys: { k1: 's1', k2: 's2' },
			lti_secrets: { 'iss/cid/d1': 'abc123' },
			tags: { cat: { name: 'Cat', description: '', visible: false, type: 2 } }
		});
	});
	it('reports every error and writes nothing', async () => {
		const r = buildSettings(
			getCourse('fx'),
			await form({
				name: ' ',
				admins: [],
				accessible: 'garbage',
				registration: 'x/y',
				registration_ac: 'foo',
				lti_keys: 'a-b:x\nnocolon\nk:s:x',
				lti_secrets: { a: 'bad-secret' },
				tags: [
					{ id: 'a', name: 'A' },
					{ id: 'a', name: 'B' },
					{ id: 'my tag', name: 'C' },
					{ id: 'b', name: '' }
				]
			}),
			me
		);
		expect(r).toEqual({
			errors: [
				'Invalid name',
				'You cannot remove yourself from the administrators of this course',
				'Invalid accessibility dates',
				'Invalid registration dates',
				'Invalid ACL value',
				'LTI keys must be alphanumerical.',
				'Each LTI key line must have the form key:secret.',
				'Each LTI key line must have the form key:secret.',
				'LTI deployment secrets must be alphanumerical.',
				'Some datas have the same id! The id must be unique.',
				'Invalid tag id: my tag',
				'Some tag fields were missing.'
			]
		});
	});
	it('lets superadmins remove themselves; malformed forms are refused by the schema', async () => {
		expect(
			'content' in
				buildSettings(getCourse('fx'), await form({ admins: [] }), { username: 'root', superadmin: true } as never)
		).toBe(true);
		expect(settingsForm.safeParse({ ...(await values()), name: 3 }).success).toBe(false);
	});
	it('validates the LTI 1.3 configuration with the legacy messages', async () => {
		const errors = async (cfg: string) =>
			(buildSettings(getCourse('fx'), await form({ lti_config: cfg }), me) as { errors: string[] }).errors;
		expect((await errors('{'))[0]).toMatch(/^LTI config couldn't parse as JSON - /);
		expect(await errors('[]')).toEqual(['LTI config is incorrect - Not a JSON object']);
		expect(await errors('{"X": {}}')).toEqual([
			'LTI config is incorrect - Issuer X must have a list of client_id configuration'
		]);
		const missing: Record<string, unknown> = { ...client };
		delete missing.key_set_url;
		expect(await errors(JSON.stringify({ X: [missing] }))).toEqual([
			'LTI config is incorrect - Missing key_set_url in client config 0 of issuer X'
		]);
		expect(await errors(JSON.stringify({ X: [{ ...client, private_key: 'x', public_key: 'y' }] }))).toEqual([
			'LTI config is incorrect - Error in private key of client config 0 of issuer X',
			'LTI config is incorrect - Error in public key of client config 0 of issuer X'
		]);
	});
	it('LTI-09 refuses a platform (iss, client_id) registered elsewhere with other keys', async () => {
		const errors = async (cfg: unknown) =>
			(buildSettings(getCourse('fx'), await form({ lti_config: JSON.stringify(cfg) }), me) as { errors?: string[] })
				.errors;
		const global = services().config.ltiConfig;
		services().config.ltiConfig = { X: [client] };
		try {
			expect(await errors({ X: [{ ...client, key_set_url: 'https://attacker/jwks' }] })).toEqual([
				'LTI config is incorrect - Client cid of issuer X is already registered in configuration.yaml'
			]);
			// Same platform keys (e.g. the same LMS used by two courses): accepted.
			expect(await errors({ X: [{ ...client, deployment_ids: ['d2'] }] })).toBeUndefined();
		} finally {
			services().config.ltiConfig = global;
		}
	});
});

describe('ltiClients', () => {
	it('lists clients without private keys, with the JWKS hash', () => {
		expect(ltiClients({ iss: [client], bad: 'x' }, 'course')).toEqual([
			{
				type: 'course',
				iss: 'iss',
				clientId: 'cid',
				deploymentIds: ['d1'],
				publicKey: keys.publicKey,
				keysetHash: createHash('md5').update('isscid').digest('hex')
			}
		]);
		expect(ltiClients({ i: [{ client_id: 'c' }] }, 'global')[0]).toMatchObject({ deploymentIds: [], publicKey: '' });
		expect(ltiClients(undefined, 'global')).toEqual([]);
	});
});
