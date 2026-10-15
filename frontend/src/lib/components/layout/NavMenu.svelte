<!--
@component
Vertical navigation menu rendering a typed navigation model (CORE-01).
The active item (longest href matching `currentPath`, or `active: true`) gets
`aria-current="page"` and a highlighted style (white "pill"). Sections with a
`context` subtitle are rendered as a context header card (e.g. the course being
administered) instead of a group of links.

Props:
- `sections` (NavSection[]): groups of links, each with an optional title.
- `currentPath` (string): path of the current page, used to compute the active item.
- `label` (string, optional): accessible name of the `<nav>` landmark.

@example
<NavMenu sections={[{ title: 'Course', items: [{ label: 'Tasks', href: '/course/x' }] }]} currentPath="/course/x" />
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import { activeHref, type NavItem, type NavSection } from './nav.js';

	/** Props of NavMenu. */
	export interface Props {
		/** Groups of links to render. */
		sections: NavSection[];
		/** Path of the current page. */
		currentPath: string;
		/** Accessible name of the navigation landmark. */
		label?: string;
	}

	let { sections, currentPath, label = t('Main menu') }: Props = $props();

	const best = $derived(activeHref(sections, currentPath));
	const isActive = (item: NavItem) => item.active ?? item.href === best;
</script>

{#snippet items(list: NavItem[])}
	<ul class="space-y-0.5">
		{#each list as item (item.href + item.label)}
			{@const active = isActive(item)}
			<li>
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					class={[
						'group flex items-center gap-2.5 rounded-base px-2.5 py-1.5 text-sm transition-colors',
						active
							? 'border-s-3 border-secondary-400 bg-surface-50-950 font-semibold text-primary-700-300 shadow-xs ring-1 ring-surface-200-800'
							: 'text-surface-700-300 hover:bg-surface-200-800/60 hover:text-surface-950-50'
					]}
				>
					{#if item.icon}<item.icon
							class={['size-4 shrink-0', active ? 'text-primary-600-400' : 'text-surface-500']}
							aria-hidden="true"
						/>{/if}
					<span class="flex-1 truncate">{item.label}</span>
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

<nav aria-label={label} class="space-y-6">
	{#each sections as section, i (i)}
		{#if section.context}
			<!-- Context header: the object the following sections act on (e.g. a course). -->
			<a
				href={section.contextHref}
				class="flex items-center gap-3 panel rounded-container px-3 py-2.5 hover:border-primary-300-700"
			>
				<span
					class="grid size-8 shrink-0 place-items-center rounded-base bg-secondary-300 text-sm font-bold text-secondary-950"
					aria-hidden="true">{String(section.title).replace(/^\W+/, '').charAt(0).toUpperCase()}</span
				>
				<span class="min-w-0">
					<h2 class="truncate text-sm font-semibold" title={section.title}>{section.title}</h2>
					<span class="block truncate text-xs text-surface-600-400">{section.context}</span>
				</span>
			</a>
		{:else if section.items.length}
			<div>
				{#if section.title}
					<h2 class="mb-1.5 truncate px-2.5 text-xs font-medium text-surface-500" title={section.title}>
						{section.title}
					</h2>
				{/if}
				{@render items(section.items)}
			</div>
		{/if}
	{/each}
</nav>
