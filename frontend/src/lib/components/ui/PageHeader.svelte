<!--
@component
Page heading (CORE-01): optional breadcrumbs, title, subtitle and an actions
area. Also sets the document title to "<title> | INGInious".

Props:
- `title` (string): page title.
- `subtitle` (string, optional): line shown under the title.
- `breadcrumbs` (Array<{ label, href? }>, optional): trail; the last entry is the current page.
- `actions` (Snippet, optional): buttons shown at the end of the header.

@example
<PageHeader title={task.name} breadcrumbs={[{ label: course.name, href: `/course/${course.id}` }, { label: task.name }]}>
	{#snippet actions()}<a class="btn preset-tonal" href="edit">Edit</a>{/snippet}
</PageHeader>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { t } from '#lib/i18n/index.js';

	/** One breadcrumb entry; entries without href are rendered as text. */
	export interface Crumb {
		label: string;
		href?: string;
	}

	/** Props of PageHeader. */
	export interface Props {
		/** Page title (also used for the document title). */
		title: string;
		/** Optional subtitle. */
		subtitle?: string;
		/** Breadcrumb trail. */
		breadcrumbs?: Crumb[];
		/** Action buttons. */
		actions?: Snippet;
	}

	let { title, subtitle, breadcrumbs = [], actions }: Props = $props();
</script>

<svelte:head><title>{`${title} | INGInious`}</title></svelte:head>

<header class="mb-6 space-y-2 lg:mb-8">
	{#if breadcrumbs.length}
		<nav aria-label={t('Breadcrumb')}>
			<ol class="flex flex-wrap items-center gap-1 text-[0.8125rem] text-surface-600-400">
				{#each breadcrumbs as crumb, i (i)}
					<li class="flex min-w-0 items-center gap-1">
						{#if i}<ChevronRightIcon class="size-3.5 shrink-0 opacity-60 rtl:rotate-180" aria-hidden="true" />{/if}
						{#if crumb.href && i < breadcrumbs.length - 1}
							<a class="truncate hover:text-primary-600-400 hover:underline" href={crumb.href}>{crumb.label}</a>
						{:else}
							<span class="truncate" aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined}
								>{crumb.label}</span
							>
						{/if}
					</li>
				{/each}
			</ol>
		</nav>
	{/if}
	<div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
		<div class="min-w-0">
			<h1 class="text-2xl font-semibold tracking-tight break-words text-surface-950-50 sm:text-[1.75rem]">{title}</h1>
			{#if subtitle}<p class="mt-1 text-surface-600-400">{subtitle}</p>{/if}
		</div>
		{#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
	</div>
</header>
