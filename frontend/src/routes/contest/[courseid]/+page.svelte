<!--
@component
/contest/<courseid> (SITE-14): contest dates (two cards), ranking and activity; the page
reloads itself every 30 seconds until the contest is over.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import DateTime from '#lib/components/ui/DateTime.svelte';
	import HourglassIcon from '@lucide/svelte/icons/hourglass';
	import Alert from '#lib/components/ui/Alert.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import ScoreTable from '#lib/components/site/ScoreTable.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head
	>{#if !data.finished}<meta http-equiv="refresh" content="30" />{/if}</svelte:head
>
<PageHeader
	title={t('Contest')}
	subtitle={data.course}
	breadcrumbs={[{ label: data.course, href: `/course/${data.id}` }, { label: t('Scoreboard') }]}
/>
<div class="space-y-6">
	<section class="grid gap-4 sm:grid-cols-2">
		{#each [[t('Contest starts:'), data.start], [t('Contest ends:'), data.end]] as [label, date] (label)}
			<div class="panel p-4 sm:p-5">
				<p class="eyebrow">{label.replace(/\s*:$/, '')}</p>
				<p class="mt-1 text-lg font-semibold"><DateTime value={date} /></p>
			</div>
		{/each}
	</section>
	{#if !data.started}
		<EmptyState icon={HourglassIcon} title={t('Contest has not started yet.')} />
	{:else}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">{t('Scoreboard')}</h2>
			{#if !data.finished}<Alert>{t('The scoreboard will refresh every 30 seconds.')}</Alert>{/if}
			<ScoreTable header={data.header} rows={data.rows} emphasis={data.emphasis} />
		</section>
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">{t('Activity')}</h2>
			<ScoreTable header={[t('Time'), t('Contestant'), t('Task'), t('Result')]} rows={data.activity} />
		</section>
	{/if}
</div>
