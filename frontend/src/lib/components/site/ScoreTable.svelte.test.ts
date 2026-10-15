// Component tests of ScoreTable (SITE-13/14).
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ScoreTable from './ScoreTable.svelte';

describe('ScoreTable', () => {
	it('renders cells with their classes and emphasized columns', async () => {
		render(ScoreTable, {
			header: ['', 'Student(s)', 'Score'],
			rows: [[{ v: 1 }, { v: 'Alice' }, { v: 20, c: 'mine' }]],
			emphasis: [2]
		});
		await expect.element(page.getByRole('columnheader', { name: 'Score' })).toHaveClass(/font-semibold/);
		await expect.element(page.getByRole('cell', { name: '20' })).toHaveClass(/mine/);
		await expect.element(page.getByRole('cell', { name: 'Alice' })).not.toHaveClass(/font-semibold/);
	});
	it('has an empty state', async () => {
		render(ScoreTable, { header: ['A'], rows: [] });
		await expect.element(page.getByText('Nothing to show.')).toBeInTheDocument();
	});
});
