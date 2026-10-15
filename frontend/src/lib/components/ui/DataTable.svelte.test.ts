// Component tests of DataTable: sorting, empty state.
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import DataTable, { compareValues } from './DataTable.svelte';

interface Row {
	name: string;
	grade: number | null;
}
const row = createRawSnippet((r: () => Row, i: () => number) => ({
	render: () => `<tr><td>${r().name}</td><td>${r().grade ?? ''}</td><td>${i()}</td></tr>`
}));
const columns = [
	{ key: 'name', label: 'Name', value: (r: Row) => r.name },
	{ key: 'grade', label: 'Grade', value: (r: Row) => r.grade },
	{ key: 'index', label: 'Index' }
];
const rows: Row[] = [
	{ name: 'b10', grade: 5 },
	{ name: 'b2', grade: null },
	{ name: 'a', grade: 50 }
];
/** Names in display order. */
const names = () => Array.from(document.querySelectorAll('tbody tr td:first-child')).map((td) => td.textContent);

describe('compareValues', () => {
	it('orders numbers, strings naturally and empty values last', () => {
		expect(compareValues(1, 2)).toBeLessThan(0);
		expect(compareValues('b2', 'b10')).toBeLessThan(0);
		expect(compareValues(true, false)).toBeGreaterThan(0);
		expect(compareValues(null, 1)).toBe(1);
		expect(compareValues(1, '')).toBe(-1);
		expect(compareValues(undefined, null)).toBe(0);
	});
});

describe('DataTable', () => {
	it('sorts on sortable columns', async () => {
		render(DataTable<Row>, { columns, rows, row });
		expect(names()).toEqual(['b10', 'b2', 'a']);
		const name = page.getByRole('button', { name: 'Name' });
		await name.click();
		expect(names()).toEqual(['a', 'b2', 'b10']);
		await expect.element(page.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending');
		await name.click();
		expect(names()).toEqual(['b10', 'b2', 'a']);
		await expect.element(page.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'descending');
		await page.getByRole('button', { name: 'Grade' }).click();
		expect(names()).toEqual(['b10', 'a', 'b2']);
		await expect.element(page.getByRole('columnheader', { name: 'Index' })).not.toHaveAttribute('aria-sort');
	});

	it('shows the empty state', async () => {
		render(DataTable<Row>, { columns, rows: [], row });
		await expect.element(page.getByText('Nothing to show.')).toBeVisible();
		render(DataTable<Row>, { columns, rows: [], row, empty: 'No student' });
		await expect.element(page.getByText('No student')).toBeVisible();
	});
});
