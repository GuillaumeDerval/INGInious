<!--
@component
"Last tried exercises" (NAV-21): links to the last attempted tasks with the
outcome of their latest submission (ResultBadge; saved answers have none), or
"No submissions". On course pages it is a side card listing the task names;
with `strip` it is the "Continue where you left off" strip of the
dashboard: a horizontally scrollable row of cards with the course name above
the task name.

Props:
- `items` (LastTriedItem[]): entries, most recent first.
- `showCourse` (boolean, default false): shows the course names.
- `strip` (boolean, default false): dashboard strip ("Continue where you left off") instead of a side card.
-->
<script lang="ts">
	import HistoryIcon from '@lucide/svelte/icons/history';
	import PlayIcon from '@lucide/svelte/icons/play';
	import { t } from '#lib/i18n/index.js';
	import ResultBadge from '#lib/components/ui/ResultBadge.svelte';
	import type { LastTriedItem } from './types.js';

	export interface Props {
		items: LastTriedItem[];
		showCourse?: boolean;
		strip?: boolean;
	}
	let { items, showCourse = false, strip = false }: Props = $props();
	/** Result shown for an entry (none for saved answers). */
	const result = (i: LastTriedItem) => (i.status === 'done' ? i.result : i.status);
</script>

{#snippet badge(item: LastTriedItem)}
	{#if item.result !== 'save'}<ResultBadge result={result(item)} />{/if}
{/snippet}

{#if strip}
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">{t('Continue where you left off')}</h2>
		{#if items.length}
			<ul class="grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1">
				{#each items as item (item.courseid + '/' + item.taskid)}
					<li class="flex">
						<a
							class="flex w-full flex-col gap-2 panel p-4 transition hover:border-primary-500/40 hover:shadow-md"
							href={`/course/${item.courseid}/${item.taskid}`}
						>
							{#if showCourse}<span class="truncate text-xs text-surface-600-400">{item.courseName}</span>{/if}
							<span class="line-clamp-2 flex-1 text-sm font-semibold">{item.taskName}</span>
							<span class="flex items-center justify-between gap-2">
								{@render badge(item)}
								<!-- Hat-yellow "resume" highlight (docs/design-system.md: secondary = highlights). -->
								<span
									class="ms-auto grid size-7 place-items-center rounded-full bg-secondary-300 text-secondary-950"
									aria-hidden="true"><PlayIcon class="size-3.5 fill-current" /></span
								>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="flex items-center gap-2 text-sm text-surface-600-400">
				<HistoryIcon class="size-4" aria-hidden="true" />{t('No submissions')}
			</p>
		{/if}
	</section>
{:else}
	<section class="overflow-hidden panel">
		<h2 class="border-b border-surface-200-800 px-4 py-3 text-sm font-semibold">{t('Last tried exercises')}</h2>
		<ul class="divide-y divide-surface-200-800">
			{#each items as item (item.courseid + '/' + item.taskid)}
				<li>
					<a
						class="flex flex-col items-start gap-1 px-4 py-2.5 text-sm hover:bg-primary-500/5"
						href={`/course/${item.courseid}/${item.taskid}`}
					>
						{#if showCourse}<span class="text-xs text-surface-600-400">{item.courseName}</span>{/if}
						<span class="font-medium">{item.taskName}</span>
						{@render badge(item)}
					</a>
				</li>
			{:else}
				<li class="px-4 py-3 text-sm text-surface-600-400">{t('No submissions')}</li>
			{/each}
		</ul>
	</section>
{/if}
