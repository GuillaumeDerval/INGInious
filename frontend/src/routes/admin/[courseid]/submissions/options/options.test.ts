/** Unit tests of the suggestions of the long choice lists of the submission query form (CSTU-11). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupCstu, type CstuEnv } from '../../../../../../tests/fixtures/cstu/setup.js';
import { navEvent, outcome } from '../../../../../../tests/fixtures/nav/setup.js';
import { GET } from './[list]/+server.js';

let env: CstuEnv;
beforeAll(async () => {
	env = await setupCstu();
	await env.db.c.courses.insertOne({ _id: 'cstu', students: ['cstu_bob', 'cstu_eve'] });
});
afterAll(() => env.cleanup());

const get = (username: string | null, list: string, q: string) =>
	outcome(async () => {
		const res = await GET(navEvent(username, { params: { courseid: 'cstu', list }, url: `http://localhost/x?q=${q}` }));
		return res.json();
	});

describe('/admin/<courseid>/submissions/options/<list>', () => {
	it('CSTU-11 answers the matching choices to the course staff only', async () => {
		expect(await get('cstu_tutor', 'users', 'bob')).toEqual([{ value: 'cstu_bob', label: 'Bob Cstu (cstu_bob)' }]);
		expect(await get('cstu_tutor', 'tasks', 'answer')).toEqual([{ value: 'answer', label: 'Answer task' }]);
		// Broken tasks are listed with their id.
		mkdirSync(join(env.dir, 'cstu', 'zz_broken'));
		writeFileSync(join(env.dir, 'cstu', 'zz_broken', 'task.yaml'), 'name: [broken');
		expect(await get('cstu_tutor', 'tasks', 'zz_')).toEqual([{ value: 'zz_broken', label: 'zz_broken' }]);
		rmSync(join(env.dir, 'cstu', 'zz_broken'), { recursive: true });
		expect(await get('cstu_tutor', 'nope', 'x')).toMatchObject({ status: 404 });
		expect(await get('cstu_bob', 'users', 'bob')).toMatchObject({ status: 403 });
		// Without `q`: the first choices.
		const all = await GET(
			navEvent('cstu_tutor', { params: { courseid: 'cstu', list: 'tasks' }, url: 'http://localhost/x' })
		);
		expect((await all.json()).length).toBeGreaterThan(0);
	});
});
