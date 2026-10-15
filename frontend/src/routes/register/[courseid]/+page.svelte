<!--
@component
/register/<courseid> (NAV-06): enrollment confirmation in a centred card,
with a password field when the course requires one.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import GraduationCapIcon from '@lucide/svelte/icons/graduation-cap';
	import { t } from '#lib/i18n/index.js';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import FormField from '#lib/components/ui/FormField.svelte';
	import AuthCard from '#lib/components/auth/AuthCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<AuthCard
	title={t("Enroll in the course '{}'", data.name)}
	subtitle={t('This will enroll you in the course {}', data.name)}
	icon={GraduationCapIcon}
>
	<form method="POST" use:enhance={toastEnhance()} class="space-y-4">
		{#if data.password}
			<FormField label={t('Password')}>
				{#snippet children(a)}<input
						{...a}
						class="input"
						type="password"
						name="register_password"
						autocomplete="off"
						required
					/>{/snippet}
			</FormField>
		{/if}
		<button class="btn w-full preset-filled-primary-500">{t('Enroll in the course')}</button>
	</form>
	{#snippet footer()}<a class="anchor" href={`/course/${data.id}`}>{t('Back to the course')}</a>{/snippet}
</AuthCard>
