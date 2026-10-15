/** Unit tests of /administrator/users (SITE-01..05): guards and form actions. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { siteEnv, event, user, type SiteEnv } from '../../../../tests/site/env.js';
import { actions, load } from './+page.server.js';

let env: SiteEnv;
beforeAll(async () => {
	env = await siteEnv();
	await env.db.c.users.insertMany([
		{ username: 'root', realname: 'Root', email: 'root@x.org', language: 'en', bindings: {} },
		{ username: 'pend', realname: 'P', email: 'p@x.org', language: 'en', bindings: { gh: ['1', {}] }, activate: 'h' }
	]);
});
afterAll(() => env.cleanup());

/** A POST of the superadmin `root` (or of `as`) with form fields. */
const post = (fields: Record<string, string>, as = user('root', true)) =>
	event('/administrator/users', { method: 'POST', user: as, body: new URLSearchParams(fields) }) as never;
/** Status and message of an action result. */
const outcome = async (fn: () => unknown) => {
	try {
		const r = await fn();
		return isActionFailure(r)
			? [r.status, (r.data as unknown as { message: string }).message]
			: [200, (r as unknown as { message: string }).message];
	} catch (e) {
		return [isHttpError(e) ? e.status : -1, ''];
	}
};

describe('/administrator/users', () => {
	it('SITE-01 lists the users for superadmins only', async () => {
		const page = (u = user('root', true)) => event('/administrator/users?q=pe&page=1', { user: u }) as never;
		expect(await load(page())).toMatchObject({ q: 'pe', me: 'root', page: 1, rows: [{ username: 'pend' }] });
		expect(await outcome(() => load(page(user('alice'))))).toEqual([403, '']);
	});

	it('SITE-02..05 creates, activates, revokes and deletes accounts', async () => {
		const add = { username: 'newbie', realname: 'New', email: 'n@x.org', password: 'secret1' };
		expect(await outcome(() => actions.add(post(add)))).toEqual([200, 'User created.']);
		expect(await outcome(() => actions.add(post({ ...add, realname: '' })))).toEqual([400, 'Name is too short.']);
		expect(await outcome(() => actions.add(post({ username: 'x' })))).toEqual([400, '']);
		expect(await outcome(() => actions.activate(post({ username: 'pend' })))).toEqual([200, 'User activated.']);
		expect(await outcome(() => actions.activate(post({ username: 'pend' })))).toEqual([404, 'User not found']);
		expect(await outcome(() => actions.revoke(post({ username: 'pend', binding_id: 'gh' })))).toEqual([
			400,
			'You must set a password before removing all bindings.'
		]);
		expect(await outcome(() => actions.revoke(post({ username: 'ghost', binding_id: 'gh' })))).toEqual([
			400,
			'Incorrect authentication binding.'
		]);
		expect(await outcome(() => actions.delete(post({ username: 'newbie' })))).toEqual([200, 'User deleted.']);
		expect(await outcome(() => actions.delete(post({ username: 'newbie' })))).toEqual([
			404,
			'Impossible to delete this user'
		]);
		expect(await outcome(() => actions.delete(post({ username: 'pend' }, user('alice'))))).toEqual([403, '']);
	});

	it('SITE-03 refuses the deletion of the own account server side', async () => {
		expect(await outcome(() => actions.delete(post({ username: 'root' })))).toEqual([
			403,
			'You cannot delete your own account here.'
		]);
		expect(await env.db.c.users.findOne({ username: 'root' })).not.toBeNull();
	});
});
