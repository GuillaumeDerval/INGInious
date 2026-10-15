<!-- Task page (TASK-01): composed by the TaskView component. -->
<script lang="ts">
	import TaskView from '#lib/components/task/TaskView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<TaskView {data} />
