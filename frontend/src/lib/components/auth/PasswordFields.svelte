<!--
@component
New password + confirmation inputs (`passwd`, `passwd2`) used by registration,
password reset and the profile (AUTH-07, AUTH-08, AUTH-11), with a live
strength hint and a mismatch warning (the server still validates).

Props:
- `required` (boolean, default true): both fields are mandatory.
- `newPassword` (boolean, default false): uses the "New password" labels (profile).
- `minLength` (number, default 10): minimum length shown in the label (`password_min_length`).
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import FormField from '#lib/components/ui/FormField.svelte';

	/** Props of PasswordFields (see the component documentation). */
	export interface Props {
		required?: boolean;
		newPassword?: boolean;
		minLength?: number;
	}

	let { required = true, newPassword = false, minLength = 10 }: Props = $props();
	let passwd = $state('');
	let passwd2 = $state('');
	/** Rough strength: length plus the variety of character classes (0 to 4). */
	const score = $derived(
		passwd.length < minLength
			? 0
			: Math.min(
					4,
					Math.floor(passwd.length / 8) + [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((r) => r.test(passwd)).length - 1
				)
	);
	const levels = [t('Too short'), t('Weak'), t('Fair'), t('Good'), t('Strong')];
</script>

<FormField
	label={newPassword
		? t('New password (min. {} characters) :', minLength)
		: t('Password (min. {} characters) :', minLength)}
	hint={passwd ? levels[score] : undefined}
	{required}
>
	{#snippet children(a)}<input
			{...a}
			class="input"
			type="password"
			name="passwd"
			autocomplete="new-password"
			maxlength={1024}
			bind:value={passwd}
			{required}
		/>{/snippet}
</FormField>
{#if passwd}<meter class="h-1.5 w-full" min="0" max="4" low="2" high="3" optimum="4" value={score} aria-hidden="true"
	></meter>{/if}
<FormField
	label={newPassword ? t('Confirm new password :') : t('Confirm password :')}
	error={passwd2 && passwd2 !== passwd ? t("Passwords don't match !") : null}
	{required}
>
	{#snippet children(a)}<input
			{...a}
			class="input"
			type="password"
			name="passwd2"
			autocomplete="new-password"
			bind:value={passwd2}
			{required}
		/>{/snippet}
</FormField>
