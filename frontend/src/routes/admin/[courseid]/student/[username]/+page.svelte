<!--
@component
Per-student statistics (CSTU-09/10): KPI cards (tasks succeeded, tasks
attempted, submissions), then the status of the tasks (not served by the
dispenser, not viewed, viewed, succeeded/failed with grade linking to the
evaluated submission), filtered by status chips and a search, one page at a
time, with icon actions: view the submissions of the task and "Reset state"
(one shared confirmation dialog).
-->
<script lang="ts">
	import ListIcon from '@lucide/svelte/icons/list-checks';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ResetIcon from '@lucide/svelte/icons/rotate-ccw';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import {
		adminCrumbs,
		Alert,
		Badge,
		Card,
		ConfirmDialog,
		PageHeader,
		Table,
		formatGrade,
		t
	} from '#lib/components/course-admin/kit.js';
	import { page } from '$app/state';
	import Pager from '#lib/components/ui/Pager.svelte';
	import SearchForm from '#lib/components/course-students/SearchForm.svelte';
	import { withQuery } from '#lib/utils/url.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const base = $derived(`/admin/${data.adminCourse.id}`);
	const users = $derived(encodeURIComponent(data.username));
	type Task = PageProps['data']['rows'][number];
	/** Task whose state is being reset (confirmation dialog open). */
	let resetting = $state<Task | null>(null);
	/** Badge of each status. */
	const STATUS = {
		notviewed: ['neutral', t('Not viewed')],
		notattempted: ['warning', t('Not attempted (viewed)')],
		succeeded: ['success', t('Succeeded')],
		failed: ['error', t('Failed')]
	} as const;
	const kpis = $derived([
		[t('Tasks succeeded'), `${data.totals.succeeded} / ${data.totals.tasks}`],
		[t('Tasks attempted'), data.totals.attempted],
		[t('Submissions'), data.totals.submissions]
	]);
	const icon = 'btn-icon btn-icon-sm text-surface-600-400 hover:preset-tonal';
</script>

<PageHeader
	title={data.realname}
	subtitle={t('Statistics for student {} ({})', data.realname, data.username)}
	breadcrumbs={adminCrumbs(data.adminCourse, { label: t('User management'), href: `${base}/students` }, data.realname)}
>
	{#snippet actions()}
		<a class="btn preset-tonal" href={`${base}/students/student.csv?username=${users}`} download
			><DownloadIcon aria-hidden="true" />{t('Download CSV')}</a
		>
		<a class="btn preset-tonal" href={`${base}/submissions?users=${users}`}
			><ListIcon aria-hidden="true" />{t('View all submissions')}</a
		>
	{/snippet}
</PageHeader>

<div class="space-y-6">
	{#if form?.message}<Alert kind="success">{form.message}</Alert>{/if}
	<div class="grid grid-cols-3 gap-3 sm:gap-4">
		{#each kpis as [label, value] (label)}<div class="panel px-3 py-3 sm:px-5 sm:py-4">
				<p class="eyebrow">{label}</p>
				<p class="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>
			</div>{/each}
	</div>
	<Card title={t('Tasks')} description={t('Status and grade of the evaluated submission of every task.')}>
		<!-- Status filter chips (the search and the page are reset). -->
		<nav class="mb-3 flex flex-wrap gap-1.5" aria-label={t('Status')}>
			{#each [['', t('All')], ...Object.entries(STATUS).map(([k, [, label]]) => [k, label])] as [value, label] (value)}
				<a
					class={['chip', data.status === value ? 'preset-filled-primary-500' : 'preset-tonal']}
					aria-current={data.status === value ? 'page' : undefined}
					href={withQuery(page.url, { status: value || null, page: null })}
					data-sveltekit-noscroll>{label}</a
				>
			{/each}
		</nav>
		<SearchForm
			q={data.q}
			matching={data.matching}
			hidden={data.status ? { status: data.status } : {}}
			placeholder={t('Search a task')}
		/>
		<Table
			columns={[
				{ key: 'name', label: t('Task') },
				{ key: 'status', label: t('Status'), custom: true },
				{ key: 'tried', label: t('# submissions'), numeric: true }
			]}
			rows={data.rows}
			searchable={false}
			empty={data.q || data.status ? t('Nothing matches your search.') : undefined}
		>
			{#snippet custom(r)}
				{@const [tone, label] = STATUS[r.status as keyof typeof STATUS]}
				<span class="flex flex-wrap items-center gap-1.5">
					{#if r.submissionid}<a
							class="rounded-full hover:brightness-95"
							href={`/submission/${r.submissionid}`}
							title={t('View evaluation submission')}><Badge {tone}>{`${label} (${formatGrade(r.grade)})`}</Badge></a
						>{:else}<Badge {tone}>{label}</Badge>{/if}
					{#if !r.visible}<Badge icon={EyeOffIcon}>{t('Not served by the task dispenser')}</Badge>{/if}
				</span>
			{/snippet}
			{#snippet actions(r)}
				<a
					class={icon}
					href={`${base}/submissions?users=${users}&tasks=${r.taskid}`}
					title={t('View submissions')}
					aria-label={t('View submissions')}><ListIcon /></a
				>
				<button
					type="button"
					class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal-error"
					title={t('Reset state')}
					aria-label={t('Reset state')}
					onclick={() => (resetting = r)}><ResetIcon /></button
				>
			{/snippet}
		</Table>
		<div class="mt-3"><Pager page={data.page} pages={data.pages} href={(p) => withQuery(page.url, { page: p })} /></div>
	</Card>
</div>
<ConfirmDialog
	bind:open={() => !!resetting, (o) => !o && (resetting = null)}
	title={t('Reset State')}
	description={t('This will reset the state for {}. Are you sure ?', resetting?.name ?? '')}
	action="?/reset"
	fields={{ taskid: resetting?.taskid ?? '' }}
/>
