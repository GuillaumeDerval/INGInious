<!--
@component
/taskless_hello_world (SITE-21): "Input your name" form running the taskless
job, then its result badge and feedback (shown as text) under the form.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '#lib/i18n/index.js';
	import { busyEnhance } from '#lib/components/layout/toaster.js';
	import Card from '#lib/components/ui/Card.svelte';
	import FormField from '#lib/components/ui/FormField.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import ResultBadge from '#lib/components/ui/ResultBadge.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<PageHeader title={t('Taskless job - basic Hello World')} />
<Card class="max-w-lg">
	<form method="POST" class="space-y-4" use:enhance={busyEnhance()}>
		<FormField label={t('Input your name')}>
			{#snippet children(a)}<input {...a} class="input" name="name" required />{/snippet}
		</FormField>
		<button class="btn preset-filled-primary-500">{t('Run Job')}</button>
	</form>
	{#if form}<div
			class="mt-5 flex flex-wrap items-center gap-2 rounded-base bg-surface-100-900 px-4 py-3 text-sm"
			role="status"
		>
			<ResultBadge result={form.result} />{form.feedback}
		</div>{/if}
</Card>
