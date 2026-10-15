// The task page composes TaskView with the loaded data.
import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';

it('TASK-01 renders the task view', async () => {
	const info = {
		author: '',
		contactUrl: null,
		deadline: null,
		neverAccessible: false,
		pastSoftDeadline: false,
		status: null,
		grade: 0,
		tried: 0,
		limit: { amount: -1, period: -1 },
		categories: []
	};
	const data = {
		courseId: 'c',
		courseName: 'C',
		taskId: 't',
		name: 'Task T',
		context: '',
		problems: [],
		random: [],
		username: null,
		registered: false,
		staff: false,
		admin: false,
		blocked: 'x',
		registerUrl: null,
		info,
		evaluationMode: 'best',
		tags: [],
		submissions: [],
		evaluated: null,
		waiting: null,
		group: null,
		prev: null,
		next: null,
		courseHidden: false,
		taskHidden: false,
		menu: [],
		webterm: null
	};
	render(Page, { data } as never);
	await expect.element(page.getByRole('heading', { name: 'Task T' })).toBeVisible();
});
