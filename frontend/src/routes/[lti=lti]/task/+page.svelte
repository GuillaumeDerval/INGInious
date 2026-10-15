<!-- LTI-05 task page inside the LMS iframe (TaskView in LTI mode: `data.actionUrl` is set). -->
<script lang="ts">
	import TaskView from '#lib/components/task/TaskView.svelte';
	let { data }: import('./$types').PageProps = $props();
</script>

<TaskView {data} />
