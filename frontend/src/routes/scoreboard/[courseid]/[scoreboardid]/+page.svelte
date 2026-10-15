<!--
@component
/scoreboard/<courseid>/<index> (SITE-13): ranking of one scoreboard.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import ScoreTable from '#lib/components/site/ScoreTable.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHeader
	title={data.name}
	subtitle={data.course}
	breadcrumbs={[
		{ label: data.course, href: `/course/${data.id}` },
		{ label: t('Scoreboards'), href: `/scoreboard/${data.id}` },
		{ label: data.name }
	]}
/>
<ScoreTable header={data.header} rows={data.rows} emphasis={data.emphasis} />
