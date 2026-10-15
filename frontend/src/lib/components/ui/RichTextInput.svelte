<!--
@component
Editor of a rich text (task statement, problem header, choice, course description...)
that hides how the markup language is stored: the author picks "reStructuredText"
or "Markdown" with a switch, and the stored value gets (or loses) the `#MD` first
line (see #lib/utils/text-format.ts). An optional preview renders the text through
a server endpoint (POST `previewUrl` with the stored text, answering sanitized HTML).
Props:
- `value` (string, bindable): stored text, marker included.
- `label` (string): field label (accessible name of the editor).
- `previewUrl` (string, optional): enables the preview tab.
- `minLines` (number, default 6): editor height.
@example <RichTextInput bind:value={task.context} label={t('Context')} previewUrl="/admin/c/preview" />
-->
<script lang="ts">
	import CodeEditor from './CodeEditor.svelte';
	import RichText from '../common/RichText.svelte';
	import { splitTextFormat, joinTextFormat, type TextFormat } from '#lib/utils/text-format.js';
	import type { SafeHtml } from '#lib/utils/safe-html.js';
	import { t } from '#lib/i18n/index.js';

	/** Props of RichTextInput. */
	export interface Props {
		/** Stored text (with the `#MD` marker for Markdown); bindable. */
		value?: string;
		/** Field label. */
		label: string;
		/** Endpoint rendering a preview (POST text → HTML); no preview when absent. */
		previewUrl?: string;
		/** Minimal editor height in lines. */
		minLines?: number;
	}
	let { value = $bindable(''), label, previewUrl, minLines = 6 }: Props = $props();

	// The author edits the body; the stored value is rebuilt from body + format.
	const initial = splitTextFormat(value);
	let format: TextFormat = $state(initial.format);
	let body = $state(initial.body);
	let preview: SafeHtml | null = $state(null);
	$effect(() => {
		value = joinTextFormat(format, body);
	});

	/** Toggles the preview, fetching the rendered HTML from the server. */
	async function togglePreview() {
		if (preview !== null) {
			preview = null;
			return;
		}
		const response = await fetch(previewUrl!, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: value
		});
		preview = (response.ok ? await response.text() : t('Preview unavailable.')) as SafeHtml;
	}
</script>

<div class="space-y-2">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<span class="label-text font-medium">{label}</span>
		<div class="flex flex-wrap items-center gap-2">
			<div
				class="btn-group preset-outlined-surface-200-800 text-xs"
				role="radiogroup"
				aria-label={t('Markup language')}
			>
				{#each [['rst', 'reStructuredText'], ['markdown', 'Markdown']] as const as [id, text] (id)}
					<button
						type="button"
						role="radio"
						aria-checked={format === id}
						class="btn btn-sm {format === id ? 'preset-filled-primary-500' : ''}"
						onclick={() => (format = id)}>{text}</button
					>
				{/each}
			</div>
			{#if previewUrl}
				<button type="button" class="btn preset-tonal btn-sm" aria-pressed={preview !== null} onclick={togglePreview}
					>{preview === null ? t('Preview') : t('Edit')}</button
				>
			{/if}
		</div>
	</div>
	{#if preview !== null}
		<div class="card border border-surface-200-800 p-4"><RichText html={preview} /></div>
	{:else}
		<CodeEditor bind:value={body} {label} language={format === 'markdown' ? 'markdown' : 'plain'} {minLines} wrap />
	{/if}
</div>
