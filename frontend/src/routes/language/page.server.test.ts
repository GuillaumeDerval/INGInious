/**
 * Unit tests of the language switch action (AUTH-10): whitelist, session
 * persistence, safe redirect, no GET side effect.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { setServices, type Services } from '#lib/server/app.js';
import { actions, load } from './+page.server.js';

const markDirty = vi.fn();
setServices({ sessions: { markDirty } } as unknown as Services);
afterEach(() => markDirty.mockReset());

/** Runs the action with form fields; returns the redirect location and the session. */
async function post(fields: Record<string, string>, language = 'en') {
	const session = { doc: { language }, stored: true, dirty: false };
	const body = new URLSearchParams(fields);
	const request = new Request('http://localhost/language', { method: 'POST', body });
	try {
		await actions.default({ request, locals: { session } } as never);
	} catch (e) {
		if (isRedirect(e)) return { status: e.status, location: e.location, session };
		throw e;
	}
	throw new Error('no redirect');
}

describe('/language', () => {
	it('stores a whitelisted language and redirects back', async () => {
		const r = await post({ language: 'fr', redirect: '/courselist?page=2' });
		expect(r).toMatchObject({ status: 303, location: '/courselist?page=2' });
		expect(r.session.doc.language).toBe('fr');
		expect(markDirty).toHaveBeenCalledWith(r.session);
	});

	it('ignores unknown languages and unchanged ones', async () => {
		const unknown = await post({ language: 'xx', redirect: '/' });
		expect(unknown.session.doc.language).toBe('en');
		await post({ language: 'toString' });
		await post({ language: 'en' });
		await post({});
		expect(markDirty).not.toHaveBeenCalled();
	});

	it('never redirects outside the site', async () => {
		for (const target of ['//evil.com', 'https://evil.com', '/\\evil.com', '']) {
			expect((await post({ language: 'de', redirect: target })).location).toBe('/');
		}
		expect((await post({ language: 'de' })).location).toBe('/');
	});

	it('GET has no side effect and redirects home', () => {
		try {
			load({} as never);
			expect.unreachable();
		} catch (e) {
			expect(isRedirect(e) && e.location).toBe('/');
		}
	});
});
