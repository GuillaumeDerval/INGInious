<!--
@component
LTI-04 account binding confirmation (normal session, opened in a new tab from
the LMS iframe): shows the INGInious account and the LMS tool/context/user that
will be bound (key/value list in a centred AuthCard), with a CSRF-protected form; after success, tells the user to go
back to the LMS (the iframe detects the binding by itself).

Props: `user`, `lti` (tool and LMS user fields), `bound`, `message` (error).
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { busyEnhance } from '#lib/components/layout/toaster.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import LinkIcon from '@lucide/svelte/icons/link';
	import AuthCard from '#lib/components/auth/AuthCard.svelte';
	import { t } from '#lib/i18n/index.js';

	/** Props of LtiBind. */
	export interface Props {
		/** The signed-in INGInious account. */
		user: { username: string; realname: string };
		/** LMS side of the binding. */
		lti: {
			tool_name?: string;
			tool_description?: string;
			tool_url?: string;
			context_label?: string;
			context_title?: string;
			username: string;
			realname: string;
		};
		/** True once the binding is done. */
		bound?: boolean;
		/** Error message of the last attempt. */
		message?: string | null;
	}

	let { user, lti, bound = false, message = null }: Props = $props();
	const rows = $derived([
		[t('Tool name'), lti.tool_name],
		[t('Tool description'), lti.tool_description],
		[t('Tool URL'), lti.tool_url],
		[t('Tool context'), `${lti.context_label} - ${lti.context_title}`],
		[t('Tool identifiers'), `${lti.username} - ${lti.realname}`]
	]);
</script>

<AuthCard title={t('Binding to an existing LMS')} icon={LinkIcon} wide>
	{#if bound}
		<Alert kind="success">{t('Your account is now bound. You can close this window and go back to your LMS.')}</Alert>
	{:else}
		{#if message}<Alert kind="error">{message}</Alert>{/if}
		<p class="text-sm">
			{t('You are going to bind your INGInious account')} <b>{`${user.realname} [${user.username}]`}</b>
			{t('with the following LTI tool and context:')}
		</p>
		<dl class="kv rounded-base bg-surface-100-900 p-4">
			{#each rows as [label, value] (label)}<dt>{label}</dt>
				<dd>{value}</dd>{/each}
		</dl>
		<Alert kind="warning"
			>{t('This operation cannot be undone.')}
			{t('Only continue if you opened this page yourself from your LMS.')}</Alert
		>
		<form method="POST" use:enhance={busyEnhance()} class="flex flex-wrap justify-end gap-2">
			<button type="button" class="btn preset-tonal" onclick={() => window.close()}>{t('Cancel')}</button>
			<button type="submit" class="btn preset-filled-primary-500">{t('Bind my account')}</button>
		</form>
	{/if}
</AuthCard>
