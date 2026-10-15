<!--
@component
Autocomplete multi-select (ARIA combobox), e.g. to pick users for groups,
staff or audiences. Suggestions are fetched (debounced) from
`GET <url>?q=<text>`, which must answer a JSON array of `{ value, label }`.
Each selected value is submitted as a hidden input named `name`.

Props:
- `name` (string): form field name (repeated for each value).
- `label` (string): accessible label.
- `url` (string): suggestion endpoint (same-origin, without query string).
- `selected` (Option[], bindable): selected options.
- `multiple` (boolean, default true): when false, choosing replaces the selection.
- `placeholder` (string, optional), `delay` (number, default 250 ms), `minChars` (number, default 2).
-->
<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { t } from '#lib/i18n/index.js';

	/** A selectable option. */
	export interface Option {
		value: string;
		label: string;
	}

	/** Props of SearchSelect. */
	export interface Props {
		/** Form field name. */
		name: string;
		/** Accessible label. */
		label: string;
		/** Suggestion endpoint. */
		url: string;
		/** Selected options (bindable). */
		selected?: Option[];
		/** Allows several values. */
		multiple?: boolean;
		/** Input placeholder. */
		placeholder?: string;
		/** Debounce delay in ms. */
		delay?: number;
		/** Minimal number of characters before searching. */
		minChars?: number;
	}

	let {
		name,
		label,
		url,
		selected = $bindable([]),
		multiple = true,
		placeholder = t('Search...'),
		delay = 250,
		minChars = 2
	}: Props = $props();

	const uid = $props.id();
	let query = $state('');
	let options = $state<Option[]>([]);
	let open = $state(false);
	let active = $state(-1);
	let loading = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** Pending close of the list after the input lost the focus (cancelled if it comes back). */
	let closing: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	/** Suggestions minus the options already selected. */
	const visible = $derived(options.filter((o) => !selected.some((s) => s.value === o.value)));

	/** Fetches suggestions for the current query (previous request aborted). */
	async function search(text: string) {
		controller?.abort();
		controller = new AbortController();
		loading = true;
		try {
			const response = await fetch(`${url}?q=${encodeURIComponent(text)}`, {
				signal: controller.signal
			});
			options = response.ok ? ((await response.json()) as Option[]) : [];
			open = true;
			active = -1;
		} catch {
			// Aborted (a newer query is running) or network error: keep the previous suggestions.
		} finally {
			loading = false;
		}
	}

	/** Debounces the search on input. */
	function oninput() {
		clearTimeout(timer);
		if (query.trim().length < minChars) {
			options = [];
			open = false;
			return;
		}
		timer = setTimeout(() => search(query.trim()), delay);
	}

	/** Adds an option to the selection. */
	function choose(option: Option) {
		clearTimeout(timer);
		selected = multiple ? [...selected, option] : [option];
		query = '';
		options = [];
		open = false;
	}

	/** Removes an option from the selection. */
	function remove(option: Option) {
		selected = selected.filter((s) => s.value !== option.value);
	}

	/** Keyboard support of the combobox pattern. */
	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!visible.length) return;
			open = true;
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + visible.length) % visible.length;
		} else if (event.key === 'Enter' && open && active >= 0) {
			event.preventDefault();
			choose(visible[active]);
		} else if (event.key === 'Escape') {
			open = false;
		} else if (event.key === 'Backspace' && !query && selected.length) {
			remove(selected[selected.length - 1]);
		}
	}
</script>

<div class="relative">
	<label for={uid} class="sr-only">{label}</label>
	<div
		class="input flex min-h-10 flex-wrap items-center gap-1 px-2 py-1 focus-within:ring-2 focus-within:ring-primary-500"
	>
		{#each selected as option (option.value)}
			<span class="chip gap-1 preset-tonal-primary">
				<span>{option.label}</span>
				<button
					type="button"
					class="opacity-70 hover:opacity-100"
					aria-label={t('Remove {}', option.label)}
					onclick={() => remove(option)}
				>
					<XIcon class="size-3" aria-hidden="true" />
				</button>
			</span>
			<input type="hidden" {name} value={option.value} />
		{/each}
		<input
			id={uid}
			class="min-w-32 flex-1 border-0 bg-transparent p-1 text-sm focus:ring-0"
			role="combobox"
			autocomplete="off"
			aria-autocomplete="list"
			aria-expanded={open}
			aria-controls={`${uid}-list`}
			aria-activedescendant={active >= 0 ? `${uid}-${active}` : undefined}
			aria-busy={loading}
			{placeholder}
			bind:value={query}
			{oninput}
			{onkeydown}
			onfocus={() => clearTimeout(closing)}
			onblur={() => (closing = setTimeout(() => (open = false), 150))}
		/>
	</div>
	{#if open}
		<ul
			id={`${uid}-list`}
			role="listbox"
			aria-label={label}
			class="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto card border border-surface-200-800 bg-surface-50-950 p-1 shadow-lg"
		>
			{#each visible as option, i (option.value)}
				<li
					id={`${uid}-${i}`}
					role="option"
					aria-selected={i === active}
					class="cursor-pointer rounded-base px-3 py-1.5 text-sm {i === active
						? 'preset-tonal-primary'
						: 'hover:bg-surface-200-800'}"
					onmousedown={(e) => {
						e.preventDefault();
						choose(option);
					}}
				>
					{option.label}
				</li>
			{:else}
				<li class="px-3 py-1.5 text-sm text-surface-600-400">{t('No result')}</li>
			{/each}
		</ul>
	{/if}
</div>
