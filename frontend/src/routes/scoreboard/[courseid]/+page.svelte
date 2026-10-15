<!--
@component
/scoreboard/<courseid> (SITE-13): links to the scoreboards of the course, as a card list
(a course without scoreboard is a 404, see `scoreboardNames`).
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import ChevronIcon from '@lucide/svelte/icons/chevron-right';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHeader
	title={t('Available scoreboards')}
	subtitle={data.course}
	breadcrumbs={[{ label: data.course, href: `/course/${data.id}` }, { label: t('Scoreboards') }]}
/>
<nav class="max-w-2xl overflow-hidden panel" aria-label={t('Scoreboards')}>
	<ul class="divide-y divide-surface-200-800">
		{#each data.boards as name, i (i)}
			<li>
				<a
					class="flex items-center gap-3 px-4 py-3 font-medium hover:bg-primary-500/5 sm:px-5"
					href={`/scoreboard/${data.id}/${i}`}
				>
					<TrophyIcon class="size-4 text-surface-500" aria-hidden="true" /><span class="flex-1">{name}</span>
					<ChevronIcon class="size-4 text-surface-500 rtl:rotate-180" aria-hidden="true" />
				</a>
			</li>
		{/each}
	</ul>
</nav>
