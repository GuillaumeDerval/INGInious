<!--
@component
/queue (NAV-17): running and waiting grading jobs, with a kill button
(confirmation dialog) on the jobs the user may kill; the result of a kill is shown above the tables.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import DateTime from '#lib/components/ui/DateTime.svelte';
	import ConfirmDialog from '#lib/components/ui/ConfirmDialog.svelte';
	import DataTable from '#lib/components/ui/DataTable.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	/** DataTable columns from header labels (+ the action column). */
	const columns = (...labels: string[]) => [...labels, t('Action')].map((label) => ({ key: label, label }));
	const tables = $derived([
		{
			title: t('Running jobs'),
			empty: t('There are no jobs running'),
			columns: columns(t('Agent name'), t('Name'), t('Launcher name'), t('Started at'), t('Timeout at')),
			rows: data.running as (typeof data.running | typeof data.waiting)[number][]
		},
		{
			title: t('Jobs in queue'),
			empty: t('There are no jobs waiting in queue'),
			columns: columns(t('Name'), t('Launcher name'), t('Maximum runtime in seconds')),
			rows: data.waiting
		}
	]);
</script>

<PageHeader title={t('Job queue')} subtitle={t('This page shows a snapshot of the job queue.')} />
{#if form?.message}<Alert kind={page.status >= 400 ? 'error' : 'success'}>{form.message}</Alert>{/if}
{#each tables as table (table.title)}
	<section class="mb-8 space-y-3">
		<h2 class="flex items-center gap-2 text-lg font-semibold">{table.title}<Badge>{table.rows.length}</Badge></h2>
		<DataTable columns={table.columns} rows={table.rows} empty={table.empty}>
			{#snippet row(job)}
				<tr title={job.id}>
					{#if 'agent' in job}
						<td class="font-medium">{job.agent}</td><td>{job.info}</td><td>{job.launcher}</td><td
							><DateTime value={job.start} /></td
						><td
							>{#if job.end}<DateTime value={job.end} />{:else}{t('No timeout set')}{/if}</td
						>
					{:else}
						<td>{job.info}</td><td>{job.launcher}</td><td class="tabular-nums">{job.max ?? t('No timeout set')}</td>
					{/if}
					<td class="text-end"
						>{#if job.kill}<ConfirmDialog
								title={t('Kill job')}
								description={t('Are you sure ?')}
								triggerLabel={t('Kill')}
								confirmLabel={t('Kill')}
								action="?/kill"
								fields={{ jobid: job.id }}
							/>{/if}</td
					>
				</tr>
			{/snippet}
		</DataTable>
	</section>
{/each}
