<!--
@component
Generic data table: column headers (optionally sortable on the client),
rows rendered by a snippet and an empty state. Sorting only happens on a
header click (the server renders the rows in their given order), so the
sorting code never runs, nor ships, on the server.

Props:
- `columns` (Column<T>[]): headers; columns with a `value` getter are sortable on it.
- `rows` (T[]): data.
- `row` (Snippet<[T, number]>): renders one `<tr>` for a row (and its index in `rows`).
- `empty` (string, optional): message when there is no row.

@example
<DataTable columns={[{ key: 'name', label: t('Name'), value: (u) => u.name }]} rows={users}>
	{#snippet row(u)}<tr><td>{u.name}</td></tr>{/snippet}
</DataTable>
-->
<script lang="ts" module>
	/** Column of a DataTable. */
	export interface Column<T> {
		/** Identifier (and default sort field `row[key]`). */
		key: string;
		/** Header text. */
		label: string;
		/** Sort value of a row: the column is sortable when it is given. */
		value?: (row: T) => Sortable;
		/** Extra classes for the header cell (e.g. alignment, width). */
		class?: string;
	}

	/** Sort value of a cell (booleans sort as numbers, e.g. "evaluated" flags). */
	type Sortable = string | number | boolean | null | undefined;

	/** True for the empty values (null, undefined, ""), which sort last. */
	const blank = (v: Sortable) => v == null || v === '';

	/** Compares two cell values of a column: strings naturally, other values numerically, empty values last. */
	export function compareValues(a: Sortable, b: Sortable): number {
		if (blank(a) || blank(b)) return Number(blank(a)) - Number(blank(b));
		return typeof a === 'string' ? a.localeCompare(String(b), undefined, { numeric: true }) : Number(a) - Number(b);
	}
</script>

<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import { t } from '#lib/i18n/index.js';
	import EmptyState from './EmptyState.svelte';

	/** Props of DataTable (not exported: generic components cannot export types). */
	interface Props {
		/** Column definitions. */
		columns: Column<T>[];
		/** Rows. */
		rows: T[];
		/** Renders one row. */
		row: Snippet<[T, number]>;
		/** Message shown when there is no row. */
		empty?: string;
	}

	let { columns, rows, row, empty = t('Nothing to show.') }: Props = $props();

	/** A row with its index in `rows`. */
	type Indexed = { r: T; i: number };

	let sortKey = $state<string | null>(null);
	let ascending = $state(true);
	/** Order of the rows: set by `sortBy`, keeps the given order (stable sort) until then. */
	let order = $state<(x: Indexed, y: Indexed) => number>(() => 0);

	/** Rows with their original index, sorted by the active column. */
	const sorted = $derived(rows.map((r, i) => ({ r, i })).sort(order));

	/** Icon of a sortable header per `aria-sort` state. */
	const SORT_ICONS = { none: ArrowUpDownIcon, ascending: ArrowUpIcon, descending: ArrowDownIcon };

	/** `aria-sort` state of a sortable column. */
	const ariaSort = (key: string) => (sortKey !== key ? 'none' : ascending ? 'ascending' : 'descending');

	/** Sorts by a (sortable) column, or reverses the order when it is already the sort column. */
	function sortBy(column: Column<T>) {
		ascending = sortKey === column.key ? !ascending : true;
		sortKey = column.key;
		const get = column.value!;
		const direction = ascending ? 1 : -1;
		order = (x, y) => compareValues(get(x.r), get(y.r)) * direction;
	}
</script>

{#if rows.length === 0}
	<EmptyState title={empty} />
{:else}
	<div class="table-wrap overflow-x-auto panel">
		<table class="table">
			<thead>
				<tr>
					{#each columns as column (column.key)}
						{@const sort = column.value ? ariaSort(column.key) : undefined}
						<th class={column.class} scope="col" aria-sort={sort}>
							{#if sort}
								{@const Icon = SORT_ICONS[sort]}
								<button
									type="button"
									class="inline-flex items-center gap-1 font-semibold"
									onclick={() => sortBy(column)}
								>
									{column.label}
									<Icon class={['size-3.5', sort === 'none' && 'opacity-50']} aria-hidden="true" />
								</button>
							{:else}
								{column.label}
							{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each sorted as item (item.i)}
					{@render row(item.r, item.i)}
				{/each}
			</tbody>
		</table>
	</div>
{/if}
