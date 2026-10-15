/** Unit tests of /queue (NAV-17). */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { navEvent, outcome, setupNav, type NavEnv } from '../../../tests/fixtures/nav/setup.js';
import { actions, load } from './+page.server.js';

const backend = {
	killJob: vi.fn(),
	queue: {
		running: [
			['job1', true, 'agent-1', 'nav_open/t1', 'core', 1000, 30],
			['job2', false, 'agent-2', 'default', 'core', 1000, -1]
		],
		waiting: [
			['job3', false, 'default', 'core', -1],
			['job4', false, 'nav_open/t2', 'core', 20]
		]
	} as unknown
};
let env: NavEnv;
beforeAll(async () => (env = await setupNav({ backend } as never)));
afterAll(() => env.cleanup());

describe('/queue', () => {
	it('NAV-17 shows the snapshot with kill rights', async () => {
		const student = load(navEvent('nav_alice')) as {
			running: Record<string, unknown>[];
			waiting: Record<string, unknown>[];
		};
		expect(student.running[0]).toEqual({
			id: 'job1',
			agent: 'agent-1',
			info: 'nav_open/t1',
			launcher: 'core',
			start: 1_000_000,
			end: 1_030_000,
			kill: false
		});
		// Course-less jobs carry their environment as info (backend contract).
		expect(student.running[1]).toMatchObject({ info: 'default', end: null });
		expect(student.waiting.map((j) => j.max)).toEqual([null, 20]);
		const admin = load(navEvent('nav_admin')) as typeof student;
		expect(admin.running.map((j) => j.kill)).toEqual([true, false]);
		expect((load(navEvent('superadmin')) as typeof student).waiting.every((j) => j.kill)).toBe(true);
		expect(await outcome(() => load(navEvent(null)))).toMatchObject({ status: 302 });
		backend.queue = null;
		expect(load(navEvent('nav_alice'))).toEqual({ running: [], waiting: [] });
	});

	it('NAV-17 kills jobs for authorised users only', async () => {
		backend.queue = { running: [['job1', true, 'a', 'nav_open/t1', 'core', 1, 1]], waiting: [] };
		const kill = (u: string, jobid: string) => outcome(() => actions.kill(navEvent(u, { fields: { jobid } })));
		expect(await kill('nav_alice', 'job1')).toMatchObject({ status: 403 });
		expect(await kill('superadmin', 'unknown')).toMatchObject({ status: 403 });
		expect(backend.killJob).not.toHaveBeenCalled();
		expect(await kill('nav_admin', 'job1')).toEqual({ message: 'Kill request sent.' });
		expect(backend.killJob).toHaveBeenCalledWith('job1');
	});
});
