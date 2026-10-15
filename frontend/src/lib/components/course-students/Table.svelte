<!--
@component
Data-driven searchable, sortable table of the people & results pages
(CSTU-01/04/09/11/16/17), built on the UI kit DataTable. Each column shows
`text(row)` (default `row[key]`), as a link when `href(row)` returns a URL,
or the `custom` snippet for columns flagged `custom`; `numeric` columns are
right-aligned with tabular figures. The search box matches the column values
and the plain fields of the rows (e.g. a username shown under a name).

With `select`, every row gets a checkbox `selected` (value `select(row)`) for the
bulk actions of the enclosing form, plus a "select all" checkbox; while rows are
checked, a tinted bulk action bar shows their count and the `bulk` snippet.

Props:
- `columns` (TableColumn<T>[]): column definitions.
- `rows` (T[]): data.
- `actions` (Snippet<[T]>, optional): row icon buttons (last column).
- `custom` (Snippet<[T, string]>, required with `custom` columns): renders custom cells (row, column key).
- `select` ((row: T) => string, optional): value of the row checkbox.
- `bulk` (Snippet, optional): buttons of the bulk action bar (submit buttons of the enclosing form).
- `searchable` (boolean, default true): shows the search box (client-side; server-paginated
  lists use `SearchForm` instead).
- `limit` (number, optional): rows shown until "Show all" is clicked (long lists stay light).
- `empty` (string, optional): message without rows.

@example
<Table columns={[{ key: 'name', label: t('Task'), href: (r) => `?tasks=${r.id}` }]} rows={tasks} />
-->
<script lang="ts" module>
	/** A column of Table: field `key`, header `label`, optional cell text, link or custom rendering. */
	export interface TableColumn<T> {
		key: string;
		label: string;
		text?: (row: T) => string | number;
		href?: (row: T) => string | null;
		custom?: boolean;
		/** Right-aligned number column. */
		numeric?: boolean;
	}
</script>

<script lang="ts" generics="T extends object">
	import type { Snippet } from 'svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import { t } from '#lib/i18n/index.js';
	import DataTable from '#lib/components/ui/DataTable.svelte';

	/** Props of Table (see the component documentation). */
	interface Props {
		columns: TableColumn<T>[];
		rows: T[];
		actions?: Snippet<[T]>;
		custom?: Snippet<[T, string]>;
		select?: (row: T) => string;
		bulk?: Snippet;
		searchable?: boolean;
		limit?: number;
		empty?: string;
	}

	let { columns, rows, actions, custom, select, bulk, searchable = true, limit, empty }: Props = $props();
	let query = $state('');
	/** True once "Show all" was clicked. */
	let expanded = $state(false);
	/** Values of the checked rows (posted as `selected`). */
	let selected = $state<string[]>([]);
	/** Cell value of a column. */
	const value = (c: TableColumn<T>, r: T) => (c.text ? c.text(r) : (r as Record<string, string | number>)[c.key]);
	/** Lower-cased text searched for a row: its column values and its own string/number fields. */
	const haystack = (r: T) =>
		[...columns.map((c) => value(c, r)), ...Object.values(r).filter((v) => typeof v !== 'object')]
			.join('\u0000')
			.toLowerCase();
	const matching = $derived(rows.filter((r) => haystack(r).includes(query.trim().toLowerCase())));
	const shown = $derived(limit && !expanded ? matching.slice(0, limit) : matching);
	/** Values of the shown rows (only read by the selection controls, i.e. with `select`). */
	const all = $derived(shown.map(select!));
	const allChecked = $derived(all.length > 0 && all.every((v) => selected.includes(v)));
	const headers = $derived([
		...(select ? [{ key: '', label: '', class: 'w-10' }] : []),
		...columns.map((c) => ({
			key: c.key,
			label: c.label,
			value: (r: T) => value(c, r),
			class: c.numeric ? 'text-end' : undefined
		})),
		...(actions ? [{ key: ' ', label: '', class: 'w-px' }] : [])
	]);
</script>

{#if rows.length && (searchable || select)}
	<div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
		{#if searchable}
			<div class="relative w-full sm:max-w-xs">
				<SearchIcon
					class="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-surface-500"
					aria-hidden="true"
				/>
				<input
					class="input ps-9!"
					type="search"
					placeholder={t('Search...')}
					aria-label={t('Search')}
					bind:value={query}
				/>
			</div>
		{/if}
		{#if select}
			<label class="flex items-center gap-2 text-sm text-surface-700-300">
				<input
					type="checkbox"
					class="checkbox"
					checked={allChecked}
					indeterminate={selected.length > 0 && !allChecked}
					onchange={(e) => (selected = e.currentTarget.checked ? all : [])}
				/>{t('Select all')}
			</label>
		{/if}
	</div>
	{#if select && selected.length}
		<!-- Bulk action bar: count of the checked rows, their actions, and a way to clear the selection. -->
		<div
			class="mb-3 flex flex-wrap items-center gap-2 rounded-base bg-primary-500/10 px-3 py-2 ring-1 ring-primary-500/25 ring-inset"
			role="toolbar"
			aria-label={t('Bulk actions')}
		>
			<span class="me-auto text-sm font-medium text-primary-700-300 tabular-nums"
				>{t('{} selected', selected.length)}</span
			>
			{@render bulk?.()}
			<button
				type="button"
				class="btn-icon text-primary-700-300 hover:bg-primary-500/15"
				title={t('Clear selection')}
				aria-label={t('Clear selection')}
				onclick={() => (selected = [])}><XIcon /></button
			>
		</div>
	{/if}
{/if}
<DataTable columns={headers} rows={shown} empty={query && rows.length ? t('Nothing matches your search.') : empty}>
	{#snippet row(r)}
		<tr>
			{#if select}<td
					><input
						type="checkbox"
						class="checkbox"
						name="selected"
						value={select(r)}
						aria-label={t('Select')}
						bind:group={selected}
					/></td
				>{/if}
			{#each columns as c (c.key)}
				<td class={c.numeric ? 'text-end tabular-nums' : undefined}>
					{#if c.custom}{@render custom!(r, c.key)}
					{:else if c.href?.(r)}<a class="font-medium text-primary-700-300 hover:underline" href={c.href(r)}
							>{value(c, r)}</a
						>
					{:else}{value(c, r) ?? '—'}{/if}
				</td>
			{/each}
			{#if actions}<td><div class="flex justify-end gap-0.5">{@render actions(r)}</div></td>{/if}
		</tr>
	{/snippet}
</DataTable>
{#if shown.length < matching.length}
	<button type="button" class="mt-2 btn btn-sm hover:preset-tonal" onclick={() => (expanded = true)}
		>{t('Show all ({})', matching.length)}</button
	>
{/if}
