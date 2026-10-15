<!--
@component
Pagination of a server-paginated list ("‹ 3 / 12 ›"): links to the previous and
next pages (hidden at the ends) around the current position. Page and page count
come from the server (lib/server/pagination.ts `pageSlice`); `href` builds the URL
of a page, usually with `withQuery(page.url, { page: p })` (lib/utils/url.ts) so
that filters are kept. Nothing is shown for a single page.

Props:
- `page` (number), `pages` (number): current page (1-based) and number of pages.
- `href` ((page: number) => string): URL of a page.
-->
<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { t } from '#lib/i18n/index.js';

	/** Props of Pager. */
	export interface Props {
		/** Current page (1-based). */
		page: number;
		/** Number of pages. */
		pages: number;
		/** URL of a page. */
		href: (page: number) => string;
	}

	let { page, pages, href }: Props = $props();
</script>

{#if pages > 1}
	<nav class="flex items-center justify-center gap-3 text-sm" aria-label={t('Pagination')}>
		{#if page > 1}<a
				class="btn-icon preset-tonal"
				href={href(page - 1)}
				title={t('Previous')}
				aria-label={t('Previous')}><ChevronLeftIcon class="size-4 rtl:rotate-180" aria-hidden="true" /></a
			>{/if}
		<span class="text-surface-600-400 tabular-nums">{`${page} / ${pages}`}</span>
		{#if page < pages}<a class="btn-icon preset-tonal" href={href(page + 1)} title={t('Next')} aria-label={t('Next')}
				><ChevronRightIcon class="size-4 rtl:rotate-180" aria-hidden="true" /></a
			>{/if}
	</nav>
{/if}
