<!--
@component
Choices of a `multiple_choice` problem (TASK-05): radios (single answer) or
checkboxes (multiple answers) as selectable rows (highlighted when checked), in the order computed by the server (legacy
shuffle/limit per user). Values are the choice indexes as strings.

Props: `problem` (ProblemData), `value` (string | string[], bindable), `disabled` (boolean).
-->
<script lang="ts">
	import RichText from '#lib/components/common/RichText.svelte';
	import type { ProblemData } from './types.js';

	/** Props of ChoiceProblem. */
	export interface Props {
		/** The problem. */
		problem: ProblemData;
		/** Selected index (single) or indexes (multiple), bindable. */
		value: string | string[];
		/** Disabled while a submission is processed. */
		disabled?: boolean;
	}

	let { problem, value = $bindable(), disabled = false }: Props = $props();
	const selected = $derived(Array.isArray(value) ? value : [value]);

	/** Updates the value when a choice is (un)ticked. */
	function toggle(index: string, checked: boolean) {
		if (!problem.multiple) value = index;
		else value = checked ? [...selected, index] : selected.filter((v) => v !== index);
	}
</script>

<fieldset class="space-y-2" {disabled}>
	<legend class="sr-only">{problem.title || problem.id}</legend>
	{#each problem.choices! as choice (choice.index)}
		<label
			class="flex cursor-pointer items-start gap-3 rounded-base border border-surface-200-800 px-3.5 py-2.5 transition-colors hover:border-primary-300-700 has-checked:border-primary-500 has-checked:bg-primary-500/6"
		>
			<input
				class={problem.multiple ? 'mt-0.5 checkbox' : 'mt-0.5 radio'}
				type={problem.multiple ? 'checkbox' : 'radio'}
				name={problem.id}
				value={String(choice.index)}
				checked={selected.includes(String(choice.index))}
				onchange={(e) => toggle(String(choice.index), e.currentTarget.checked)}
			/>
			<RichText html={choice.html} class="prose-sm min-w-0 flex-1" />
		</label>
	{/each}
</fieldset>
