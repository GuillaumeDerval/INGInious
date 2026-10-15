<!--
@component
Tabs of a page as links (`?tab=<id>`): the tab is in the URL, so it survives
reloads and form actions, and the server only loads the data of the shown tab
(user management CSTU-01..08, statistics CSTU-16/17). Each tab has an icon and
an optional count badge.

Props:
- `tabs` ({ id, label, icon, count? }[]): the tabs.
- `active` (string): id of the shown tab.

@example
<LinkTabs tabs={[{ id: 'students', label: t('Students'), icon: GraduationIcon, count: 3 }]} active={data.tab} />
-->
<script lang="ts">
	import type { Component } from 'svelte';
	import { t } from '#lib/i18n/index.js';
	import Badge from '#lib/components/ui/Badge.svelte';

	/** Props of LinkTabs. */
	export interface Props {
		/** The tabs (id = value of the `tab` query parameter). */
		tabs: { id: string; label: string; icon: Component; count?: number }[];
		/** Id of the shown tab. */
		active: string;
	}

	let { tabs, active }: Props = $props();
</script>

<nav class="-mt-2 flex gap-1 overflow-x-auto border-b border-surface-200-800" aria-label={t('Sections')}>
	{#each tabs as tab (tab.id)}
		{@const current = active === tab.id}
		<a
			aria-current={current ? 'page' : undefined}
			class={[
				'-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
				current
					? 'border-primary-500 text-primary-700-300'
					: 'border-transparent text-surface-600-400 hover:border-surface-300-700 hover:text-surface-900-100'
			]}
			href={`?tab=${tab.id}`}
			data-sveltekit-noscroll
			data-sveltekit-replacestate
			><tab.icon class="size-4" aria-hidden="true" />{tab.label}{#if tab.count !== undefined}<Badge
					tone={current ? 'primary' : 'neutral'}>{tab.count}</Badge
				>{/if}</a
		>
	{/each}
</nav>
