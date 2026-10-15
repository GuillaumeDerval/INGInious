<!--
@component
Code editor (CodeMirror 6) used for code problems, task file edition and
read-only code display. The language support is loaded lazily by name
(`python`, `c`, `cpp`, `java`, `ocaml`, `sh`, `yaml`, `markdown`, ...), the
indentation follows the user preference ("2", "3", "4" or "tabs"), and a
hidden input named `name` carries the value in regular form submissions.

Props:
- `value` (string, bindable): content.
- `label` (string): accessible name of the editor.
- `language` (string, optional): language name; plain text when unknown.
- `readonly` (boolean): read-only display.
- `name` (string, optional): name of the hidden form input.
- `minLines` (number, default 4): minimal height.
- `wrap` (boolean): wrap long lines (prose such as course descriptions; code keeps its lines).

@example <CodeEditor bind:value={code} language="python" label={t('Your answer')} name="q1" />
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorView, keymap } from '@codemirror/view';
	import { Compartment, EditorState, type Extension } from '@codemirror/state';
	import { indentUnit } from '@codemirror/language';
	import { indentWithTab } from '@codemirror/commands';
	import { basicSetup } from 'codemirror';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { loadLanguage } from './code-languages.js';
	import { uiPrefs } from './prefs.js';

	/** Props of CodeEditor. */
	export interface Props {
		/** Content (bindable). */
		value?: string;
		/** Accessible name. */
		label: string;
		/** Language name. */
		language?: string;
		/** Read-only display. */
		readonly?: boolean;
		/** Name of the hidden input submitted with the form. */
		name?: string;
		/** Minimal number of visible lines. */
		minLines?: number;
		/** Wrap long lines (prose). */
		wrap?: boolean;
	}

	let { value = $bindable(''), label, language, readonly = false, name, minLines = 4, wrap = false }: Props = $props();

	const prefs = uiPrefs();
	let host: HTMLDivElement;
	let view = $state<EditorView | null>(null);
	const languageConf = new Compartment();
	const optionsConf = new Compartment();

	/** Options that can change while the editor lives (the indentation is "2", "3", "4" or "tabs"). */
	function options(): Extension {
		const indent = prefs().indentation;
		const size = indent === 'tabs' ? 4 : Number(indent);
		return [
			indentUnit.of(indent === 'tabs' ? '\t' : ' '.repeat(size)),
			EditorState.tabSize.of(size),
			EditorState.readOnly.of(readonly),
			EditorView.editable.of(!readonly),
			EditorView.contentAttributes.of({ 'aria-label': label, 'aria-readonly': String(readonly) })
		];
	}

	onMount(() => {
		const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					basicSetup,
					keymap.of([indentWithTab]),
					dark ? oneDark : [],
					wrap ? EditorView.lineWrapping : [],
					EditorView.theme({
						'&': { fontSize: '0.875rem', backgroundColor: 'transparent' },
						'.cm-content, .cm-gutter': { minHeight: `${minLines * 1.4 + 0.5}em` },
						'.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
						'&.cm-focused': { outline: 'none' }
					}),
					languageConf.of([]),
					optionsConf.of(options()),
					EditorView.updateListener.of((u) => {
						if (u.docChanged) value = u.state.doc.toString();
					})
				]
			})
		});
		return () => view?.destroy();
	});

	// Reload the language support when the language changes.
	$effect(() => {
		// `view` is set by onMount, which runs before this effect.
		void loadLanguage(language).then((ext) => view!.dispatch({ effects: languageConf.reconfigure(ext ?? []) }));
	});

	// Apply option changes (read-only, label).
	$effect(() => {
		view?.dispatch({ effects: optionsConf.reconfigure(options()) });
	});

	// Apply external changes of `value`.
	$effect(() => {
		const current = view?.state.doc.toString();
		if (view && current !== value) view.dispatch({ changes: { from: 0, to: current!.length, insert: value } });
	});
</script>

<div
	bind:this={host}
	class="overflow-hidden rounded-base border border-surface-300-700 focus-within:ring-2 focus-within:ring-primary-500 {readonly
		? 'bg-surface-100-900'
		: 'bg-surface-50-950'}"
	data-language={language}
>
	{#if !view}
		<!-- Server-side / pre-mount rendering: show the content as text. -->
		<pre
			class="m-0 overflow-x-auto p-2 font-mono text-sm whitespace-pre"
			style:min-height="{minLines * 1.4 + 0.5}em">{value}</pre>
	{/if}
</div>
{#if name}<input type="hidden" {name} {value} />{/if}
