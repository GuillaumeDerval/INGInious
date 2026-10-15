<!--
@component
Submission query form (CSTU-11, also used by the statistics CSTU-17): GET
form collapsed by default (its summary counts the active filters) with the
checkbox lists, most used first (students, tasks, audiences, categories; nothing
checked = everything) with All/None/"Tutored only" shortcuts, and the collapsed
advanced options (flags, grade and date bounds, sort or statistics mode, limit).
Lists too long to be sent with the page (named in `options.search`: thousands of
students or tasks) are server-searched pickers (SearchSelect on
`/admin/<courseid>/submissions/options/<list>`) with None/"Tutored only" shortcuts.

Props:
- `query` (QueryValues): current sanitised query (checked values, field values).
- `options` (Record<list name, QueryOption[]> & { search: list names }): choices of the
  lists (searched lists: the selected and tutored choices only).
- `stats` (boolean, default false): statistics variant (`stat` instead of sorting, no display flags).
-->
<script lang="ts" module>
	/** A choice of a list (`mine`: tutored by the viewer). */
	export interface QueryOption {
		value: string;
		label: string;
		mine?: boolean;
	}
	/** Values of the query fields. */
	export type QueryValues = Record<string, string[] | string | number | boolean | null>;
	/** A choice list of the form. */
	export type ListName = 'users' | 'audiences' | 'tasks' | 'org_categories';
</script>

<script lang="ts">
	import ChevronIcon from '@lucide/svelte/icons/chevron-right';
	import FilterIcon from '@lucide/svelte/icons/list-filter';
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import SearchSelect from '#lib/components/ui/SearchSelect.svelte';

	/** Props of QueryForm. */
	export interface Props {
		query: QueryValues;
		options: Record<ListName, QueryOption[]> & { search: ListName[] };
		stats?: boolean;
	}

	let { query, options, stats = false }: Props = $props();
	let form: HTMLFormElement;
	const lists: [ListName, string][] = [
		['users', t('Students')],
		['tasks', t('Tasks')],
		['audiences', t('Audiences')],
		['org_categories', t('Categories')]
	];
	/** Selection of the searched lists (unknown values keep their value as label), reset by a new query. */
	let picked = $derived(
		Object.fromEntries(
			lists.map(([name]) => [
				name,
				(query[name] as string[]).map((v) => options[name].find((o) => o.value === v) ?? { value: v, label: v })
			])
		) as Record<ListName, QueryOption[]>
	);
	/** Number of active filters (shown on the collapsed panel). */
	const active = $derived(
		lists.filter(([name]) => (query[name] as string[]).length).length +
			['grade_min', 'grade_max', 'date_after', 'date_before', 'eval', 'crashes_only'].filter(
				(k) => query[k] !== null && query[k] !== '' && query[k] !== false && query[k] !== undefined
			).length
	);
	const flags = $derived([
		...(stats ? [] : [['eval', t('Only evaluation submissions')]]),
		['crashes_only', t('Only timeouts and crashes')],
		...(stats
			? []
			: [
					['show_tags', t('Show Tags')],
					['show_id', t('Show submission id')],
					['show_task_name', t('Show task name')],
					['show_stud_name', t('Show student name')]
				])
	]);
	const inputs = $derived([
		['grade_min', t('Minimum grade'), 'number'],
		['grade_max', t('Maximum grade'), 'number'],
		['date_after', t('Submitted after'), 'text'],
		['date_before', t('Submitted before'), 'text'],
		['limit', stats ? t('Limit') : t('Submissions per page'), 'number']
	]);
	const selects: [string, string, string[][]][] = $derived(
		stats
			? [
					[
						'stat',
						t('Statistics'),
						[
							['normal', t('Normal statistics')],
							['pond_stat', t('Weighted statistics')]
						]
					]
				]
			: [
					[
						'sort_by',
						t('Sort by'),
						[
							['submitted_on', t('Submitted on')],
							['username', t('User')],
							['grade', t('Grade')],
							['taskid', t('Task id')]
						]
					],
					[
						'order',
						t('Order'),
						[
							['0', t('Descending')],
							['1', t('Ascending')]
						]
					]
				]
	);

	const shortcuts = [
		['all', t('All')],
		['none', t('None')],
		['mine', t('Tutored only')]
	] as const;
	/** Shortcuts of a list: "Tutored only" when it has tutored choices, no "All" for searched lists (none = all). */
	const shortcutsOf = (name: ListName) =>
		shortcuts.filter(
			([w]) => (w !== 'mine' || options[name].some((o) => o.mine)) && (w !== 'all' || !options.search.includes(name))
		);
	/** Checks all, none or the tutored choices of a list. */
	function check(name: ListName, which: 'all' | 'none' | 'mine') {
		if (options.search.includes(name))
			return void (picked = { ...picked, [name]: which === 'mine' ? options[name].filter((o) => o.mine) : [] });
		form
			.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)
			.forEach((el, i) => (el.checked = which === 'all' || (which === 'mine' && !!options[name][i].mine)));
	}
</script>

<details class="group panel">
	<summary class="flex list-none items-center gap-2 px-4 py-3 text-sm font-semibold sm:px-5">
		<ChevronIcon
			class="size-4 text-surface-500 transition-transform group-open:rotate-90 rtl:rotate-180"
			aria-hidden="true"
		/>
		<FilterIcon class="size-4 text-surface-500" aria-hidden="true" />{t('Filters')}
		{#if active}<Badge tone="primary">{t('{} active', active)}</Badge>{/if}
	</summary>
	<form method="GET" bind:this={form} class="space-y-5 border-t border-surface-200-800 px-4 py-4 sm:px-5">
		<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
			{#each lists as [name, label] (name)}
				<fieldset class="min-w-0 space-y-1.5">
					<div class="flex flex-wrap items-center justify-between gap-x-2">
						<legend class="float-start label-text">{label}</legend>
						<div class="flex gap-0.5">
							{#each shortcutsOf(name) as [which, text] (which)}<button
									type="button"
									class="rounded-base px-1.5 py-0.5 text-xs font-medium text-primary-700-300 hover:bg-primary-500/10"
									aria-label={`${text} (${label})`}
									onclick={() => check(name, which)}>{text}</button
								>{/each}
						</div>
					</div>
					{#if options.search.includes(name)}
						<SearchSelect
							{name}
							{label}
							url={`/admin/${page.params.courseid}/submissions/options/${name}`}
							bind:selected={() => picked[name], (v) => (picked = { ...picked, [name]: v })}
							minChars={1}
						/>
					{:else}<div
							class="max-h-44 space-y-0.5 overflow-y-auto rounded-base border border-surface-200-800 bg-surface-50-950 p-1.5 text-sm"
						>
							{#each options[name] as o (o.value)}
								<label class="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-surface-100-900"
									><input
										type="checkbox"
										class="checkbox"
										{name}
										value={o.value}
										checked={(query[name] as string[]).includes(o.value)}
									/><span class="truncate">{o.label}</span></label
								>
							{:else}<p class="px-1.5 py-1 text-surface-600-400">{t('Nothing to show.')}</p>{/each}
						</div>{/if}
				</fieldset>
			{/each}
		</div>
		<details class="group/adv">
			<summary class="flex list-none items-center gap-1.5 text-sm font-medium text-surface-700-300">
				<ChevronIcon class="size-4 transition-transform group-open/adv:rotate-90 rtl:rotate-180" aria-hidden="true" />
				{t('Advanced query')}
			</summary>
			<div class="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each inputs as [name, label, type] (name)}<label class="label"
						><span class="label-text">{label}</span><input
							class="input"
							{name}
							{type}
							value={query[name] ?? ''}
							placeholder={type === 'text' ? '2014-06-29 10:00' : undefined}
						/></label
					>{/each}
				{#each selects as [name, label, choices] (name)}
					<label class="label"
						><span class="label-text">{label}</span>
						<select class="select" {name}
							>{#each choices as [value, text] (value)}<option {value} selected={String(query[name]) === value}
									>{text}</option
								>{/each}</select
						>
					</label>
				{/each}
				<div class="space-y-2 sm:col-span-2 lg:col-span-3">
					{#each flags as [name, label] (name)}<label class="me-5 inline-flex items-center gap-2 text-sm"
							><input type="checkbox" class="checkbox" {name} checked={!!query[name]} />{label}</label
						>{/each}
				</div>
			</div>
		</details>
		<div class="flex justify-end gap-2 border-t border-surface-200-800 pt-4">
			<a class="btn hover:preset-tonal" href="?">{t('Reset')}</a><button class="btn preset-filled-primary-500"
				><FilterIcon aria-hidden="true" />{t('Filter')}</button
			>
		</div>
	</form>
</details>
