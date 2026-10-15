<!--
@component
Input of a `code` problem (TASK-02): a CodeMirror editor (language of the
problem, indentation from the user preference, min. 8 lines) whose content is
submitted as the form field named after the problem id.

Props: `problem` (ProblemData), `value` (string, bindable), `disabled` (boolean).
-->
<script lang="ts">
	import CodeEditor from '#lib/components/ui/CodeEditor.svelte';
	import type { ProblemData } from './types.js';

	/** Props of CodeProblem. */
	export interface Props {
		/** The problem. */
		problem: ProblemData;
		/** Code (bindable). */
		value: string;
		/** Read-only while a submission is processed. */
		disabled?: boolean;
	}

	let { problem, value = $bindable(), disabled = false }: Props = $props();
</script>

<CodeEditor
	bind:value
	name={problem.id}
	language={problem.language}
	label={problem.title || problem.id}
	readonly={disabled}
	minLines={8}
/>
