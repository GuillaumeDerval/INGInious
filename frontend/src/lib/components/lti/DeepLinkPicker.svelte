<!--
@component
LTI-10 deep-linking task picker: the LTI courses administered by the bound user
and their tasks; after selection, the signed response returned by the form
action is posted (auto-submitted form) to the platform return URL.

Props: `courses` ({id, name, tasks: {id, name}[]}[]), `response` (action result:
`{url, jwt}` or `{message}`, null before submission).
-->
<script lang="ts">
	import Card from '#lib/components/ui/Card.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import FormField from '#lib/components/ui/FormField.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import { t } from '#lib/i18n/index.js';

	/** Props of DeepLinkPicker. */
	export interface Props {
		/** Selectable courses with their tasks. */
		courses: { id: string; name: string; tasks: { id: string; name: string }[] }[];
		/** Result of the selection. */
		response?: { url: string; jwt: string } | { message?: string } | null;
	}

	let { courses, response = null }: Props = $props();
	let courseid = $state('');
	let taskid = $state('');
	let returnForm = $state<HTMLFormElement>();
	const tasks = $derived(courses.find((c) => c.id === courseid)?.tasks ?? []);
	const signed = $derived(response && 'jwt' in response ? response : null);

	$effect(() => {
		if (signed) returnForm?.submit();
	});
</script>

<PageHeader title={t('Task picker')} subtitle={t('Choose the task to add to your LMS course.')} />
{#if !courses.length}
	<EmptyState
		title={t('No LTI course available')}
		description={t('Only the administrators of an LTI course can add its tasks to the platform.')}
	/>
{:else}
	<Card class="max-w-lg">
		<!-- Plain POST (no enhance): the page reloaded with the response submits it at once. -->
		<form method="POST" class="space-y-4">
			<FormField label={t('Course')}>
				{#snippet children(a)}<select
						{...a}
						class="select"
						name="courseid"
						bind:value={courseid}
						onchange={() => (taskid = '')}
					>
						<option value="">{t('-- Select a course --')}</option>
						{#each courses as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
					</select>{/snippet}
			</FormField>
			<FormField label={t('Task')}>
				{#snippet children(a)}<select {...a} class="select" name="taskid" bind:value={taskid} disabled={!tasks.length}>
						<option value=""
							>{courseid && !tasks.length ? t('-- No task available --') : t('-- Select a task --')}</option
						>
						{#each tasks as task (task.id)}<option value={task.id}>{task.name}</option>{/each}
					</select>{/snippet}
			</FormField>
			<div class="flex justify-end">
				<button type="submit" class="btn preset-filled-primary-500" disabled={!taskid}>{t('Select')}</button>
			</div>
		</form>
	</Card>
{/if}
{#if signed}
	<form bind:this={returnForm} method="POST" action={signed.url}>
		<input type="hidden" name="JWT" value={signed.jwt} />
	</form>
{/if}
