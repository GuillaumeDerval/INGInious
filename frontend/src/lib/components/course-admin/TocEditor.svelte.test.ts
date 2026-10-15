/**
 * Component tests of TocEditor that need the global stylesheet (Tailwind utilities): the
 * "Move up/down" buttons of the rows are revealed by CSS on hover or focus (CADM-07).
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TocEditor from './TocEditor.svelte';
import '../../../routes/layout.css';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

describe('TocEditor move buttons', () => {
	const props = {
		kind: 'toc',
		structure: { toc: [{ title: 'Part 1', tasks_list: ['t1', 't2'] }], config: {} },
		tasks: { t1: 'Task 1', t2: 'Task 2' },
		errors: {},
		courseid: 'c'
	};
	it('reveals the move buttons on hover or keyboard focus, keeping them reachable', async () => {
		render(TocEditor, props);
		const row = page.getByRole('listitem').filter({ hasText: 'Task 1' });
		const down = row.getByRole('button', { name: 'Move down' });
		const opacity = () => getComputedStyle(down.element()).opacity;
		// Hidden with a mouse until the row is hovered, but still in the accessibility tree and tab order.
		await expect.poll(opacity).toBe('0');
		expect((down.element() as HTMLButtonElement).tabIndex).toBe(0);
		await row.hover();
		await expect.poll(opacity).toBe('1');
		await page.getByPlaceholder('Task id').hover();
		await expect.poll(opacity).toBe('0');
		(row.getByRole('checkbox').element() as HTMLElement).focus();
		await expect.poll(opacity).toBe('1');
		// The first item cannot move up: its button keeps its place, invisible and disabled.
		const up = row.element().querySelector<HTMLButtonElement>('button[title="Move up"]')!;
		expect([up.disabled, getComputedStyle(up).visibility]).toEqual([true, 'hidden']);
		// Sections have the same buttons in their header.
		const header = page.getByRole('textbox', { name: 'Section title' }).first().element().closest('header')!;
		expect([...header.querySelectorAll('button[title^="Move"]')].map((b) => b.getAttribute('title'))).toEqual([
			'Move up',
			'Move down'
		]);
	});
});
