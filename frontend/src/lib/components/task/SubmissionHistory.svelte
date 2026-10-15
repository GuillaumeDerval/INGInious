<!--
@component
Submission history of the viewer as a compact card list (TASK-10/13), newest
first (an empty state teaches what will appear here): result, grade, date and number of tags of each submission; the
evaluated one ("best" or "last" depending on the task) is marked, and so is the one
whose answers and result are displayed in the page (`current`, `aria-current`). Clicking an
entry reloads its answers and result into the page. The history is loaded a page at
a time: the header counts every submission and a "Load older submissions" button
at the end of the list asks for the next page.

Props: `submissions` (SubmissionSummary[]), `count` (number), `more` (boolean),
`evaluated` (string | null), `current` (string | null), `mode` ('best' | 'last'), `onselect` ((id) => void),
`onmore` (() => void), `disabled` (boolean).
-->
<script lang="ts">
	import StarIcon from '@lucide/svelte/icons/star';
	import TagIcon from '@lucide/svelte/icons/tag';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import DateTime from '#lib/components/ui/DateTime.svelte';
	import ResultBadge from '#lib/components/ui/ResultBadge.svelte';
	import { t } from '#lib/i18n/index.js';
	import type { SubmissionSummary } from './types.js';

	/** Props of SubmissionHistory. */
	export interface Props {
		/** Loaded submissions, newest first. */
		submissions: SubmissionSummary[];
		/** Number of submissions (loaded or not). */
		count: number;
		/** True when older submissions can be loaded. */
		more?: boolean;
		/** Id of the evaluated submission. */
		evaluated: string | null;
		/** Id of the submission displayed in the page (none after a reload, like legacy). */
		current?: string | null;
		/** Evaluation mode of the task. */
		mode: 'best' | 'last';
		/** Called with the id of the clicked submission. */
		onselect: (id: string) => void;
		/** Called to load the next page of older submissions. */
		onmore?: () => void;
		/** Disables the entries while busy. */
		disabled?: boolean;
	}

	let {
		submissions,
		count,
		more = false,
		evaluated,
		current = null,
		mode,
		onselect,
		onmore,
		disabled = false
	}: Props = $props();
</script>

<section aria-labelledby="history-title" class="panel">
	<header class="flex items-center justify-between gap-2 border-b border-surface-200-800 px-4 py-3 sm:px-5">
		<h2 id="history-title" class="text-sm font-semibold">{t('Submission history')}</h2>
		{#if count}<Badge>{count}</Badge>{/if}
	</header>
	{#if !submissions.length}
		<EmptyState
			compact
			icon={HistoryIcon}
			title={t('No submission yet: your submissions and their results will appear here.')}
		/>
	{/if}
	<ol class="max-h-80 space-y-0.5 overflow-y-auto p-2 empty:hidden" data-testid="history">
		{#each submissions as s (s.id)}
			<li>
				<button
					type="button"
					class={[
						'flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-base px-2.5 py-2 text-start text-sm hover:bg-surface-100-900',
						s.id === current
							? 'bg-primary-500/10 ring-1 ring-primary-500/40 ring-inset'
							: s.id === evaluated && 'bg-success-500/6'
					]}
					aria-current={s.id === current || undefined}
					{disabled}
					onclick={() => onselect(s.id)}
					data-submission={s.id}
				>
					<ResultBadge
						result={s.status === 'waiting' ? 'waiting' : s.result}
						grade={s.status === 'waiting' ? undefined : s.grade}
					/>
					<span class="text-surface-600-400"><DateTime value={s.submittedOn} /></span>
					{#if s.tags.length}<span class="badge bg-primary-500/12 text-primary-700-300" title={s.tags.join(', ')}
							><TagIcon aria-hidden="true" />{s.tags.length}</span
						>{/if}
					<!-- Markers (text + icon, never colour alone): displayed and evaluated submission. -->
					{#if s.id === current}
						<span
							class="ms-auto inline-flex items-center gap-1 text-xs font-medium text-primary-700-300"
							data-testid="displayed"><EyeIcon class="size-3.5" aria-hidden="true" />{t('Displayed')}</span
						>
					{/if}
					{#if s.id === evaluated}
						<span
							class={[
								s.id !== current && 'ms-auto',
								'inline-flex items-center gap-1 text-xs font-medium text-success-700-300'
							]}
							data-testid="evaluated"
							><StarIcon class="size-3.5 fill-current" aria-hidden="true" />{mode === 'last'
								? t('Last submission')
								: t('Best submission')}</span
						>
					{/if}
				</button>
			</li>
		{/each}
		{#if more}
			<li>
				<button
					type="button"
					class="btn w-full text-surface-600-400 btn-sm hover:preset-tonal"
					{disabled}
					onclick={onmore}><ChevronDownIcon aria-hidden="true" />{t('Load older submissions')}</button
				>
			</li>
		{/if}
	</ol>
</section>
