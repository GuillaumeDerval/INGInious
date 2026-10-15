<!--
@component
/coming_tasks (NAV-20): per course, a card listing the unfinished tasks
ordered by soft deadline (deadline chip, absolute date in its tooltip, grade
bar), filtered by the time planner (number of days: 7, 14, 30 or unlimited,
as chip links), one page of tasks at a time (Pager), and the last tried exercises in the side column.
-->
<script lang="ts">
	import CalendarCheckIcon from '@lucide/svelte/icons/calendar-check';
	import { t } from '#lib/i18n/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import GradeBar from '#lib/components/ui/GradeBar.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import DeadlineChip from '#lib/components/nav/DeadlineChip.svelte';
	import LastTried from '#lib/components/nav/LastTried.svelte';
	import Pager from '#lib/components/ui/Pager.svelte';
	import { page } from '$app/state';
	import { withQuery } from '#lib/utils/url.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHeader
	title={t('Upcoming Tasks')}
	subtitle={t('This page lists the coming tasks ordered on deadlines for courses you are registered in.')}
/>
<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
	<div class="min-w-0 space-y-4">
		<nav class="flex flex-wrap items-center gap-1.5" aria-label={t('Number of days:')}>
			<span class="me-1 text-sm text-surface-600-400">{t('Number of days:')}</span>
			{#each ['7', '14', '30', 'unlimited'] as d (d)}<a
					class="chip {data.planner === d ? 'preset-filled-primary-500' : 'preset-tonal'}"
					aria-current={data.planner === d ? 'true' : undefined}
					href={`?time_planner=${d}`}>{d === 'unlimited' ? t('unlimited') : d}</a
				>{/each}
		</nav>
		{#each data.courses as course (course.id)}
			<section class="overflow-hidden panel">
				<h2 class="flex items-center gap-2 border-b border-surface-200-800 px-4 py-3 font-semibold sm:px-5">
					<a class="min-w-0 flex-1 truncate hover:text-primary-700-300" href={`/course/${course.id}`}>{course.name}</a>
					<Badge>{course.count}</Badge>
				</h2>
				<ul class="divide-y divide-surface-200-800">
					{#each course.tasks as task (task.id)}
						<li>
							<a
								class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-primary-500/5 sm:px-5"
								href={`/course/${course.id}/${task.id}`}
							>
								<span class="min-w-0 flex-1 font-medium">{task.name}</span>
								<DeadlineChip value={task.deadline} />
								<span class="w-24 sm:w-36"><GradeBar value={task.grade} /></span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<EmptyState
				icon={CalendarCheckIcon}
				title={t('You have no upcoming tasks')}
				description={t('Nothing is due in this period: try a longer one.')}
			/>
		{/each}
		<Pager page={data.page} pages={data.pages} href={(p) => withQuery(page.url, { page: p })} />
	</div>
	<LastTried items={data.lastTried} showCourse />
</div>
