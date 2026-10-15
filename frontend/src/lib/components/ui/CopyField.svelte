<!--
@component
Read-only value with a copy button (credentials, URLs, tokens). Secrets are
masked until the user reveals them; copying never requires revealing.

Props:
- `label` (string): visible label of the value.
- `value` (string): the value.
- `secret` (boolean, default false): mask the value (with a reveal toggle).

@example <CopyField label={t('Password')} value={dav.password} secret />
-->
<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import { t } from '#lib/i18n/index.js';

	/** Props of CopyField. */
	export interface Props {
		/** Visible label. */
		label: string;
		/** Value to show and copy. */
		value: string;
		/** Masks the value until revealed. */
		secret?: boolean;
	}

	let { label, value, secret = false }: Props = $props();
	const id = $props.id();
	let revealed = $state(false);
	let copied = $state(false);

	/** Copies the value and shows a check mark for 1.5 s. */
	async function copy() {
		await navigator.clipboard.writeText(value);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<div class="space-y-1">
	<label for={id} class="block text-xs font-medium text-surface-600-400">{label}</label>
	<div class="flex items-center gap-1 rounded-base border border-surface-200-800 bg-surface-100-900 py-0.5 ps-3 pe-0.5">
		<input
			{id}
			class="min-w-0 flex-1 truncate bg-transparent py-1 font-mono text-[0.8125rem] outline-none"
			type={secret && !revealed ? 'password' : 'text'}
			{value}
			readonly
			onfocus={(e) => e.currentTarget.select()}
		/>
		{#if secret}
			<button
				type="button"
				class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal"
				aria-pressed={revealed}
				aria-label={revealed ? t('Hide') : t('Show')}
				title={revealed ? t('Hide') : t('Show')}
				onclick={() => (revealed = !revealed)}
				>{#if revealed}<EyeOffIcon />{:else}<EyeIcon />{/if}</button
			>
		{/if}
		<button
			type="button"
			class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal"
			aria-label={t('Copy {}', label)}
			title={t('Copy')}
			onclick={copy}
			>{#if copied}<CheckIcon class="text-success-600-400" />{:else}<CopyIcon />{/if}</button
		>
	</div>
</div>
