<!--
@component
Profile page (AUTH-11), posted to the default action: username (editable
only while empty), real name, e-mail (read only), language, timezone, code
indentation, password change (`allow_registration`) and terms of service
checkbox, with the warnings of incomplete accounts (no username yet, terms
of service not accepted).
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { t, LANGUAGES } from '#lib/i18n/index.js';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import Card from '#lib/components/ui/Card.svelte';
	import FormField from '#lib/components/ui/FormField.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import PasswordFields from '#lib/components/auth/PasswordFields.svelte';
	import TosCheckbox from '#lib/components/auth/TosCheckbox.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const profile = $derived(data.profile);
	const zones = $derived([...new Set([profile.timezone, ...Intl.supportedValuesOf('timeZone')])].sort());
	const indents = { '2': t('2 spaces'), '3': t('3 spaces'), '4': t('4 spaces'), tabs: t('tabs') };
	/** Text inputs: the username is only editable (and posted) while empty, the e-mail never. */
	const inputs = $derived([
		{
			name: profile.username ? undefined : 'username',
			label: t('Username :'),
			value: profile.username,
			disabled: !!profile.username
		},
		{ name: undefined, label: t('Email address :'), value: profile.email, disabled: true },
		{ name: 'realname', label: t('Complete name :'), value: profile.realname, disabled: false }
	]);
	const selects = $derived([
		{ name: 'language', label: t('Language :'), value: profile.language, options: Object.entries(LANGUAGES) },
		{ name: 'timezone', label: t('Timezone :'), value: profile.timezone, options: zones.map((z) => [z, z]) },
		{
			name: 'code_indentation',
			label: t('Code indentation :'),
			value: profile.codeIndentation,
			options: Object.entries(indents)
		}
	]);
</script>

<div class="mb-4 space-y-2">
	{#if !data.profile.username}<Alert kind="warning">{t('Please set a new username')}</Alert>{/if}
	{#if data.tos && !data.tosSigned}<Alert kind="warning"
			>{t('Please accept the Terms of Service and Data Privacy')}</Alert
		>{/if}
</div>

{#key data.profile}
	<form method="POST" class="space-y-6" use:enhance={toastEnhance()}>
		<Card>
			<div class="grid gap-4 md:grid-cols-2">
				{#each inputs as input (input.label)}
					<FormField label={input.label}>
						{#snippet children(a)}<input
								{...a}
								class="input"
								name={input.name}
								value={input.value}
								disabled={input.disabled}
								required
							/>{/snippet}
					</FormField>
				{/each}
				{#each selects as select (select.name)}
					<FormField label={select.label}>
						{#snippet children(a)}<select {...a} class="select" name={select.name} value={select.value}
								>{#each select.options as [value, label] (value)}<option {value}>{label}</option>{/each}</select
							>{/snippet}
					</FormField>
				{/each}
			</div>
		</Card>
		{#if data.passwords}
			<Card title={t('Password')}>
				<div class="grid gap-4 md:grid-cols-3">
					{#if profile.hasPassword}
						<FormField label={t('Old password :')}>
							{#snippet children(a)}<input
									{...a}
									class="input"
									type="password"
									name="oldpasswd"
									autocomplete="current-password"
								/>{/snippet}
						</FormField>
					{/if}
					<PasswordFields required={false} newPassword minLength={data.passwordMinLength} />
				</div>
			</Card>
		{/if}
		{#if data.tos}<TosCheckbox links={data.tos} checked={data.tosSigned} />{/if}
		<button class="btn preset-filled-primary-500">{t('Save my profile')}</button>
	</form>
{/key}
