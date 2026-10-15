<!--
@component
/marketplace/<courseid> (NAV-19): rendered description, import form and
information card (key/value list) of a marketplace course.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import RichText from '#lib/components/common/RichText.svelte';
	import ImportForm from '#lib/components/nav/ImportForm.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHeader title={data.name} breadcrumbs={[{ label: t('Marketplace'), href: '/marketplace' }, { label: data.name }]} />
<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
	<div class="min-w-0 space-y-6">
		<Card><RichText html={data.description} /></Card>
		<Card
			title={t('Import course')}
			description={t(
				'Importing a course creates a new hidden course on this instance, administrated by you, with the tasks and the structure of the selected course.'
			)}
		>
			<ImportForm primary />
		</Card>
	</div>
	<Card title={t('Information')}>
		<dl class="kv">
			{#each data.info as [label, value] (label)}<dt>{label}</dt>
				<dd>{value}</dd>{/each}
			{#if data.link}<dt>{t('Link')}</dt>
				<dd><a class="anchor" href={data.link} target="_blank" rel="noopener noreferrer">{data.link}</a></dd>{/if}
		</dl>
	</Card>
</div>
