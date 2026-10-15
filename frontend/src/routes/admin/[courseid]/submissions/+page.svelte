<!--
@component
Course submissions page (CSTU-11..14): collapsible filter panel, results table
with a bulk action bar (download / replay the checked rows), pagination, and
the export / download / replay of the whole selection in a secondary menu.
-->
<script lang="ts">
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ReplayIcon from '@lucide/svelte/icons/rotate-ccw';
	import {
		adminCrumbs,
		Alert,
		Card,
		MoreMenu,
		PageHeader,
		QueryForm,
		SubmissionTable,
		enhance,
		page,
		t,
		toastEnhance
	} from '#lib/components/course-admin/kit.js';
	import Pager from '#lib/components/ui/Pager.svelte';
	import { actionUrl, withQuery } from '#lib/utils/url.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const base = $derived(`/admin/${data.adminCourse.id}`);
	const search = $derived(page.url.searchParams);
</script>

<PageHeader
	title={t('Submissions')}
	subtitle={t('Find, download and replay the submissions of the course.')}
	breadcrumbs={adminCrumbs(data.adminCourse, t('Submissions'))}
/>

<div class="space-y-6">
	<QueryForm query={data.query} options={data.options} />
	{#if data.error || form?.message}
		<div class="space-y-3">
			{#if data.error}<Alert kind="warning">{data.error}</Alert>{/if}
			{#if form?.message}<Alert kind="success">{form.message}</Alert>{/if}
		</div>
	{/if}
	<Card title={t('{} submissions selected', data.count)} description={t('Submissions matching the filters.')}>
		{#snippet actions()}
			<MoreMenu label={t('Whole selection')} class="w-72 space-y-1 p-1.5">
				<a class="menu-item" href={`${base}/submissions/submissions.csv?${search}`} download
					><DownloadIcon aria-hidden="true" />{t('Download CSV')}</a
				>
				<form
					method="GET"
					action={`${base}/submissions/submissions.tgz`}
					class="space-y-2 border-y border-surface-200-800 p-2.5"
				>
					<p class="eyebrow">{t('Archive layout')}</p>
					{#each [...search] as [name, value], i (i)}<input type="hidden" {name} {value} />{/each}
					{#each data.layouts as layout, i (layout)}<label class="flex items-center gap-2 font-mono text-xs"
							><input type="radio" class="radio" name="download_type" value={layout} checked={!i} />{layout}</label
						>{/each}
					<label class="flex items-center gap-2 text-sm"
						><input type="checkbox" class="checkbox" name="eval_dl" />{t('Only evaluation submissions')}</label
					>
					<label class="flex items-center gap-2 text-sm"
						><input type="checkbox" class="checkbox" name="simplify" />{t('Simplified file tree')}</label
					>
					<button class="btn w-full preset-tonal btn-sm"
						><ArchiveIcon aria-hidden="true" />{t('Download archive')}</button
					>
				</form>
				{#if data.admin}<form method="POST" action={actionUrl(page.url, 'replay')} use:enhance={toastEnhance()}>
						<input type="hidden" name="query" value={String(search)} /><button class="menu-item text-warning-700-300"
							><ReplayIcon aria-hidden="true" />{t('Replay current selection')}</button
						>
					</form>{/if}
			</MoreMenu>
		{/snippet}
		<form method="POST" action={actionUrl(page.url, 'replay')}>
			<SubmissionTable
				rows={data.rows}
				{base}
				admin={data.admin}
				showId={data.query.show_id}
				showTags={data.query.show_tags}
			>
				{#snippet bulk()}
					<button class="btn preset-tonal" formmethod="GET" formaction={`${base}/submissions/submissions.tgz`}
						><DownloadIcon aria-hidden="true" />{t('Download checked')}</button
					>
					{#if data.admin}<button class="btn preset-tonal-warning"
							><ReplayIcon aria-hidden="true" />{t('Replay checked')}</button
						>{/if}
				{/snippet}
			</SubmissionTable>
		</form>
		<div class="mt-4 empty:hidden">
			<Pager page={data.page} pages={data.pages} href={(p) => withQuery(page.url, { page: p })} />
		</div>
	</Card>
</div>
