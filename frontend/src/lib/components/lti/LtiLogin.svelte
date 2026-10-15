<!--
@component
LTI-04 login step shown in the LMS iframe while the LMS user is not bound to an
INGInious account (centred AuthCard): the bind page opens in a new tab (normal session, sign-in
possible there) and this page checks regularly whether the binding was done, in
which case its load function redirects to the task (no `window.opener` needed).

Props: `bindUrl` (bind page with a short-lived token), `pollMs` (default 3000).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import LinkIcon from '@lucide/svelte/icons/link';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import AuthCard from '#lib/components/auth/AuthCard.svelte';
	import { t } from '#lib/i18n/index.js';

	/** Props of LtiLogin. */
	export interface Props {
		/** URL of the bind page. */
		bindUrl: string;
		/** Delay between two binding checks, in ms. */
		pollMs?: number;
	}

	let { bindUrl, pollMs = 3000 }: Props = $props();

	onMount(() => {
		const timer = setInterval(() => void invalidateAll(), pollMs);
		return () => clearInterval(timer);
	});
</script>

<AuthCard title={t('Hello!')} subtitle={t('Welcome on the INGInious platform.')} icon={LinkIcon}>
	<p class="text-sm">
		{t('In order to use INGInious via this platform, please bind your existing account or create a new one.')}
	</p>
	<div class="grid gap-2">
		<a class="btn preset-filled-primary-500" href={bindUrl} target="_blank"
			><LinkIcon aria-hidden="true" />{t('Bind your INGInious account')}</a
		>
		<button type="button" class="btn preset-tonal" onclick={() => invalidateAll()}
			><RefreshIcon aria-hidden="true" />{t('Refresh')}</button
		>
	</div>
	{#snippet footer()}{t('This page continues automatically once your account is bound.')}{/snippet}
</AuthCard>
