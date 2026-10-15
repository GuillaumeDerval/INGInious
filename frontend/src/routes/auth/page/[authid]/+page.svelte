<!--
@component
Sign-in form of a form-based auth method such as LDAP (AUTH-16), in a centred card.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import AuthCard from '#lib/components/auth/AuthCard.svelte';
	import SigninForm from '#lib/components/auth/SigninForm.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<AuthCard title={data.name}>
	<SigninForm methods={[]} redirect="/" external={data} />
	{#snippet footer()}<a class="anchor" href="/signin">{t('Sign in')}</a>{/snippet}
</AuthCard>
