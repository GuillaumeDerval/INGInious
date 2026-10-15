/**
 * Unit tests of the root server load: only selected, non-sensitive data is exposed.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { setServices, type Services } from '#lib/server/app.js';
import { buildConfig } from '#lib/server/config.js';
import { setFlash } from '#lib/server/flash.js';
import { load } from './+layout.server.js';

afterAll(() => setServices(null));

/** Runs the load with a configuration and session. */
function run(raw: Record<string, unknown>, locals: Record<string, unknown>) {
	setServices({
		config: buildConfig({
			backend: 'tcp://x:1',
			session_parameters: { secret_key: 'secret' },
			...raw
		})
	} as unknown as Services);
	const jar = new Map<string, string>();
	const cookies = {
		get: (n: string) => jar.get(n),
		set: (n: string, v: string) => jar.set(n, v),
		delete: (n: string) => jar.delete(n)
	} as unknown as Cookies;
	setFlash(cookies, 'info', 'Hello');
	return load({ locals, cookies } as never) as Record<string, unknown>;
}

describe('root layout load', () => {
	it('exposes user, preferences, footer data and the flash message', () => {
		const user = { username: 'u', timezone: 'Europe/Brussels', codeIndentation: 'tabs' };
		const data = run(
			{
				privacy_page: 'privacy',
				terms_page: 'terms',
				allow_registration: false,
				sentry_io_url: 'https://k@sentry.example/1'
			},
			{ user, lang: 'fr', session: { doc: { is_lti: false } } }
		);
		expect(data).toMatchObject({
			user,
			lang: 'fr',
			isLti: false,
			timezone: 'Europe/Brussels',
			codeIndentation: 'tabs',
			allowRegistration: false,
			privacyHref: '/pages/privacy',
			flash: { kind: 'info', message: 'Hello' },
			sentryDsn: 'https://k@sentry.example/1'
		});
		expect(typeof data.version).toBe('string');
		expect(JSON.stringify(data)).not.toContain('secret');
	});

	it('uses the session preferences of anonymous visitors and hides the privacy link without terms', () => {
		const data = run(
			{ privacy_page: 'privacy' },
			{
				user: null,
				lang: 'en',
				session: { doc: { is_lti: true, timezone: 'Asia/Tokyo', code_indentation: '2' } }
			}
		);
		expect(data).toMatchObject({
			timezone: 'Asia/Tokyo',
			codeIndentation: '2',
			privacyHref: null,
			isLti: true
		});
		const bare = run({}, { user: null, lang: 'en', session: { doc: {} } });
		expect(bare).toMatchObject({ timezone: 'UTC', codeIndentation: '4', sentryDsn: null });
	});
});
