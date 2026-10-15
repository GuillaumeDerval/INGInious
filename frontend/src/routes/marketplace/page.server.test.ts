/** Unit tests of /marketplace and /marketplace/<courseid> (NAV-18, NAV-19). */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { navEvent, outcome, setupNav, type NavEnv } from '../../../tests/fixtures/nav/setup.js';
import { mkdirSync } from 'node:fs';

vi.mock('node:child_process', () => ({
	execFile: (_c: string, args: string[], _o: unknown, cb: (e: null, r: unknown) => void) => {
		mkdirSync(args[args.length - 1], { recursive: true });
		cb(null, {});
	}
}));
import * as list from './+page.server.js';
import * as detail from './[courseid]/+page.server.js';

const DEMO = {
	id: 'demo',
	link: 'https://example.org/demo',
	languages: 'English',
	license: '',
	maintainers: 'M',
	authors: 'A',
	default_language: 'en',
	name: { en: 'Demo' },
	short_desc: { en: '<b>short</b>' },
	description: { en: '**desc** <script>x</script>' }
};
let env: NavEnv;
beforeAll(async () => {
	env = await setupNav({}, { marketplace_url: 'https://mock/market.json' });
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ json: async () => [DEMO, { ...DEMO, id: 'ssh', link: 'git@x:y' }] }))
	);
});
afterAll(() => env.cleanup());

describe('marketplace pages', () => {
	it('NAV-18 lists the courses for superadmins only', async () => {
		expect(await list.load(navEvent('superadmin'))).toEqual({
			courses: [
				{ id: 'demo', name: 'Demo', shortDesc: '<b>short</b>' },
				{ id: 'ssh', name: 'Demo', shortDesc: '<b>short</b>' }
			]
		});
		expect(await outcome(() => list.load(navEvent('nav_alice')))).toMatchObject({ status: 403 });
		expect(
			await outcome(() =>
				list.actions.default(navEvent('superadmin', { fields: { courseid: 'demo', new_courseid: 'bad id' } }))
			)
		).toMatchObject({ data: { message: 'Course with invalid name: bad id' } });
		expect(
			await outcome(() =>
				list.actions.default(navEvent('superadmin', { fields: { courseid: 'demo', new_courseid: 'navmk1' } }))
			)
		).toEqual({ status: 303, location: '/admin/navmk1' });
	});

	it('NAV-19 shows a sanitized description and the information table', async () => {
		const data = (await detail.load(navEvent('superadmin', { params: { courseid: 'demo' } }))) as {
			description: string;
		};
		expect(data).toMatchObject({
			id: 'demo',
			name: 'Demo',
			link: 'https://example.org/demo',
			info: [
				['Language(s)', 'English'],
				['Maintainer(s)', 'M'],
				['Author(s)', 'A']
			]
		});
		expect(data.description).toContain('<strong>desc</strong>');
		expect(data.description).not.toContain('<script');
		expect(
			((await detail.load(navEvent('superadmin', { params: { courseid: 'ssh' } }))) as { link: null }).link
		).toBeNull();
		expect(await outcome(() => detail.load(navEvent('superadmin', { params: { courseid: 'foo' } })))).toEqual({
			status: 404,
			message: 'Course unavailable.'
		});
		expect(await outcome(() => detail.load(navEvent('nav_alice', { params: { courseid: 'demo' } })))).toMatchObject({
			status: 403
		});
		expect(
			await outcome(() =>
				detail.actions.default(
					navEvent('superadmin', { params: { courseid: 'demo' }, fields: { new_courseid: 'nav_open' } })
				)
			)
		).toMatchObject({ data: { message: 'Course with id nav_open already exists.' } });
		expect(
			await outcome(() =>
				detail.actions.default(
					navEvent('superadmin', { params: { courseid: 'demo' }, fields: { new_courseid: 'navmk2' } })
				)
			)
		).toEqual({ status: 303, location: '/course/navmk2' });
	});
});
