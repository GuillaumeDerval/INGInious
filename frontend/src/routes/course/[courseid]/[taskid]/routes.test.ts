// The task routes only delegate to #lib/server/task/page.js (tested there).
import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/task/page.js', () => ({
	loadTaskPage: vi.fn(async (_e, c, t) => ({ page: [c, t] })),
	taskAction: vi.fn(async (_e, c, t) => Response.json([c, t])),
	serveTaskFile: vi.fn(async (_e, c, t, p) => new Response(`${c}/${t}/${p}`))
}));

const event = { params: { courseid: 'c', taskid: 't', path: 'a/b' } } as never;

describe('task routes', () => {
	it('TASK-01 delegates the page, the actions and the files', async () => {
		const page = await import('./+page.server.js');
		const actions = await import('./+server.js');
		const files = await import('./[...path]/+server.js');
		expect(await page.load(event)).toEqual({ page: ['c', 't'] });
		expect(await (await actions.POST(event)).json()).toEqual(['c', 't']);
		expect(await (await files.GET(event)).text()).toBe('c/t/a/b');
	});
});
