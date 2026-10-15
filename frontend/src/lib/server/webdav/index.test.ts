import { rmSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { siteEnv, event, type SiteEnv } from '../../../../tests/site/env.js';
import { services, setServices } from '../app.js';
import { handleDav } from './index.js';

let env: SiteEnv;
const KEY = 'k'.repeat(80);
const auth = (u: string, k = KEY) => ({ authorization: `Basic ${Buffer.from(`${u}:${k}`).toString('base64')}` });

beforeAll(async () => {
	env = await siteEnv();
	// The shared site fixture has no raw configuration document.
	setServices({ ...services(), config: { ...services().config, raw: services().config.raw ?? {} } });
	await env.db.c.users.insertMany(
		['admin1', 'tutor1', 'root', 'nokey'].map((username) => ({
			username,
			realname: username,
			email: `${username}@x.org`,
			language: 'en',
			bindings: {},
			...(username !== 'nokey' && { apikey: KEY })
		}))
	);
});
afterAll(() => env.cleanup());
beforeEach(() => {
	env.course(
		'dav',
		{ name: 'DAV', admins: ['admin1'], tutors: ['tutor1'] },
		{ t1: { name: 'T', environment_type: 'mcq', problems: { q: { type: 'match', answer: 'x' } } } }
	);
	env.course('dav2', { name: 'DAV2', admins: ['other'] });
	writeFileSync(join(env.dir, 'dav2', 'secret.txt'), 'secret');
});

/** Sends a DAV request as admin1 (or with `headers`). */
async function dav(method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}) {
	const res = await handleDav(
		event(`/dav/${path}`, { method, headers: { ...auth('admin1'), ...opts.headers }, body: opts.body }),
		path
	);
	return { status: res.status, text: await res.text(), headers: res.headers };
}

describe('SITE-22 authentication', () => {
	it('accepts course admins and superadmins with their API key only', async () => {
		expect((await dav('OPTIONS', 'dav/')).headers.get('dav')).toBe('1, 2');
		expect((await dav('GET', 'dav/', { headers: auth('root') })).status).toBe(200);
		for (const headers of [
			auth('admin1', 'wrong'),
			auth('tutor1'),
			auth('nokey', ''),
			auth('ghost'),
			{ authorization: 'Bearer x' },
			{ authorization: 'Basic ' }
		]) {
			const r = await dav('GET', 'dav/', { headers });
			expect(r.status).toBe(401);
			expect(r.headers.get('www-authenticate')).toBe('Basic realm="dav"');
		}
		expect((await dav('GET', 'dav2/secret.txt')).status).toBe(401);
		expect((await dav('GET', 'nope/x')).status).toBe(404);
		expect((await dav('GET', '../x')).status).toBe(404);
	});
	it('throttles wrong credentials per account', async () => {
		for (let i = 0; i < 20; i++) expect((await dav('GET', 'dav/', { headers: auth('root', 'bad') })).status).toBe(401);
		expect((await dav('GET', 'dav/', { headers: auth('root') })).status).toBe(401);
		expect((await dav('GET', 'dav/')).status).toBe(200);
	});
	it('refuses Basic credentials over plain http, except on localhost or when allowed', async () => {
		const status = async (url: string, headers: Record<string, string> = {}) =>
			(await handleDav(event(url, { headers: { ...auth('admin1'), ...headers } }), 'dav/')).status;
		const refused = await handleDav(event('http://inginious.example/dav/dav/', { headers: auth('admin1') }), 'dav/');
		expect([refused.status, await refused.text()]).toEqual([
			403,
			'WebDAV requires HTTPS: Basic credentials are not accepted over plain HTTP.'
		]);
		expect(await status('https://inginious.example/dav/dav/')).toBe(200);
		expect(await status('http://127.0.0.1/dav/dav/')).toBe(200);
		const config = services().config;
		// Behind a configured reverse proxy, the scheme seen by the client counts.
		const proxied = { ...config, raw: { ...config.raw, 'reverse-proxy-config': { enable: true } } };
		setServices({ ...services(), config: proxied });
		expect(await status('http://inginious.example/dav/dav/', { 'x-forwarded-proto': 'https' })).toBe(200);
		setServices({ ...services(), config: { ...config, webdavAllowHttp: true } });
		expect(await status('http://inginious.example/dav/dav/')).toBe(200);
		setServices({ ...services(), config });
	});
	it('normalises the path before choosing the course (no prefix traversal)', async () => {
		expect((await dav('GET', 'dav/../dav2/secret.txt')).status).toBe(401);
		symlinkSync(join(env.dir, 'dav2'), join(env.dir, 'dav', 'escape'));
		await expect(dav('GET', 'dav/escape/secret.txt')).rejects.toThrow('Unsafe path');
		rmSync(join(env.dir, 'dav', 'escape'));
	});
});

describe('SITE-23 read/write', () => {
	it('reads files, lists folders and answers PROPFIND', async () => {
		expect((await dav('GET', 'dav/t1/task.yaml')).text).toContain('name: T');
		expect((await dav('HEAD', 'dav/t1/task.yaml')).text).toBe('');
		expect((await dav('GET', 'dav')).text.split('\n').sort()).toEqual(['course.yaml', 't1']);
		expect((await dav('GET', 'dav/missing')).status).toBe(404);
		const deep = await dav('PROPFIND', 'dav/');
		expect(deep.status).toBe(207);
		expect(deep.text).toContain('<D:href>/dav/dav/t1/</D:href>');
		expect(deep.text).toContain('<D:getcontentlength>');
		expect((await dav('PROPFIND', 'dav/', { headers: { depth: '0' } })).text).not.toContain('t1');
		expect((await dav('PROPFIND', 'dav/none')).status).toBe(404);
	});
	it('writes files and validates descriptors', async () => {
		expect((await dav('PUT', 'dav/t1/run', { body: 'echo' })).status).toBe(201);
		expect((await dav('PUT', 'dav/t1/run', { body: 'echo 2' })).status).toBe(204);
		expect((await dav('PUT', 'dav/t1', { body: 'x' })).status).toBe(405);
		expect((await dav('PUT', 'dav/no/run', { body: 'x' })).status).toBe(409);
		expect((await dav('PUT', 'dav/t1/task.yaml', { body: 'name: [unclosed' })).status).toBe(400);
		expect((await dav('PUT', 'dav/course.yaml', { body: 'foo: bar' })).status).toBe(400);
		expect((await dav('PUT', 'dav/course.yaml', { body: 'name: Renamed\nadmins: [admin1]' })).status).toBe(204);
		expect(readFileSync(join(env.dir, 'dav', 'course.yaml'), 'utf8')).toContain('Renamed');
		expect((await dav('MKCOL', 'dav/t2')).status).toBe(201);
		expect((await dav('MKCOL', 'dav/t2')).status).toBe(405);
		expect((await dav('MKCOL', 'dav/x/y')).status).toBe(409);
	});
	it('deletes, copies and moves inside the course, never the descriptor', async () => {
		expect((await dav('DELETE', 'dav/course.yaml')).status).toBe(403);
		expect((await dav('DELETE', 'dav/')).status).toBe(403);
		expect((await dav('DELETE', 'dav/none')).status).toBe(404);
		const to = (dest: string, overwrite?: string) => ({
			headers: { destination: `http://localhost/dav/${dest}`, ...(overwrite && { overwrite }) }
		});
		expect((await dav('COPY', 'dav/t1', to('dav/t3'))).status).toBe(201);
		expect((await dav('COPY', 'dav/t1', to('dav/t3', 'F'))).status).toBe(412);
		expect((await dav('COPY', 'dav/t1', to('dav/t3'))).status).toBe(204);
		expect((await dav('MOVE', 'dav/t3', to('dav/t4'))).status).toBe(201);
		expect(existsSync(join(env.dir, 'dav', 't3'))).toBe(false);
		for (const [src, dest] of [
			['dav/course.yaml', 'dav/c.yaml'],
			['dav/t4', 'dav/course.yaml'],
			['dav/t4', 'dav2/t4'],
			['dav/t4', '../x']
		])
			expect((await dav('MOVE', src, to(dest))).status).toBe(403);
		expect((await dav('MOVE', 'dav/none', to('dav/x'))).status).toBe(404);
		expect((await dav('MOVE', 'dav/t4', { headers: { destination: 'http://[bad' } })).status).toBe(403);
		// Missing destination, and the source itself (would delete it).
		expect((await dav('COPY', 'dav/t4')).status).toBe(400);
		expect((await dav('MOVE', 'dav/t4', to('dav/t4'))).status).toBe(403);
		expect((await dav('DELETE', 'dav/t4')).status).toBe(204);
	});
	it('fakes locks and refuses other methods', async () => {
		const lock = await dav('LOCK', 'dav/t1/task.yaml');
		expect(lock.headers.get('lock-token')).toMatch(/^<opaquelocktoken:/);
		expect((await dav('UNLOCK', 'dav/t1/task.yaml')).status).toBe(204);
		expect((await dav('PROPPATCH', 'dav/t1/task.yaml')).status).toBe(405);
	});
});
