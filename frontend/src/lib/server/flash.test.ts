/**
 * Unit tests of the flash messages (cookie round trip, tampering).
 */
import { describe, expect, it } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { setFlash, takeFlash } from './flash.js';

/** In-memory cookie jar recording the options of the last `set`. */
function fakeCookies(initial: Record<string, string> = {}) {
	const jar = new Map(Object.entries(initial));
	const options: Record<string, unknown> = {};
	const cookies = {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string, opts: unknown) => {
			jar.set(name, value);
			options[name] = opts;
		},
		delete: (name: string) => void jar.delete(name)
	} as unknown as Cookies;
	return { cookies, jar, options };
}

describe('flash', () => {
	it('stores a message in a short-lived httpOnly cookie and reads it once', () => {
		const { cookies, jar, options } = fakeCookies();
		setFlash(cookies, 'success', 'x'.repeat(2000));
		expect(options.inginious_flash).toMatchObject({
			httpOnly: true,
			path: '/',
			maxAge: 60,
			sameSite: 'lax'
		});
		const flash = takeFlash(cookies);
		expect(flash).toEqual({ kind: 'success', message: 'x'.repeat(1000) });
		expect(jar.has('inginious_flash')).toBe(false);
		expect(takeFlash(cookies)).toBeNull();
	});

	it('ignores malformed or tampered cookies (and deletes them)', () => {
		for (const raw of ['not json', '{"kind":"evil","message":"x"}', '{"kind":"info","message":3}', 'null']) {
			const { cookies, jar } = fakeCookies({ inginious_flash: raw });
			expect(takeFlash(cookies)).toBeNull();
			expect(jar.size).toBe(0);
		}
	});
});
