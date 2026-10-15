<!--
@component
/marketplace (NAV-18): one card per shared course (short description shown
as text, link to its page) with its import form in the footer.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import StoreIcon from '@lucide/svelte/icons/store';
	import CourseCard from '#lib/components/nav/CourseCard.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import ImportForm from '#lib/components/nav/ImportForm.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHeader
	title={t('Marketplace')}
	subtitle={t(
		'Importing a course creates a new hidden course on this instance, administrated by you, with the tasks and the structure of the selected course.'
	)}
/>
<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
	{#each data.courses as c (c.id)}
		<CourseCard id={c.id} name={c.name} href={`/marketplace/${c.id}`}>
			<p class="line-clamp-3 text-sm text-surface-700-300">{c.shortDesc}</p>
			{#snippet footer()}<ImportForm courseid={c.id} />{/snippet}
		</CourseCard>
	{/each}
</div>
{#if !data.courses.length}<EmptyState icon={StoreIcon} title={t('No public courses available')} />{/if}
