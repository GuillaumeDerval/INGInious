/**
 * HTTP requests sent by the LTI services to the platforms (LTI-07/09/12): LIS outcomes
 * (`lis_outcome_service_url` of the launch), platform key sets (`key_set_url`), OAuth2
 * tokens (`auth_token_url`) and AGS scores (`lineitem` of the launch).
 *
 * These URLs come from launches and course configurations, so the server only sends
 * them to public https endpoints: the scheme must be https and every address the host
 * resolves to must be public (no loopback, private, link-local, CGNAT, multicast or
 * reserved range). The check runs inside the connection's DNS lookup, so the address
 * actually used is the checked one. Redirects are not followed and every request has
 * a timeout.
 *
 * Configuration `lti_allow_private_urls: true` accepts http URLs and private addresses
 * (development, local test platforms).
 */
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { services } from '../app.js';

/** Default timeout of a request (ms). */
export const TIMEOUT = 10_000;

/** Non-public address ranges (IPv4-mapped IPv6 addresses are matched by the IPv4 rules). */
const RESERVED = new BlockList();
for (const [net, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 3]
] as const)
	RESERVED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
	['::', 127],
	['100::', 64],
	['2001:db8::', 32],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8]
] as const)
	RESERVED.addSubnet(net, prefix, 'ipv6');

/** True when `address` (IPv4 or IPv6) is not a public unicast address. */
export function isReservedAddress(address: string): boolean {
	return RESERVED.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

/** True when the configuration lets the LTI services reach http and private endpoints. */
const allowPrivate = () => services().config.raw.lti_allow_private_urls === true;

/**
 * `lookup` of the outgoing connections: resolves every address of the host and fails
 * when one of them is reserved (one public address is not enough: the connection
 * could use another one).
 */
export function safeLookup(
	hostname: string,
	options: LookupOptions,
	callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void
): void {
	dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
		if (err) return callback(err, []);
		const reserved = addresses.find((a) => isReservedAddress(a.address));
		if (reserved) return callback(new Error(`${hostname} resolves to the non-public address ${reserved.address}`), []);
		if (options.all) callback(null, addresses);
		else callback(null, addresses[0].address, addresses[0].family);
	});
}

/** Options of `ltiFetch` (the subset of `fetch` used by the LTI services and jose). */
export interface LtiRequestInit {
	method?: string;
	headers?: HeadersInit;
	body?: string | URLSearchParams;
	/** Defaults to a `TIMEOUT` ms timeout. */
	signal?: AbortSignal;
}

/**
 * `fetch` replacement of the LTI services: same answer type (`Response`), but only
 * public https URLs (see the file header), no redirect followed, and a timeout.
 * @throws when the URL is refused, the connection fails or the timeout expires.
 */
export function ltiFetch(input: string | URL, init: LtiRequestInit = {}): Promise<Response> {
	const url = new URL(input);
	const open = allowPrivate();
	if (url.protocol !== 'https:' && !(open && url.protocol === 'http:'))
		return Promise.reject(new Error(`LTI requests need an https URL: ${url.origin}`));
	// Literal IP addresses are connected to without any lookup: checked here.
	const literal = url.hostname.replace(/^\[(.*)\]$/, '$1');
	if (!open && isIP(literal) && isReservedAddress(literal))
		return Promise.reject(new Error(`LTI requests cannot reach the non-public address ${literal}`));
	const body = init.body === undefined ? undefined : String(init.body);
	const headers = Object.fromEntries(new Headers(init.headers));
	if (init.body instanceof URLSearchParams) headers['content-type'] ??= 'application/x-www-form-urlencoded';
	return new Promise((resolve, reject) => {
		const request = (url.protocol === 'https:' ? https : http).request(
			url,
			{
				method: init.method ?? 'GET',
				headers,
				signal: init.signal ?? AbortSignal.timeout(TIMEOUT),
				...(!open && { lookup: safeLookup })
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c: Buffer) => chunks.push(c));
				res.on('error', reject);
				res.on('end', () => {
					const status = res.statusCode!;
					// Statuses without body cannot be given one in a Response.
					const content = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
					const out = new Headers(Object.entries(res.headers).map(([k, v]) => [k, String(v)] as [string, string]));
					resolve(new Response(content, { status, headers: out }));
				});
			}
		);
		request.on('error', reject);
		request.end(body);
	});
}
