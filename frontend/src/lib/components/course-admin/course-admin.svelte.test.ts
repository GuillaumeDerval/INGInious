/** Component tests of the course administration components (CADM-03..14). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { flushSync } from 'svelte';
import SpecForm from './SpecForm.svelte';
import SubproblemsEditor from './SubproblemsEditor.svelte';
import TocEditor from './TocEditor.svelte';
import TaskFiles from './TaskFiles.svelte';
import LtiClients from './LtiClients.svelte';
import SaveBar from './SaveBar.svelte';
import {
	courseSpec,
	envSpec,
	fieldError,
	getPath,
	problemError,
	PROBLEM_SPECS,
	sectionSpec,
	setPath,
	taskConfigSpec,
	type FieldSpec,
	type Values
} from './specs.js';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
const appPage = vi.hoisted(() => ({ status: 200, form: null as unknown }));
vi.mock('$app/state', () => ({ page: appPage }));

let submitted: { action: string; data: Record<string, FormDataEntryValue> } | null;
const capture = (e: Event) => {
	e.preventDefault();
	const form = e.target as HTMLFormElement;
	submitted = { action: form.getAttribute('action') ?? '', data: Object.fromEntries(new FormData(form)) };
};
beforeEach(() => {
	submitted = null;
	document.addEventListener('submit', capture);
});
afterEach(() => document.removeEventListener('submit', capture));

/** A reactive values object for SpecForm. */
function state(v: Values): Values {
	const s = $state(v);
	return s;
}

describe('specs', () => {
	it('reads and writes dotted paths', () => {
		const v: Values = { a: 1 };
		setPath(v, 'x.y.z', 2);
		expect(getPath(v, 'x.y.z')).toBe(2);
		setPath(v, 'x.y.z', undefined);
		expect(v).toEqual({ a: 1, x: { y: {} } });
		expect(getPath(v, 'q.r')).toBeUndefined();
	});
	it('computes the conditional fields', () => {
		const c = courseSpec('/u');
		const shown = (fields: FieldSpec[], v: Values) => fields.filter((f) => !f.when || f.when(v)).map((f) => f.key);
		expect(shown(c['Access & registration'], { is_lti: true })).toEqual([]);
		expect(shown(c['Access & registration'], { registration_ac: 'email' })).toContain('registration_ac_list');
		expect(shown(c['Access & registration'], { registration_ac: '' })).not.toContain('registration_ac_list');
		expect(shown(taskConfigSpec(false), {})).not.toContain('group_submission');
		expect(shown(taskConfigSpec(true), {})).toContain('group_submission');
		expect(shown(envSpec({}, ''), { environment_type: 'mcq' })).toEqual(['environment_type', 'environment_id']);
		expect(sectionSpec('combinatory_test')[0].key).toBe('amount');
		expect(shown(c.General, { is_lti: false })).toContain('groups_student_choice');
	});
	it('finds the field and the problem named by a save error', () => {
		const tr = (s: string, ...a: string[]) => a.reduce((m, x) => m.replace('{}', x), s);
		const int: FieldSpec = { key: 'n', label: 'N', kind: 'int', min: 0 };
		const req: FieldSpec = { key: 'r', label: 'R', kind: 'select', required: true };
		expect(fieldError(int, { n: -1 }, 'N: a number >= 0 is expected.', tr)).toMatch(/^N:/);
		expect(fieldError(int, { n: 1.5 }, 'N: bad', tr)).toBe('N: bad');
		expect(fieldError(int, { n: 2 }, 'N: bad', tr)).toBeNull();
		expect(fieldError(int, { n: -1 }, null, tr)).toBeNull();
		expect(fieldError(req, {}, 'R is required.', tr)).toBe('R is required.');
		expect(fieldError({ ...req, required: false }, {}, 'R is required.', tr)).toBeNull();
		const p = { id: 'q', type: 'code', offset: 0 };
		expect(problemError(p, 'Invalid problem: q', tr)).toBe(true);
		expect(problemError(p, 'Code line offset: a number >= 1 is expected.', tr)).toBe(true);
		expect(problemError({ ...p, type: 'nope' }, 'Other', tr)).toBe(false);
		expect(problemError(p, null, tr)).toBe(false);
	});
});

describe('SpecForm', () => {
	it('edits every kind of field in place', async () => {
		const values = state({
			name: 'n',
			opt: false,
			limit: 2,
			kind: 'b',
			exts: ['.c'],
			acc: true,
			text: 't',
			users: [{ value: 'u', label: 'U (u)' }],
			choices: [{ text: 'A' }]
		});
		const fields: FieldSpec[] = [
			{ key: 'name', label: 'Name', kind: 'text' },
			{ key: 'opt', label: 'Optional?', kind: 'bool' },
			{ key: 'limit', label: 'Limit', kind: 'int', min: 0 },
			{
				key: 'kind',
				label: 'Kind',
				kind: 'select',
				options: [
					['a', 'A'],
					['b', 'B']
				]
			},
			{ key: 'exts', label: 'Exts', kind: 'csv', placeholder: '.c,.h' },
			{ key: 'acc', label: 'Access', kind: 'access', parts: 3 },
			{ key: 'text', label: 'Text', kind: 'textarea' },
			{ key: 'code', label: 'Code', kind: 'code', lang: 'language' },
			{ key: 'users', label: 'Users', kind: 'users', url: '/search' },
			{ key: 'hidden', label: 'Hidden', kind: 'text', when: () => false },
			{
				key: 'choices',
				label: 'Choices',
				kind: 'list',
				item: 'Item',
				fields: [{ key: 'text', label: 'Content', kind: 'text' }]
			}
		];
		render(SpecForm, { fields, values });
		await page.getByLabelText('Name', { exact: true }).fill('new');
		await page.getByLabelText('Optional?').click();
		await page.getByLabelText('Limit').fill('5');
		await page.getByLabelText('Kind').selectOptions('a');
		await page.getByLabelText('Exts').fill('.py, ,.txt');
		await userEvent.tab();
		await page.getByLabelText('Text').fill('long');
		expect(page.getByLabelText('Hidden').query()).toBeNull();
		expect(values).toMatchObject({ name: 'new', opt: true, limit: 5, kind: 'a', exts: ['.py', '.txt'], text: 'long' });
		await page.getByLabelText('Limit').fill('');
		expect(values.limit).toBeNull();
		await page.getByLabelText('Access').selectOptions('custom');
		expect(values.acc).toBe('//');
		await page.getByLabelText('Soft deadline').fill('2026-01-01');
		await userEvent.tab();
		expect(values.acc).toBe('/2026-01-01/');
		await page.getByLabelText('Access').selectOptions('false');
		expect(values.acc).toBe(false);
		await page.getByRole('button', { name: 'Add' }).click();
		expect((values.choices as unknown[]).length).toBe(2);
		await page.getByRole('button', { name: 'Delete' }).first().click();
		expect(values.choices).toEqual([{}]);
		await expect.element(page.getByText('U (u)')).toBeVisible();
		await expect.element(page.getByText('Item 1')).toBeVisible();
	});
	it('shows the save error under the field it names', async () => {
		const values = state({ n: -1, tags: [] });
		render(SpecForm, {
			fields: [
				{ key: 'n', label: 'N', kind: 'int', min: 0, half: true },
				{ key: 'b', label: 'B', kind: 'bool', half: true }
			],
			values,
			error: 'N: a number >= 0 is expected.'
		});
		await expect.element(page.getByLabelText('N', { exact: true })).toHaveAttribute('aria-invalid', 'true');
		await expect.element(page.getByText('N: a number >= 0 is expected.')).toBeVisible();
		await page.getByLabelText('N', { exact: true }).fill('3');
		expect(page.getByText('N: a number >= 0 is expected.').query()).toBeNull();
	});
	it('titles a list alone in its card with a hidden legend and numbered items', async () => {
		render(SpecForm, {
			fields: [
				{ key: 'tags', label: 'Tags', kind: 'list', item: 'Tag', fields: [{ key: 'id', label: 'Id', kind: 'text' }] }
			],
			values: state({ tags: [{ id: 'a' }] })
		});
		await expect.element(page.getByRole('group', { name: 'Tags' })).toBeVisible();
		await expect.element(page.getByText('Tag 1')).toBeVisible();
	});
	it('renders the environment fields with the backend ids', async () => {
		const values = state({ environment_type: 'docker', environment_id: 'default' });
		render(SpecForm, { fields: envSpec({ docker: ['python3'] }, 'default'), values });
		await page.getByLabelText('Grading environment', { exact: true }).selectOptions('python3');
		expect(values.environment_id).toBe('python3');
		await page.getByLabelText('Timeout limit (in seconds)', { exact: true }).fill('3');
		expect(values).toMatchObject({ environment_parameters: { limits: { time: 3 } } });
	});
	it('renders empty values', async () => {
		render(SpecForm, {
			fields: [
				{ key: 'l', label: 'L', kind: 'list', item: 'Item', fields: [] },
				{ key: 'c', label: 'C', kind: 'csv', placeholder: 'Q' },
				{ key: 'x', label: 'X', kind: 'select', options: [] },
				{ key: 'c2', label: 'C2', kind: 'code' },
				{ key: 't', label: 'T', kind: 'text', placeholder: 'P' },
				{ key: 'u', label: 'U', kind: 'users', url: '/s' }
			],
			values: state({ u: [] })
		});
		await expect.element(page.getByLabelText('C', { exact: true })).toHaveValue('');
		await expect.element(page.getByPlaceholder('P')).toHaveValue('');
	});
});

describe('SaveBar', () => {
	it('shows unsaved changes and the last error', async () => {
		const values = state({ a: 1 });
		appPage.status = 400;
		appPage.form = { message: 'Bad value' };
		render(SaveBar, { values, version: 1 });
		await expect.element(page.getByRole('alert')).toHaveTextContent('Bad value');
		await expect.element(page.getByText('All changes saved')).toBeVisible();
		values.a = 2;
		await expect.element(page.getByText('Unsaved changes')).toBeVisible();
		appPage.status = 200;
	});
	it('leaves the error to the page when asked', async () => {
		appPage.status = 400;
		appPage.form = { message: 'Bad value' };
		render(SaveBar, { values: { a: 1 }, version: 1, showError: false });
		await expect.element(page.getByText('All changes saved')).toBeVisible();
		expect(page.getByRole('alert').query()).toBeNull();
		appPage.status = 200;
	});
	it('edits rich texts with the format switch', async () => {
		const values = state({ ctx: 'Hello' });
		render(SpecForm, { fields: [{ key: 'ctx', label: 'Context', kind: 'rich' }], values, previewUrl: '/p' });
		await page.getByRole('radio', { name: 'Markdown' }).click();
		await expect.poll(() => values.ctx).toBe('#MD\nHello');
	});
});

describe('SubproblemsEditor', () => {
	it('adds, validates, reorders and deletes problems', async () => {
		const problems = state({ list: [{ id: 'q1', type: 'code', name: '' }] }).list as { id: string; type: string }[];
		render(SubproblemsEditor, { problems });
		await expect.element(page.getByLabelText('Language', { exact: true })).toBeVisible();
		const id = page.getByLabelText('New problem id');
		await id.fill('bad id');
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Problem id should only contain');
		await expect.element(id).toHaveAttribute('aria-invalid', 'true');
		await id.fill('q1');
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('This problem id is already used.');
		await id.fill('q2');
		await page.getByLabelText('Problem type').selectOptions('multiple_choice');
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		expect(problems.map((p) => p.id)).toEqual(['q1', 'q2']);
		await page.getByRole('button', { name: 'Move up' }).nth(1).click();
		expect(problems.map((p) => p.id)).toEqual(['q2', 'q1']);
		await page.getByRole('button', { name: 'Move down' }).first().click();
		expect(problems.map((p) => p.id)).toEqual(['q1', 'q2']);
		await page.getByRole('button', { name: 'Delete' }).first().click();
		expect(problems.map((p) => p.id)).toEqual(['q2']);
		problems.push({ id: 'x', type: 'plugin_type' });
		flushSync();
		await expect.element(page.getByText('x', { exact: true }).first()).toBeVisible();
		expect(Object.keys(PROBLEM_SPECS)).toContain('match');
		// Drag & drop: the dragged card is moved to the drop target.
		const cards = () => [...document.querySelectorAll('details')];
		cards()[1]
			.querySelector('summary')!
			.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
		cards()[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
		cards()[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
		flushSync();
		expect(problems.map((p) => p.id)).toEqual(['x', 'q2']);
		cards()[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
		expect(problems.map((p) => p.id)).toEqual(['x', 'q2']);
	});
	it('explains an empty list and marks the problem of a save error', async () => {
		const problems = state({ list: [] }).list as { id: string; type: string }[];
		const { rerender } = render(SubproblemsEditor, { problems, error: 'Invalid problem: q1' });
		await expect.element(page.getByText('No problem yet')).toBeVisible();
		problems.push({ id: 'q1', type: 'code' });
		await rerender({ problems, error: 'Invalid problem: q1' });
		await expect.element(page.getByText('Error', { exact: true })).toBeVisible();
		await expect.element(page.getByLabelText('Language', { exact: true })).toBeVisible();
	});
});

describe('TocEditor', () => {
	const structure = () => ({
		toc: [
			{ title: 'Part 1', sections_list: [{ title: 'Basics', tasks_list: ['t1', 'ghost'] }] },
			{ title: 'Files', config: { closed: true }, tasks_list: ['t2', 'broken'] }
		],
		config: {
			t1: { weight: 2 },
			t2: { accessibility: true, group_submission: true, submission_limit: { amount: 3, period: -1 } }
		}
	});
	const props = {
		kind: 'toc',
		tasks: { t1: 'Task 1', t2: 'Task 2', t3: 'Task 3' },
		errors: { broken: 'bad yaml' },
		courseid: 'c'
	};
	const saved = async () => {
		await page.getByRole('button', { name: 'Save changes' }).click();
		return JSON.parse(String(submitted!.data.data));
	};

	it('renders the structure and saves it unchanged', async () => {
		render(TocEditor, { ...props, structure: structure() });
		await expect.element(page.getByText('No valid task with id: ghost')).toBeVisible();
		await expect.element(page.getByText('Error in task with id broken : bad yaml')).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Edit task' }).first())
			.toHaveAttribute('href', '/admin/c/edit/task/t1');
		const data = await saved();
		expect(submitted!.action).toBe('?/save');
		expect(data).toEqual({
			structure: {
				toc: [
					{
						title: 'Part 1',
						config: {},
						sections_list: [{ title: 'Basics', config: {}, tasks_list: ['t1', 'ghost'] }]
					},
					{ title: 'Files', config: { closed: true }, tasks_list: ['t2', 'broken'] }
				],
				config: structure().config
			},
			created: [],
			deleted: [],
			wiped: []
		});
		await expect.element(page.getByText('Limited submissions')).toBeVisible();
	});
	it('folds the task rows of large structures and edits old {taskid: rank} lists as lists', async () => {
		const ids = Array.from({ length: 201 }, (_, i) => `t${i}`);
		render(TocEditor, {
			...props,
			tasks: Object.fromEntries(ids.map((id) => [id, `Task ${id}`])),
			structure: { toc: [{ title: 'Big', tasks_list: Object.fromEntries(ids.map((id, i) => [id, i])) }], config: {} }
		});
		await expect.element(page.getByText('201')).toBeVisible();
		expect(page.getByRole('link', { name: 'Edit task' }).elements()).toHaveLength(0);
		await page.getByRole('button', { name: 'Show' }).click();
		expect(page.getByRole('link', { name: 'Edit task' }).elements()).toHaveLength(201);
		await page.getByRole('button', { name: 'Hide' }).click();
		expect(page.getByRole('link', { name: 'Edit task' }).elements()).toHaveLength(0);
		expect((await saved()).structure.toc[0].tasks_list).toEqual(ids);
	});
	it('adds sections and tasks, creates new tasks and removes tasks', async () => {
		render(TocEditor, { ...props, structure: structure() });
		await page.getByRole('button', { name: 'Add section' }).click();
		const input = page.getByLabelText('Task id').last();
		await input.fill('bad id');
		await page.getByRole('button', { name: 'Add task' }).last().click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Task id should only contain');
		await input.fill('t3');
		await page.getByRole('button', { name: 'Add task' }).last().click();
		await input.fill('new1');
		await userEvent.keyboard('{Enter}');
		await expect.element(page.getByText('New task with id: new1')).toBeVisible();
		// Remove t1 keeping files, delete t2 with its submissions, drop the new task.
		const remove = async (row: string, choice: string) => {
			const li = page.getByRole('listitem').filter({ hasText: row });
			await li.getByLabelText('Delete', { exact: true }).click();
			await li.getByRole('button', { name: choice, exact: true }).click();
		};
		await remove('Task 1', 'Keep files');
		await remove('Task 2', 'Delete task files and all submissions');
		await remove('new1', 'Delete task files');
		await expect.element(page.getByText('Pending changes')).toHaveTextContent('delete [t2]');
		const data = await saved();
		expect(data.structure.toc[2]).toEqual({ title: 'New section', config: {}, tasks_list: ['t3'] });
		expect(data).toMatchObject({ created: [], deleted: ['t2'], wiped: ['t2'] });
		expect(data.structure.config).toEqual({ t3: {} });
	});
	it('edits the settings of one or several tasks', async () => {
		render(TocEditor, { ...props, structure: structure() });
		await page.getByRole('button', { name: 'Task settings' }).first().click();
		const dialog = page.getByRole('dialog');
		await expect.element(dialog.getByLabelText('Grade weight (in comparison to other tasks)')).toHaveValue(2);
		await dialog.getByLabelText('Grade weight (in comparison to other tasks)').fill('3');
		await dialog.getByRole('button', { name: 'Apply' }).click();
		await page.getByRole('checkbox', { name: 'Select' }).nth(0).click();
		await page.getByRole('checkbox', { name: 'Select' }).nth(2).click();
		await page.getByRole('button', { name: 'Edit settings of the selected tasks' }).click();
		await dialog.getByLabelText('Evaluation submission').selectOptions('last');
		await dialog.getByRole('button', { name: 'Apply' }).click();
		await page.getByRole('button', { name: 'Task settings' }).nth(1).click();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		const data = await saved();
		expect(data.structure.config.t1).toMatchObject({
			weight: 3,
			evaluation_mode: 'last',
			submission_limit: { amount: -1, period: -1 },
			accessibility: false
		});
		expect(data.structure.config.t2).toMatchObject({ weight: 3, evaluation_mode: 'last' });
		await page.getByText('Delete selected tasks').click();
		await page.getByRole('button', { name: 'Keep files' }).last().click();
		expect((await saved()).structure.config).toEqual({});
	});
	it('reorders and nests sections', async () => {
		render(TocEditor, { ...props, structure: structure() });
		await page.getByRole('button', { name: 'Move down' }).first().click();
		let data = await saved();
		expect(data.structure.toc.map((s: { title: string }) => s.title)).toEqual(['Files', 'Part 1']);
		await page.getByRole('button', { name: 'Move up' }).nth(2).click(); // task broken above t2
		data = await saved();
		expect(data.structure.toc[0].tasks_list).toEqual(['broken', 't2']);
		await page.getByRole('button', { name: 'Add section' }).click();
		await page.getByRole('button', { name: 'Add subsection' }).last().click();
		await page.getByRole('button', { name: 'Add subsection' }).last().click();
		await page.getByLabelText('Section title').last().fill('Deep');
		data = await saved();
		expect(data.structure.toc[2].sections_list.map((s: { title: string }) => s.title)).toEqual(['New section', 'Deep']);
		await page.getByRole('button', { name: 'Delete section' }).first().click();
		data = await saved();
		expect(data.structure.toc.map((s: { title: string }) => s.title)).toEqual(['Part 1', 'New section']);
	});
	it('drags tasks and sections', async () => {
		render(TocEditor, { ...props, structure: structure() });
		const items = page.getByRole('listitem');
		await items
			.filter({ hasText: 'Task 2' })
			.element()
			.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
		items
			.filter({ hasText: 'Task 1' })
			.element()
			.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
		items
			.filter({ hasText: 'Task 1' })
			.element()
			.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
		flushSync();
		let data = await saved();
		expect(data.structure.toc[0].sections_list[0].tasks_list).toEqual(['t2', 't1', 'ghost']);
		// A task dropped on a section is ignored; a section cannot enter itself.
		const sections = document.querySelectorAll('section');
		items
			.filter({ hasText: 'Task 1' })
			.element()
			.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
		sections[2].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
		sections[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
		sections[1].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
		sections[2].dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
		sections[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
		flushSync();
		data = await saved();
		expect(data.structure.toc.map((s: { title: string }) => s.title)).toEqual(['Files', 'Part 1']);
		// Drop at the end of a task list.
		items
			.filter({ hasText: 'Task 1' })
			.element()
			.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
		document.querySelectorAll('ul')[1].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
		flushSync();
		data = await saved();
		expect(data.structure.toc[1].sections_list[0].tasks_list).toEqual(['t2', 'ghost', 't1']);
	});
	it('shows pool amounts for combinatory tests', async () => {
		render(TocEditor, {
			...props,
			kind: 'combinatory_test',
			structure: { toc: [{ title: 'Pool', config: { amount: 1 }, tasks_list: [] }], config: {} }
		});
		await expect.element(page.getByLabelText('Amount of tasks to be displayed')).toHaveValue(1);
		expect(page.getByRole('button', { name: 'Add subsection' }).query()).toBeNull();
	});
});

describe('TaskFiles', () => {
	const files = [
		{ path: '/run', name: 'run', dir: false, depth: 0 },
		{ path: '/d/', name: 'd', dir: true, depth: 0 },
		{ path: "/d/x');alert(1);('.txt", name: "x');alert(1);('.txt", dir: false, depth: 1 }
	];
	it('lists files with their actions (paths as data)', async () => {
		render(TaskFiles, { files, opened: null, base: '/admin/c/edit/task/t/files' });
		await expect
			.element(page.getByRole('link', { name: 'Download all files' }))
			.toHaveAttribute('href', '/admin/c/edit/task/t/files/download?path=%2F');
		await expect.element(page.getByRole('link', { name: 'run' })).toHaveAttribute('href', '?open=%2Frun');
		expect(page.getByRole('link', { name: 'Download', exact: true }).all()).toHaveLength(3);
		await expect.element(page.getByText("x');alert(1);('.txt/", { exact: false })).not.toBeInTheDocument();
		await expect.element(page.getByText('No file opened')).toBeVisible();
		await page.getByTitle('More actions').first().click();
		await page.getByRole('button', { name: 'Move' }).first().click();
		expect(submitted).toEqual({ action: '?/rename', data: { path: '/run', new_path: '/run' } });
		await page.getByTitle('Create a new file').click();
		await page.getByLabelText('Enter the path to the file').fill('/new/');
		await page.getByRole('button', { name: 'Create a new file' }).click();
		expect(submitted).toEqual({ action: '?/create', data: { path: '/new/' } });
		await page.getByTitle('Upload', { exact: true }).click();
		await page.getByLabelText('Upload a file').upload(new File(['a'], 'up.py'));
		await expect.element(page.getByLabelText('File path:')).toHaveValue('/up.py');
		await page.getByLabelText('Upload a file').upload([]);
		await expect.element(page.getByLabelText('File path:')).toHaveValue('');
		// Delete: the menu entry opens the confirmation dialog for that path.
		await page.getByTitle('More actions').first().click();
		await page.getByRole('button', { name: 'Delete' }).first().click();
		const dialog = page.getByRole('alertdialog');
		await expect.element(dialog).toHaveTextContent('/run');
		await dialog.getByRole('button', { name: 'Delete' }).click();
		expect(submitted).toEqual({ action: '?/delete', data: { path: '/run' } });
	});
	it('lists an empty folder', async () => {
		render(TaskFiles, { files: [], opened: null, base: '/b' });
		await expect.element(page.getByText('This task has no file besides task.yaml.')).toBeVisible();
	});
	it('edits the opened file, or explains why it cannot', async () => {
		const { rerender } = render(TaskFiles, { files, opened: { path: '/run', content: 'print(1)' }, base: '/b' });
		await page.getByRole('button', { name: 'Save changes' }).click();
		expect(submitted).toMatchObject({ action: '?/save', data: { path: '/run', content: 'print(1)' } });
		await expect.element(page.getByRole('link', { name: 'run' })).toHaveAttribute('aria-current', 'true');
		await rerender({ opened: { path: '/bin', content: null } });
		await expect.element(page.getByRole('alert')).toHaveTextContent("INGInious can't read this file.");
		await rerender({ opened: { path: '/x', content: null, error: 'Invalid path: /x' } });
		await expect.element(page.getByRole('alert')).toHaveTextContent('Invalid path: /x');
	});
});

describe('LtiClients', () => {
	it('shows the URLs and generates/removes deployment secrets', async () => {
		const secrets = state({ s: { 'iss/c2/d9': 'abc' } }).s as Record<string, string>;
		render(LtiClients, {
			clients: [
				{ type: 'global', iss: 'iss', clientId: 'c1', deploymentIds: ['d1'], publicKey: 'PUB', keysetHash: 'h1' },
				{ type: 'course', iss: 'iss', clientId: 'c2', deploymentIds: ['d9'], publicKey: '', keysetHash: 'h2' }
			],
			courseid: 'c',
			origin: 'https://x',
			secrets
		});
		await expect.element(page.getByText('https://x/lti1.3/jwks/c/h2')).toBeVisible();
		await expect.element(page.getByText('https://x/lti1.3/jwks/h1')).toBeVisible();
		await expect.element(page.getByText('courseid, taskid, secret')).toBeVisible();
		await expect.element(page.getByText('PUB', { exact: true })).not.toBeVisible();
		await page.getByText('Public key').click();
		await expect.element(page.getByText('PUB', { exact: true })).toBeVisible();
		const writes: string[] = [];
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: async (v: string) => void writes.push(v) },
			configurable: true
		});
		await page.getByRole('button', { name: 'Copy OIDC Login URL' }).first().click();
		expect(writes).toEqual(['https://x/lti1.3/oidc_login']);
		await page.getByRole('button', { name: 'Generate secret' }).click();
		expect(secrets['iss/c1/d1']).toMatch(/^[0-9a-f]{32}$/);
		await page.getByRole('button', { name: 'Delete' }).last().click();
		expect(secrets['iss/c2/d9']).toBeUndefined();
	});
	it('renders without clients', async () => {
		render(LtiClients, { clients: [], courseid: 'c', origin: '', secrets: {} });
		await expect.element(page.getByText('/lti/c/<taskid>')).toBeVisible();
		await expect.element(page.getByText('No LTI 1.3 client')).toBeVisible();
	});
});
