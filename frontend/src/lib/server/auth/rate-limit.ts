/**
 * Small in-memory fixed-window rate limiting:
 * throttles credential guessing (local sign-in, REST API, LDAP, WebDAV, simple_grader
 * key) and mail bombing through registration / lost password. State is per process,
 * which is enough for the single-process adapter-node deployment; counters vanish on restart.
 */
import { services } from '../app.js';

/** A rate limiter allowing `max` hits per key and per window of `windowMs` milliseconds. */
export class RateLimiter {
	/** Windows by key, least recently hit first (Map insertion order). */
	private readonly hits = new Map<string, { count: number; reset: number }>();

	/**
	 * @param max hits allowed per window; @param windowMs window length (ms);
	 * @param maxKeys memory bound: beyond it expired windows, then the least recently hit ones, are dropped.
	 */
	constructor(
		private readonly max: number,
		private readonly windowMs: number,
		private readonly maxKeys = 50_000
	) {}

	/** Current window of `key` (expired windows are forgotten). */
	private entry(key: string) {
		const entry = this.hits.get(key);
		return entry && entry.reset > Date.now() ? entry : (this.hits.delete(key), undefined);
	}

	/** True when `key` has already used all its hits for the current window. */
	blocked(key: string): boolean {
		return (this.entry(key)?.count ?? 0) >= this.max;
	}

	/** Counts one hit for `key`; returns false when the key is (now) over the limit. */
	hit(key: string): boolean {
		const entry = this.entry(key) ?? { count: 0, reset: Date.now() + this.windowMs };
		this.hits.delete(key);
		if (this.hits.size >= this.maxKeys) {
			// Bounded memory without resetting every counter (spraying keys only evicts the oldest ones).
			for (const [k, e] of this.hits) if (e.reset <= Date.now()) this.hits.delete(k);
			if (this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value as string);
		}
		this.hits.set(key, { ...entry, count: entry.count + 1 });
		return entry.count < this.max;
	}
}

/** Window of the authentication limits. */
const WINDOW = 15 * 60_000;
/** Failed authentications allowed per account (from any client) and per client (on any account). */
const perAccount = new RateLimiter(20, WINDOW);
const perClient = new RateLimiter(100, WINDOW);

/**
 * Throttle of every credential check. Accounts are namespaced by method
 * (`local:<username>`, `ldap:<id>:<login>`, `dav:<username>`); checks without an
 * account (shared keys) are only limited per client.
 */
export const authThrottle = {
	/** True when the client or the account has too many recent failures. */
	blocked: (client: string, account?: string) =>
		perClient.blocked(client) || (account !== undefined && perAccount.blocked(account)),
	/** Records a failed attempt. */
	failed(client: string, account?: string): void {
		perClient.hit(client);
		if (account !== undefined) perAccount.hit(account);
	}
};

/**
 * IP address of the client. `X-Forwarded-For` is only trusted when
 * `reverse-proxy-config.enable` is set: the address `x-for` (or `x_for`, default 1)
 * hops from the right, like the legacy werkzeug ProxyFix; otherwise the socket address
 * (or adapter-node's `ADDRESS_HEADER`, when the operator sets it).
 */
export function clientAddress(event: { request: Request; getClientAddress(): string }): string {
	const proxy = services().config.raw?.['reverse-proxy-config'] as Record<string, unknown> | undefined;
	if (proxy?.enable) {
		const hops = Number(proxy['x-for'] ?? proxy.x_for ?? 1);
		const chain = (event.request.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim());
		const ip = chain[chain.length - hops];
		if (ip) return ip;
	}
	return event.getClientAddress();
}
