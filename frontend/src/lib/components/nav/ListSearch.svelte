<!--
@component
Search box of the server-paginated lists (course grids, NAV-01/02): a GET form
with a `q` field, submitted when the user stops typing (300 ms) or presses
Enter. SvelteKit turns the submission into a client-side navigation that keeps
the focus, the scroll position and the history entry, so the list filters as
you type while staying bookmarkable; the page number is reset. The field is
only initialised from `value` (`defaultValue`), so that an answer arriving
while the user keeps typing never overwrites his text.

Props:
- `value` (string): current search (from the URL).
- `label` (string): accessible label and placeholder.
- `params` (Record<string, string>, optional): other query parameters to keep (e.g. a filter).
-->
<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';

	/** Props of ListSearch. */
	export interface Props {
		/** Current search. */
		value: string;
		/** Accessible label and placeholder. */
		label: string;
		/** Query parameters kept by the search. */
		params?: Record<string, string>;
	}

	let { value, label, params = {} }: Props = $props();
	let timer: ReturnType<typeof setTimeout> | undefined;
</script>

<form
	class="relative w-full sm:w-80"
	role="search"
	data-sveltekit-keepfocus
	data-sveltekit-noscroll
	data-sveltekit-replacestate
	onsubmit={() => clearTimeout(timer)}
>
	{#each Object.entries(params).filter(([, v]) => v) as [name, v] (name)}<input type="hidden" {name} value={v} />{/each}
	<SearchIcon class="absolute start-3 top-2.5 size-4 text-surface-500" aria-hidden="true" />
	<input
		class="input ps-9!"
		type="search"
		name="q"
		defaultValue={value}
		placeholder={label}
		aria-label={label}
		oninput={(e) => {
			const form = e.currentTarget.form!;
			clearTimeout(timer);
			timer = setTimeout(() => form.requestSubmit(), 300);
		}}
	/>
</form>
