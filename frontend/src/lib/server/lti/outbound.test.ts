/** Unit tests of the outbound requests of the LTI services (LTI-07/09/12): allowed targets, answers, timeouts. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setServices, type Services } from '../app.js';
import { isReservedAddress, ltiFetch, safeLookup } from './outbound.js';

const raw: Record<string, unknown> = {};
let server: Server;
let base: string;
/** Last request received by the local server. */
let last: { method?: string; type?: string; body: string } = { body: '' };

beforeAll(async () => {
	setServices({ config: { raw } } as unknown as Services);
	server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			last = { method: req.method, type: req.headers['content-type'], body };
			if (req.url === '/empty') return res.writeHead(204).end();
			if (req.url === '/hang') return;
			res.writeHead(200, { 'Content-Type': 'application/json', 'X-Test': 'yes' }).end('{"ok":true}');
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise((r) => server.close(r));
	setServices(null);
});
beforeEach(() => delete raw.lti_allow_private_urls);

/** Calls `safeLookup` as a promise: the address(es) or the error message. */
const resolve = (host: string, all = false) =>
	new Promise((r) => safeLookup(host, { all }, (err, address, family) => r(err ? err.message : [address, family])));

describe('LTI outbound requests', () => {
	it('LTI-07 classifies non-public addresses', () => {
		for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0'])
			expect(isReservedAddress(a), a).toBe(true);
		for (const a of ['224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1'])
			expect(isReservedAddress(a), a).toBe(true);
		for (const a of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '::ffff:1.1.1.1'])
			expect(isReservedAddress(a), a).toBe(false);
	});

	it('LTI-07 resolves hosts and refuses those with a non-public address', async () => {
		expect(await resolve('1.1.1.1')).toEqual(['1.1.1.1', 4]);
		expect(await resolve('1.1.1.1', true)).toEqual([[{ address: '1.1.1.1', family: 4 }], undefined]);
		expect(await resolve('localhost')).toMatch(/^localhost resolves to the non-public address/);
		expect(await resolve('host.invalid')).toMatch(/ENOTFOUND|EAI_AGAIN/);
	});

	it('LTI-07 LTI-09 LTI-12 only reaches public https endpoints by default', async () => {
		await expect(ltiFetch(`${base}/x`)).rejects.toThrow('LTI requests need an https URL');
		await expect(ltiFetch('ftp://example.org/x')).rejects.toThrow('LTI requests need an https URL');
		await expect(ltiFetch('https://127.0.0.1/x')).rejects.toThrow('non-public address 127.0.0.1');
		await expect(ltiFetch('https://[::1]:8443/x')).rejects.toThrow('non-public address ::1');
		// Host names are checked when the connection resolves them.
		await expect(ltiFetch('https://localhost:1/x')).rejects.toThrow('non-public address');
		expect(last.body).toBe('');
	});

	it('LTI-07 LTI-12 sends requests and returns the answers when private targets are allowed', async () => {
		raw.lti_allow_private_urls = true;
		const res = await ltiFetch(`${base}/json`, { method: 'POST', body: new URLSearchParams({ a: '1' }) });
		expect([res.status, res.ok, res.headers.get('x-test'), await res.json()]).toEqual([200, true, 'yes', { ok: true }]);
		expect(last).toEqual({ method: 'POST', type: 'application/x-www-form-urlencoded', body: 'a=1' });
		await ltiFetch(new URL(`${base}/plain`), { method: 'PUT', headers: { 'Content-Type': 'text/xml' }, body: '<x/>' });
		expect(last).toEqual({ method: 'PUT', type: 'text/xml', body: '<x/>' });
		const empty = await ltiFetch(`${base}/empty`);
		expect([empty.status, await empty.text(), last.method]).toEqual([204, '', 'GET']);
		await expect(ltiFetch(`${base}/hang`, { signal: AbortSignal.timeout(50) })).rejects.toThrow();
		// https to a closed port: the connection error is reported.
		await expect(ltiFetch(`https://127.0.0.1:1/x`)).rejects.toThrow(/ECONNREFUSED/);
	});
});
