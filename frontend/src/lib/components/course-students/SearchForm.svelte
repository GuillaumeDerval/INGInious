<!--
@component
Server-side search box of a paginated list (CSTU-01/04/07/09): a GET form
submitting `q` with the `hidden` parameters (e.g. the tab), so the server
answers the first page of the matching rows; while searching, the number of
matches is shown.

Props:
- `q` (string): current search.
- `matching` (number): number of matching rows.
- `hidden` (Record<string, string>, optional): other query parameters kept.
- `placeholder` (string, optional): input placeholder.

@example
<SearchForm q={data.q} matching={data.students.matching} hidden={{ tab: 'students' }} />
-->
<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import { t } from '#lib/i18n/index.js';

	/** Props of SearchForm. */
	export interface Props {
		/** Current search. */
		q: string;
		/** Number of matching rows. */
		matching: number;
		/** Other query parameters kept. */
		hidden?: Record<string, string>;
		/** Input placeholder. */
		placeholder?: string;
	}

	let { q, matching, hidden = {}, placeholder = t('Search...') }: Props = $props();
</script>

<form
	method="GET"
	role="search"
	class="mb-3 flex flex-wrap items-center gap-2"
	data-sveltekit-keepfocus
	data-sveltekit-noscroll
	data-sveltekit-replacestate
>
	{#each Object.entries(hidden) as [name, value] (name)}<input type="hidden" {name} {value} />{/each}
	<div class="relative w-full sm:max-w-xs">
		<SearchIcon
			class="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-surface-500"
			aria-hidden="true"
		/>
		<input class="input ps-9!" type="search" name="q" value={q} {placeholder} aria-label={t('Search')} />
	</div>
	<button class="btn preset-tonal">{t('Search')}</button>
	{#if q}<span class="text-sm text-surface-600-400 tabular-nums">{t('{} results', matching)}</span>{/if}
</form>
