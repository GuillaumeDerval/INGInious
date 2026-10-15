<!--
@component
One-line text input of the `code_single_line` (TASK-03) and `match` (TASK-06)
problems, also used for plugin problem types. The value is sent untrimmed.

Props: `problem` (ProblemData), `value` (string, bindable), `disabled` (boolean).
-->
<script lang="ts">
	import type { ProblemData } from './types.js';

	/** Props of TextProblem. */
	export interface Props {
		/** The problem. */
		problem: ProblemData;
		/** Answer (bindable). */
		value: string;
		/** Disabled while a submission is processed. */
		disabled?: boolean;
	}

	let { problem, value = $bindable(), disabled = false }: Props = $props();
</script>

<input
	class="input font-mono"
	type="text"
	name={problem.id}
	bind:value
	{disabled}
	aria-label={problem.title || problem.id}
/>
