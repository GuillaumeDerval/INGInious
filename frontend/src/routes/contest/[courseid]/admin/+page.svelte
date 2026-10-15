<!--
@component
/contest/<courseid>/admin (SITE-14): "Contest settings" form (two-column fields in a card).
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '#lib/i18n/index.js';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import Card from '#lib/components/ui/Card.svelte';
	import FormField from '#lib/components/ui/FormField.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const s = $derived(data.settings);
	/** Inputs: name, label, value, and the date placeholder or the number type. */
	const fields = $derived([
		['start', t('Contest starts'), s.start, '2014-06-29 10:00:00'],
		['end', t('Contest ends'), s.end, '2014-06-29 15:00:00'],
		['blackout', t('Blackout duration (in hours)'), s.blackout, null],
		['penalty', t('Penalty for wrong submissions (in minutes)'), s.penalty, null]
	] as const);
</script>

<PageHeader
	title={t('Contest settings')}
	subtitle={data.course}
	breadcrumbs={[{ label: data.course, href: `/course/${data.id}` }, { label: t('Contest settings') }]}
/>
<Card
	class="max-w-2xl"
	description={t('The contest start date overrides the accessibility of the tasks of the table of contents.')}
>
	<form method="POST" use:enhance={toastEnhance()} class="space-y-4">
		<label class="flex items-center gap-2 text-sm font-medium"
			><input class="checkbox" type="checkbox" name="enabled" checked={s.enabled} />{t('Enable contest plugin')}</label
		>
		<div class="grid gap-4 sm:grid-cols-2">
			{#each fields as [name, label, value, placeholder] (name)}
				<FormField {label}>
					{#snippet children(a)}<input
							{...a}
							class="input"
							{name}
							{value}
							{placeholder}
							type={placeholder ? 'text' : 'number'}
							min={placeholder ? undefined : 0}
							required={!!placeholder}
						/>{/snippet}
				</FormField>
			{/each}
		</div>
		<div class="flex justify-end"><button class="btn preset-filled-primary-500">{t('Save changes')}</button></div>
	</form>
</Card>
