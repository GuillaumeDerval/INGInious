<!--
@component
Registration page (AUTH-07, AUTH-08): activation button (`activate` token of
the mail link), new password form (valid `reset` link; after a failed reset
the form comes back from the action, the URL then lost its `reset`
parameter), or the registration and lost password (`#lostpasswd`) forms, each
posted to its action; all in centred cards (AuthCard).
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '#lib/i18n/index.js';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import Card from '#lib/components/ui/Card.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import FormField from '#lib/components/ui/FormField.svelte';
	import MailCheckIcon from '@lucide/svelte/icons/mail-check';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import AuthCard from '#lib/components/auth/AuthCard.svelte';
	import PasswordFields from '#lib/components/auth/PasswordFields.svelte';
	import TosCheckbox from '#lib/components/auth/TosCheckbox.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const reset = $derived(form?.reset ?? data.reset);
	const fields = [
		{ name: 'username', label: t('Username (min. 4 alphanumerical characters) :'), type: 'text' },
		{ name: 'realname', label: t('Complete name :'), type: 'text' },
		{ name: 'email', label: t('Email address :'), type: 'email' }
	];
</script>

{#if data.activate}
	<AuthCard title={t('Register')} icon={MailCheckIcon}>
		<form method="POST" action="?/activate" use:enhance={toastEnhance()}>
			<input type="hidden" name="activate" value={data.activate} />
			<button class="btn w-full preset-filled-primary-500">{t('Activate my account')}</button>
		</form>
	</AuthCard>
{:else if reset}
	<AuthCard title={t('Set new password for {} [{}]', reset.realname, reset.username)} icon={KeyIcon}>
		<form method="POST" action="?/resetpasswd" class="space-y-4" use:enhance={toastEnhance()}>
			<input type="hidden" name="reset" value={reset.token} />
			<PasswordFields minLength={data.passwordMinLength} />
			<button class="btn w-full preset-filled-primary-500">{t('Set new password')}</button>
		</form>
	</AuthCard>
{:else}
	<AuthCard
		title={t('Register in INGInious')}
		subtitle={t('Create your account to follow courses and submit your answers.')}
	>
		{#if data.invalidReset}<Alert kind="error">{t('Invalid reset hash.')}</Alert>{/if}
		<form method="POST" action="?/register" class="space-y-4" use:enhance={toastEnhance()}>
			{#each fields as field (field.name)}
				<FormField label={field.label} required>
					{#snippet children(a)}<input {...a} class="input" name={field.name} type={field.type} required />{/snippet}
				</FormField>
			{/each}
			<PasswordFields minLength={data.passwordMinLength} />
			{#if data.tos}<TosCheckbox links={data.tos} />{/if}
			<button class="btn w-full preset-filled-primary-500">{t('Sign up')}</button>
		</form>
		{#snippet footer()}<a class="anchor" href="/signin">{t('Sign in')}</a>{/snippet}
	</AuthCard>
	<section id="lostpasswd" class="mx-auto max-w-md scroll-mt-20 pb-6">
		<Card
			title={t('Lost password ?')}
			description={t('Enter the e-mail address of your account to receive a link to choose a new password.')}
		>
			<form method="POST" action="?/lostpasswd" class="space-y-4" use:enhance={toastEnhance()}>
				<FormField label={t('Email address :')} required>
					{#snippet children(a)}<input {...a} class="input" name="recovery_email" type="email" required />{/snippet}
				</FormField>
				<button class="btn w-full preset-tonal">{t('Reset my password')}</button>
			</form>
		</Card>
	</section>
{/if}
