<!--
@component
Upload of a `file` problem (TASK-04): drop zone limited to the allowed
extensions and maximum size (re-checked by the server), plus the link to the
file of the reloaded submission (`downloadUrl`, only set when it has a file `filename`).

Props: `problem` (ProblemData), `filename` / `downloadUrl` (string | null), `disabled` (boolean).
-->
<script lang="ts">
	import FileDrop from '#lib/components/ui/FileDrop.svelte';
	import { t } from '#lib/i18n/index.js';
	import type { ProblemData } from './types.js';

	/** Props of FileProblem. */
	export interface Props {
		/** The problem. */
		problem: ProblemData;
		/** Name of the file of the reloaded submission. */
		filename?: string | null;
		/** URL to download it. */
		downloadUrl?: string | null;
		/** Disabled while a submission is processed. */
		disabled?: boolean;
	}

	let { problem, filename = null, downloadUrl = null, disabled = false }: Props = $props();
	const exts = $derived(problem.allowedExts!);
</script>

<fieldset {disabled} class="space-y-2">
	{#if downloadUrl}
		<a class="btn preset-tonal-primary" href={downloadUrl} download
			>{t('Click here to download the file you submitted previously')} ({filename})</a
		>
	{/if}
	<FileDrop
		name={problem.id}
		label={problem.title || t('Choose a file')}
		accept={exts.join(',')}
		maxSize={problem.maxSize}
	/>
	<p class="text-xs text-surface-600-400">{t('Allowed extensions: {}', exts.join(', '))}</p>
</fieldset>
