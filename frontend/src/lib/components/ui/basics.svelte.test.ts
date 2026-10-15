// Component tests of the small display components: PageHeader, Card, Badge,
// ResultBadge, GradeBar, EmptyState, Alert, FormField, DateTime, MoreMenu, CopyField.
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import StarIcon from '@lucide/svelte/icons/star';
import PageHeader from './PageHeader.svelte';
import Card from './Card.svelte';
import Badge from './Badge.svelte';
import ResultBadge from './ResultBadge.svelte';
import GradeBar from './GradeBar.svelte';
import EmptyState from './EmptyState.svelte';
import Alert from './Alert.svelte';
import FormField, { type FieldAttrs } from './FormField.svelte';
import DateTime from './DateTime.svelte';
import MoreMenu from './MoreMenu.svelte';
import CopyField from './CopyField.svelte';
import { UI_PREFS_KEY } from './prefs.js';

/** Snippet rendering static HTML. */
const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }));

describe('PageHeader', () => {
	it('renders title, subtitle, breadcrumbs, actions and the document title', async () => {
		render(PageHeader, {
			title: 'Task 1',
			subtitle: 'An easy one',
			breadcrumbs: [{ label: 'Course', href: '/course/x' }, { label: 'Middle' }, { label: 'Task 1', href: '/ignored' }],
			actions: html('<button>Edit</button>')
		});
		await expect.element(page.getByRole('heading', { level: 1, name: 'Task 1' })).toBeVisible();
		await expect.element(page.getByText('An easy one')).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Course' })).toHaveAttribute('href', '/course/x');
		await expect.element(page.getByText('Middle')).not.toHaveAttribute('aria-current');
		await expect.element(page.getByRole('navigation').getByText('Task 1')).toHaveAttribute('aria-current', 'page');
		await expect.element(page.getByRole('button', { name: 'Edit' })).toBeVisible();
		expect(document.title).toBe('Task 1 | INGInious');
	});

	it('works without optional parts', async () => {
		render(PageHeader, { title: 'Alone' });
		await expect.element(page.getByRole('navigation')).not.toBeInTheDocument();
	});
});

describe('Card', () => {
	it('renders header parts and content', async () => {
		render(Card, {
			title: 'Settings',
			description: 'All of them',
			actions: html('<button>Act</button>'),
			class: 'x',
			children: html('<p>Body</p>')
		});
		await expect.element(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
		await expect.element(page.getByText('All of them')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Act' })).toBeVisible();
	});
	it('renders without header', async () => {
		render(Card, { children: html('<p>Only body</p>') });
		await expect.element(page.getByText('Only body')).toBeVisible();
		await expect.element(page.getByRole('heading')).not.toBeInTheDocument();
	});
	it('renders actions without title', async () => {
		render(Card, { actions: html('<button>Only action</button>'), children: html('<p>b</p>') });
		await expect.element(page.getByRole('button', { name: 'Only action' })).toBeVisible();
	});
});

describe('Badge / ResultBadge', () => {
	it('renders tones and icons', async () => {
		render(Badge, { tone: 'error', icon: StarIcon, children: html('<span>Bad</span>') });
		render(Badge, { children: html('<span>Plain</span>') });
		await expect.element(page.getByText('Bad')).toBeVisible();
		await expect.element(page.getByText('Plain')).toBeVisible();
	});
	it('maps every result code to a label', async () => {
		const labels: Record<string, string> = {
			success: 'Succeeded',
			failed: 'Failed',
			crash: 'Crash',
			timeout: 'Timeout',
			overflow: 'Overflow',
			killed: 'Killed',
			error: 'Internal error',
			waiting: 'Waiting',
			strange: 'strange'
		};
		for (const [result, label] of Object.entries(labels)) {
			render(ResultBadge, { result });
			await expect.element(page.getByText(label, { exact: true })).toBeVisible();
		}
		render(ResultBadge, { result: 'success', grade: 87.456 });
		await expect.element(page.getByText(/87.46%/)).toBeVisible();
	});
});

describe('GradeBar', () => {
	it('clamps and exposes the value', async () => {
		for (const [value, shown] of [
			[150, '100'],
			[72.256, '72.26'],
			[20, '20'],
			[-5, '0'],
			[Number.NaN, '0']
		] as const) {
			const { unmount } = render(GradeBar, { value });
			await expect.element(page.getByRole('progressbar', { name: 'Grade' })).toHaveAttribute('value', shown);
			await expect.element(page.getByText(`${shown}%`)).toBeVisible();
			unmount();
		}
		render(GradeBar, { value: 50, label: 'Progress', showValue: false });
		await expect.element(page.getByRole('progressbar', { name: 'Progress' })).toBeInTheDocument();
		await expect.element(page.getByText('50%')).not.toBeInTheDocument();
	});
});

describe('EmptyState', () => {
	it('renders title, description, icon and actions', async () => {
		render(EmptyState, {
			title: 'Nothing',
			description: 'Really nothing',
			icon: StarIcon,
			children: html('<button>Create</button>')
		});
		await expect.element(page.getByText('Nothing', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Really nothing')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Create' })).toBeVisible();
	});
	it('renders the minimal and compact variants', async () => {
		render(EmptyState, { title: 'Empty' });
		await expect.element(page.getByText('Empty')).toBeVisible();
		render(EmptyState, { title: 'Small', compact: true });
		await expect.element(page.getByText('Small')).toHaveClass(/text-sm/);
	});
});

describe('Alert', () => {
	it('uses alert role for errors and can be dismissed', async () => {
		render(Alert, {
			kind: 'error',
			title: 'Oops',
			dismissible: true,
			children: html('<span>Broken</span>')
		});
		await expect.element(page.getByRole('alert')).toHaveTextContent(/Oops\s*Broken/);
		await page.getByRole('button', { name: 'Close' }).click();
		await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
	});
	it('uses status role for information', async () => {
		render(Alert, { children: html('<span>Info</span>') });
		render(Alert, { kind: 'success', children: html('<span>Done</span>') });
		render(Alert, { kind: 'warning', children: html('<span>Careful</span>') });
		await expect.element(page.getByRole('status').first()).toHaveTextContent('Info');
		await expect.element(page.getByRole('alert')).toHaveTextContent('Careful');
	});
});

describe('FormField', () => {
	const control = createRawSnippet((attrs: () => FieldAttrs) => ({
		render: () => '<input class="input" />',
		setup: (input: Element) => {
			for (const [k, v] of Object.entries(attrs())) if (v !== undefined) input.setAttribute(k, v);
		}
	}));
	it('associates label, hint and error', async () => {
		render(FormField, {
			label: 'Email',
			hint: 'Your address',
			error: 'Invalid',
			required: true,
			id: 'mail',
			children: control
		});
		const input = page.getByLabelText('Email');
		await expect.element(input).toHaveAttribute('id', 'mail');
		await expect.element(input).toHaveAttribute('aria-invalid', 'true');
		await expect.element(input).toHaveAttribute('aria-describedby', 'mail-hint mail-error');
		await expect.element(page.getByText('Invalid')).toBeVisible();
	});
	it('works without hint nor error', async () => {
		render(FormField, { label: 'Name', children: control });
		await expect.element(page.getByLabelText('Name')).not.toHaveAttribute('aria-describedby');
	});
});

describe('DateTime', () => {
	it('formats with default preferences', async () => {
		render(DateTime, { value: '2026-01-02T10:00:00Z' });
		await expect
			.element(page.getByText('Jan 2, 2026, 10:00 AM'))
			.toHaveAttribute('datetime', '2026-01-02T10:00:00.000Z');
	});
	it('uses the locale and time zone of the context', async () => {
		const prefs = () => ({ locale: 'fr', timeZone: 'Europe/Brussels', indentation: '4' });
		render(DateTime, {
			props: { value: Date.UTC(2026, 0, 2, 10) },
			context: new Map([[UI_PREFS_KEY, prefs]])
		});
		await expect.element(page.getByText(/^2 janv\. 2026.*11:00$/)).toBeVisible();
		render(DateTime, {
			props: { value: new Date(Date.UTC(2026, 0, 2)), mode: 'date' },
			context: new Map([[UI_PREFS_KEY, prefs]])
		});
		await expect.element(page.getByText('2 janv. 2026', { exact: true })).toBeVisible();
	});
	it('falls back on invalid settings and values', async () => {
		const prefs = () => ({ locale: 'en', timeZone: 'Not/AZone', indentation: '4' });
		render(DateTime, {
			props: { value: '2026-01-02T10:00:00Z' },
			context: new Map([[UI_PREFS_KEY, prefs]])
		});
		await expect.element(page.getByText('Jan 2, 2026, 10:00 AM')).toBeVisible();
		render(DateTime, { value: 'garbage' });
		render(DateTime, { value: null, fallback: 'never' });
		render(DateTime, { value: '' });
		await expect.element(page.getByText('never')).toBeVisible();
		await expect.element(page.getByText('—').first()).toBeVisible();
	});
});

describe('MoreMenu', () => {
	it('opens and closes the menu', async () => {
		render(MoreMenu, {
			label: 'More',
			children: createRawSnippet(() => ({ render: () => '<a href="#x">Inside</a>' }))
		});
		await page.getByText('More').click();
		await expect.element(page.getByText('Inside')).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(page.getByText('Inside')).not.toBeVisible();
		await page.getByText('More').click();
		document.body.click();
		await expect.element(page.getByText('Inside')).not.toBeVisible();
	});
	it('takes a custom button style and no icon', async () => {
		render(MoreMenu, {
			label: 'Remove',
			icon: null,
			summaryClass: 'preset-tonal-error',
			class: 'w-64',
			children: createRawSnippet(() => ({ render: () => '<p>Body</p>' }))
		});
		const summary = page.getByText('Remove').element();
		expect(summary.className).toContain('preset-tonal-error');
		expect(summary.querySelector('svg')).toBeNull();
	});
	it('renders an icon-only trigger named by its label', async () => {
		render(MoreMenu, {
			label: 'More actions',
			iconOnly: true,
			children: createRawSnippet(() => ({ render: () => '<p>Body</p>' }))
		});
		const summary = page.getByLabelText('More actions');
		await expect.element(summary).toHaveAttribute('title', 'More actions');
		await expect.element(page.getByText('More actions')).not.toBeInTheDocument();
	});
});

describe('CopyField', () => {
	it('copies the value and masks secrets until revealed', async () => {
		const writes: string[] = [];
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: async (v: string) => void writes.push(v) },
			configurable: true
		});
		render(CopyField, { label: 'Password', value: 's3cret', secret: true });
		const input = page.getByLabelText('Password', { exact: true });
		await expect.element(input).toHaveAttribute('type', 'password');
		await expect.element(input).toHaveValue('s3cret');
		await page.getByRole('button', { name: 'Show' }).click();
		await expect.element(input).toHaveAttribute('type', 'text');
		await page.getByRole('button', { name: 'Hide' }).click();
		await expect.element(input).toHaveAttribute('type', 'password');
		await page.getByRole('button', { name: 'Copy Password' }).click();
		expect(writes).toEqual(['s3cret']);
		await input.click();
		render(CopyField, { label: 'URL', value: 'http://x' });
		await expect.element(page.getByLabelText('URL', { exact: true })).toHaveAttribute('type', 'text');
		expect(page.getByRole('button', { name: 'Show' }).elements()).toHaveLength(1);
	});
});
