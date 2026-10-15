<!--
@component
Sign-in page (AUTH-05): centred card with the sign-in form and, when
self-registration is allowed, a link to create an account.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import AuthCard from '#lib/components/auth/AuthCard.svelte';
	import SigninForm from '#lib/components/auth/SigninForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<AuthCard title={t('Sign in')} subtitle={t('Welcome on the INGInious platform.')}>
	<SigninForm methods={data.methods} redirect={data.redirect} passwordForm={data.passwordForm} login={form?.login} />
	{#snippet footer()}
		{#if data.passwordForm}<a class="anchor" href="/register">{t('Create an account')}</a>{/if}
	{/snippet}
</AuthCard>
