<!--
@component
Course statistics, two tabs. "Submissions" (CSTU-17): filter panel, KPI cards
(submissions, success rate, evaluation submissions, active students), the
submissions over time (the running day/hour dashed) and per task charts, most
submitted tasks / most active users (names first, ids in muted text; first rows,
"Show all" for the others), tag statistics. "Student progress"
(CSTU-16): students who viewed / attempted / succeeded each task, one page of
tasks at a time (+ CSV of every task).
-->
<script lang="ts">
	import SendIcon from '@lucide/svelte/icons/send';
	import TargetIcon from '@lucide/svelte/icons/target';
	import AwardIcon from '@lucide/svelte/icons/award';
	import UsersIcon from '@lucide/svelte/icons/users';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ChartIcon from '@lucide/svelte/icons/chart-line';
	import ProgressIcon from '@lucide/svelte/icons/list-checks';
	import { page } from '$app/state';
	import {
		adminCrumbs,
		Alert,
		Badge,
		Card,
		PageHeader,
		QueryForm,
		StatsChart,
		Table,
		t
	} from '#lib/components/course-admin/kit.js';
	import Pager from '#lib/components/ui/Pager.svelte';
	import Loading from '#lib/components/ui/Loading.svelte';
	import LinkTabs from '#lib/components/course-students/LinkTabs.svelte';
	import { withQuery } from '#lib/utils/url.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const base = $derived(`/admin/${data.adminCourse.id}`);
	const tasksLink = (r: { id: string }) => `${base}/submissions?tasks=${r.id}`;
	const tabs = [
		{ id: 'submissions', label: t('Submissions'), icon: ChartIcon },
		{ id: 'progress', label: t('Student progress'), icon: ProgressIcon }
	];
	const counts = [
		{ key: 'submissions', label: t('Submissions'), numeric: true },
		{ key: 'valid', label: t('Valid'), numeric: true }
	];
	/** Rows of the task and user tables shown before "Show all". */
	const FIRST_ROWS = 10;
	const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
	type Stats = NonNullable<PageProps['data']['stats']>;
	/** KPI cards of the submission statistics. */
	const kpis = (s: Stats) => [
		{
			label: t('Number of submissions'),
			value: s.global.total,
			icon: SendIcon,
			tint: 'bg-primary-500/12 text-primary-600-400'
		},
		{
			label: t('Success rate'),
			value: s.global.total ? `${Math.round((100 * sum(s.chart.valid)) / s.global.total)}%` : '—',
			icon: TargetIcon,
			tint: 'bg-success-500/12 text-success-600-400'
		},
		{
			label: t('Evaluation submissions (Succeeded)'),
			value: `${s.global.evalSucceeded} / ${s.global.evalTotal}`,
			icon: AwardIcon,
			tint: 'bg-warning-500/15 text-warning-600-400'
		},
		{
			label: t('Active students'),
			value: s.users.length,
			icon: UsersIcon,
			tint: 'bg-secondary-500/15 text-secondary-700-300'
		}
	];
</script>

<!-- A task or user cell: its name as a link, its id in muted monospace under it (searchable too). -->
{#snippet named(name: string, id: string, href: string)}
	<a class="font-medium text-primary-700-300 hover:underline" {href}>{name}</a>
	{#if id !== name}<p class="font-mono text-xs text-surface-600-400">{id}</p>{/if}
{/snippet}

<PageHeader
	title={t('Statistics')}
	subtitle={t('Activity and results of the students, for the submissions matching the filters.')}
	breadcrumbs={adminCrumbs(data.adminCourse, t('Statistics'))}
/>

<div class="space-y-6">
	<LinkTabs {tabs} active={data.tab} />
	{#if data.stats}
		{@const s = data.stats}
		<QueryForm query={s.query} options={s.options} stats />
		{#if s.error}<Alert kind="warning">{s.error}</Alert>{/if}
		<div class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
			{#each kpis(s) as kpi (kpi.label)}
				<div class="flex items-start gap-3 panel p-3 sm:p-5">
					<span class={['hidden size-10 shrink-0 place-items-center rounded-full sm:grid', kpi.tint]} aria-hidden="true"
						><kpi.icon class="size-5" /></span
					>
					<div class="min-w-0">
						<p class="text-xs text-surface-600-400 sm:text-sm">{kpi.label}</p>
						<p class="mt-0.5 text-xl font-semibold tabular-nums sm:text-2xl">{kpi.value}</p>
					</div>
				</div>
			{/each}
		</div>
		<Card title={t('Submissions over time')} description={s.hourly ? t('Per hour') : t('Per day')}>
			<StatsChart
				labels={s.chart.labels}
				series={[
					{ label: t('All submissions'), data: s.chart.all, color: 'primary' },
					{ label: t('Valid submissions'), data: s.chart.valid, color: 'success' }
				]}
				dates={s.hourly ? 'hour' : 'day'}
				partial={s.chart.partial}
				summary={t('{} submissions, {} valid', sum(s.chart.all), sum(s.chart.valid))}
			/>
			{#if s.chart.partial}<p class="mt-2 text-xs text-surface-600-400">
					{t('The dashed part is the current period, still in progress.')}
				</p>{/if}
		</Card>
		<div class="grid gap-6 lg:grid-cols-2">
			<Card title={t('Tasks')} description={t('Most submitted tasks.')}>
				{#if s.tasks.length}<div class="mb-4">
						<StatsChart
							type="bar"
							horizontal
							labels={s.tasks.slice(0, 8).map((r) => r.key)}
							series={[
								{ label: t('All submissions'), data: s.tasks.slice(0, 8).map((r) => r.submissions), color: 'primary' },
								{ label: t('Valid submissions'), data: s.tasks.slice(0, 8).map((r) => r.valid), color: 'success' }
							]}
							summary={t('Submissions per task')}
						/>
					</div>{/if}
				<Table
					searchable={false}
					limit={FIRST_ROWS}
					columns={[{ key: 'key', label: t('Task'), custom: true }, ...counts]}
					rows={s.tasks}
				>
					{#snippet custom(r)}{@render named(r.key, r.id, tasksLink(r))}{/snippet}
				</Table>
			</Card>
			<Card title={t('Users')} description={t('Most active users.')}>
				<Table
					searchable={s.users.length > 8}
					limit={FIRST_ROWS}
					columns={[{ key: 'name', label: t('User'), custom: true }, ...counts]}
					rows={s.users}
				>
					{#snippet custom(r)}{@render named(r.name, r.key, `${base}/student/${r.key}`)}{/snippet}
				</Table>
			</Card>
		</div>
		{#if s.tags.length}
			<Card title={t('Tag statistics')} description={t('Share of submissions where each tag was triggered.')}>
				<Table
					searchable={false}
					columns={[
						{ key: 'name', label: t('Tag'), custom: true },
						{ key: 'all', label: t('All submissions'), text: (r) => `${r.all}%`, numeric: true },
						{ key: 'best', label: t('Best submissions'), text: (r) => `${r.best}%`, numeric: true }
					]}
					rows={s.tags}
				>
					{#snippet custom(r)}<span title={r.description}
							><Badge tone={r.misconception ? 'error' : 'primary'}>{r.name}</Badge></span
						>{/snippet}
				</Table>
			</Card>
		{/if}
	{:else if data.progress}
		<Card
			title={t('Student progress')}
			description={t('Number of students who viewed, attempted and succeeded each task.')}
		>
			{#snippet actions()}<a class="btn preset-tonal" href={`${base}/students/progress.csv`} download
					><DownloadIcon aria-hidden="true" />{t('Download CSV')}</a
				>{/snippet}
			<!-- Streamed by the load function: a spinner until the aggregation is done. -->
			{#await data.progress}
				<Loading />
			{:then progress}
				<Table
					searchable={false}
					columns={[
						{ key: 'name', label: t('Task'), href: tasksLink },
						{ key: 'viewed', label: t('Viewed'), numeric: true },
						{ key: 'attempted', label: t('Attempted'), numeric: true },
						{ key: 'succeeded', label: t('Succeeded'), numeric: true },
						{ key: 'attempts', label: t('# attempts'), numeric: true }
					]}
					rows={progress.rows}
				/>
				<div class="mt-3">
					<Pager page={progress.page} pages={progress.pages} href={(p) => withQuery(page.url, { page: p })} />
				</div>
			{:catch}
				<Alert kind="error">{t('An error occurred.')}</Alert>
			{/await}
		</Card>
	{/if}
</div>
