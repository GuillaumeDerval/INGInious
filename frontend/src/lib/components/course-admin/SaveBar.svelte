<!--
@component
Save bar of the admin editors (docs/ux-design.md): the submit button of the
enclosing form and a status ("Unsaved changes" with an amber dot when the edited
values differ from the ones of the last load/save, "All changes saved"
otherwise). With unsaved changes or after a failed save it floats at the bottom
of the viewport (sticky, elevated) and shows the error of the last save, which
is also kept visible here in addition to the toast.

Props:
- `values` (unknown): edited state (compared as JSON).
- `version` (unknown): loaded data; a new value (after a save) resets the baseline.
- `showError` (boolean, default true): false when the page already lists the error (task editor).
-->
<script lang="ts">
	import { tick } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.js';
	import ErrorIcon from '@lucide/svelte/icons/circle-x';

	/** Props (documented in the component comment above). */
	export interface Props {
		values: unknown;
		version: unknown;
		showError?: boolean;
	}

	let { values, version, showError = true }: Props = $props();
	let base = $state('');
	// The baseline is taken once the editors have normalised the values.
	$effect(() => {
		void version;
		tick().then(() => (base = JSON.stringify(values)));
	});
	const dirty = $derived(base !== '' && JSON.stringify(values) !== base);
	const error = $derived(page.status >= 400 ? (page.form as { message?: string } | null)?.message : null);
</script>

<div class={['z-20 mt-6 overflow-hidden panel', (dirty || error) && 'sticky bottom-3 shadow-lg']}>
	{#if error && showError}
		<div
			class="flex items-start gap-2.5 border-b border-error-500/25 bg-error-500/7 px-4 py-2.5 text-sm text-surface-900-100"
			role="alert"
		>
			<ErrorIcon class="mt-0.5 size-4 shrink-0 text-error-600-400" aria-hidden="true" />
			<p class="whitespace-pre-line">{error}</p>
		</div>
	{/if}
	<div class="flex flex-wrap items-center gap-3 py-2.5 ps-4 pe-2.5">
		<span class="flex items-center gap-2 text-sm" role="status">
			{#if dirty}
				<!-- Highlight (hat yellow, dark text) of the theme. -->
				<span class="badge bg-secondary-300 text-secondary-950">
					<span class="size-1.5 rounded-full bg-secondary-800" aria-hidden="true"></span>{t('Unsaved changes')}
				</span>
			{:else}
				<CheckIcon class="size-4 text-success-600-400" aria-hidden="true" />
				<span class="text-surface-600-400">{t('All changes saved')}</span>
			{/if}
		</span>
		<button class="ms-auto btn preset-filled-primary-500">{t('Save changes')}</button>
	</div>
</div>
