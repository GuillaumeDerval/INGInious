<!--
@component
Authentication bindings page (AUTH-12): one card per bound method
(identifier, additional fields, refresh and revoke buttons) and a form to add
a binding with one of the other configured methods.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { t } from '#lib/i18n/index.js';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import Card from '#lib/components/ui/Card.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="space-y-4">
	{#each data.bindings as binding (binding.id)}
		<Card title={binding.name}>
			{#snippet actions()}
				{#if binding.configured}
					<form method="POST" action={`/auth/signin/${binding.id}`}>
						<input type="hidden" name="redirect" value="/preferences/bindings" />
						<button class="btn-icon hover:preset-tonal" title={t('Refresh fields')} aria-label={t('Refresh fields')}
							><RefreshIcon class="size-4" /></button
						>
					</form>
				{/if}
				<form method="POST" action="?/revoke" use:enhance={toastEnhance()}>
					<button
						class="btn-icon hover:preset-tonal-error"
						name="revoke_auth_binding"
						value={binding.id}
						title={t('Revoke access')}
						aria-label={t('Revoke access')}><TrashIcon class="size-4" /></button
					>
				</form>
			{/snippet}
			<p class="text-sm">{t('Identifier')}: <code>{binding.identifier}</code></p>
			{#if binding.additional.length}
				<p class="mt-2 text-sm font-semibold">{t('Additional fields')}</p>
				<ul class="text-sm">
					{#each binding.additional as [key, value] (key)}<li>
							<code>{`${binding.id}.${key}`}</code>{` : ${value}`}
						</li>{/each}
				</ul>
			{/if}
		</Card>
	{:else}
		<EmptyState title={t('No authentication binding.')} />
	{/each}
	{#if data.available.length}
		<Card title={t('Add a new binding')}>
			<form method="POST" action="?/add" class="flex flex-wrap gap-2">
				<select class="select max-w-xs" name="auth_binding" aria-label={t('Add a new binding')} required>
					<option value="">{t('Select a authentication binding')}</option>
					{#each data.available as method (method.id)}<option value={method.id}>{method.name}</option>{/each}
				</select>
				<button class="btn preset-filled-primary-500">{t('Add new binding')}</button>
			</form>
		</Card>
	{/if}
</div>
