// Component tests of CodeEditor (CodeMirror 6) and of the language loader.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import CodeEditor from './CodeEditor.svelte';
import { loadLanguage } from './code-languages.js';
import { UI_PREFS_KEY } from './prefs.js';

/** Value of the hidden input of the editor. */
const hidden = (name: string) => document.querySelector<HTMLInputElement>(`input[name=${name}]`)!.value;

describe('loadLanguage', () => {
	it('loads every supported language and aliases', async () => {
		for (const name of [
			'python',
			'C',
			'cpp',
			'java',
			'js',
			'typescript',
			'sql',
			'yml',
			'md',
			'bash',
			'ocaml',
			'scala',
			'kotlin',
			'cs',
			'rust',
			'haskell',
			'matlab',
			'oz',
			'go',
			'racket',
			'tex',
			'html'
		]) {
			expect(await loadLanguage(name), name).toBeTruthy();
		}
	});
	it('returns null for plain text', async () => {
		expect(await loadLanguage('rst')).toBeNull();
		expect(await loadLanguage(undefined)).toBeNull();
	});
});

describe('CodeEditor', () => {
	it('edits code with the user indentation and submits it', async () => {
		render(CodeEditor, {
			props: { label: 'Answer', language: 'python', name: 'code', value: 'x = 1' },
			context: new Map([[UI_PREFS_KEY, () => ({ locale: 'en', timeZone: 'UTC', indentation: '2' })]])
		});
		const editor = page.getByRole('textbox', { name: 'Answer' });
		await expect.element(editor).toBeVisible();
		await editor.click();
		await userEvent.keyboard('{Control>}{End}{/Control}{Enter}if x:{Enter}y');
		await expect.poll(() => hidden('code')).toBe('x = 1\nif x:\n  y');
		await expect.element(page.getByText('x = 1').first()).toBeVisible();
	});

	it('is read-only and follows external value/option changes', async () => {
		const screen = render(CodeEditor, {
			props: { label: 'Code', readonly: true, value: 'int main;', language: 'c', name: 'ro' },
			context: new Map([[UI_PREFS_KEY, () => ({ locale: 'en', timeZone: 'UTC', indentation: 'tabs' })]])
		});
		const editor = page.getByRole('textbox', { name: 'Code' });
		await expect.element(editor).toHaveAttribute('aria-readonly', 'true');
		await expect.element(editor).toHaveAttribute('contenteditable', 'false');
		await screen.rerender({ value: 'changed', language: 'java', readonly: false });
		await expect.element(editor).toHaveTextContent('changed');
		await editor.click();
		await userEvent.keyboard('{Control>}{End}{/Control}{Tab}z');
		await expect.poll(() => hidden('ro')).toBe('\tchangedz');
	});

	it('renders without hidden input when no name is given, in dark mode', async () => {
		vi.spyOn(window, 'matchMedia').mockReturnValueOnce({ matches: true } as MediaQueryList);
		render(CodeEditor, { label: 'Nameless' });
		await expect
			.element(page.getByRole('textbox', { name: 'Nameless' }).element().closest<HTMLElement>('.cm-editor'))
			.toHaveClass(/ͼ/);
		await expect.element(page.getByRole('textbox', { name: 'Nameless' })).toBeVisible();
		expect(document.querySelector('input[type=hidden]')).toBeNull();
	});
});
