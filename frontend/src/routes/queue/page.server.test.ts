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
	it('NAV-17 shows the snapshot with kill rights; job details only to the course staff', async () => {
		type Rows = { running: Record<string, unknown>[]; waiting: Record<string, unknown>[] };
		const student = load(navEvent('nav_alice')) as Rows;
		// Jobs of courses the user is not staff of keep their timing, without name or launcher.
		expect(student.running[0]).toEqual({
			id: 'job1',
			agent: 'agent-1',
			info: null,
			launcher: null,
			start: 1_000_000,
			end: 1_030_000,
			kill: false
		});
		expect(student.running[1]).toMatchObject({ info: null, launcher: null, end: null });
		expect(student.waiting.map((j) => j.max)).toEqual([null, 20]);
		const tutor = load(navEvent('nav_tutor')) as Rows;
		expect(tutor.running.map((j) => [j.info, j.launcher, j.kill])).toEqual([
			['nav_open/t1', 'core', false],
			[null, null, false]
		]);
		const admin = load(navEvent('nav_admin')) as Rows;
		expect(admin.running.map((j) => j.kill)).toEqual([true, false]);
		expect(admin.waiting.map((j) => j.info)).toEqual([null, 'nav_open/t2']);
		// Superadmins see every job, course-less ones included (their info is the environment).
		const root = load(navEvent('superadmin')) as Rows;
		expect(root.waiting.every((j) => j.kill)).toBe(true);
		expect(root.running[1]).toMatchObject({ info: 'default', launcher: 'core', end: null });
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
