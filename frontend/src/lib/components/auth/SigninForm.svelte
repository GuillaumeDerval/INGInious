<!--
@component
Sign-in form (AUTH-05, AUTH-14, AUTH-16), placed in an AuthCard by the pages:
username/password form (only when self-registration is allowed, like legacy)
with the "Lost password?" link, with one button per external auth method
above it, separated by an "or" rule. The password form posts to the
default action of the page; each method button POSTs to `/auth/signin/<id>`
(no flow is started by a GET request). Also the form of the form-based
external methods such as LDAP (`external`: their logo, no account links).

Props:
- `methods` (Array<{ id, name, imlink }>): external auth methods.
- `redirect` (string): same-site path to open after sign-in.
- `passwordForm` (boolean, default true): shows the username/password form.
- `login` (string, optional): username to pre-fill after a failure.
- `external` ({ imlink }, optional): form of a form-based external method.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import { t } from '#lib/i18n/index.js';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import FormField from '#lib/components/ui/FormField.svelte';

	/** Props of SigninForm. */
	export interface Props {
		/** External auth methods. */
		methods: { id: string; name: string; imlink: string | null }[];
		/** Return path after sign-in. */
		redirect: string;
		/** Shows the username/password form. */
		passwordForm?: boolean;
		/** Pre-filled username. */
		login?: string;
		/** Form-based external method (logo URL or null). */
		external?: { imlink: string | null };
	}

	let { methods, redirect, passwordForm = true, login = '', external }: Props = $props();
</script>

{#if methods.length}
	<div class="grid gap-2">
		{#each methods as method (method.id)}
			<form method="POST" action={`/auth/signin/${method.id}`}>
				<input type="hidden" name="redirect" value={redirect} />
				<button class="btn w-full preset-outlined-surface-200-800 hover:preset-tonal">
					{#if method.imlink}<img src={method.imlink} alt="" class="size-5 object-contain" />{:else}<KeyRoundIcon
							class="size-4"
							aria-hidden="true"
						/>{/if}
					{`${t('Sign in with')} ${method.name}`}
				</button>
			</form>
		{/each}
	</div>
	{#if passwordForm}
		<p class="flex items-center gap-3 text-xs text-surface-500 uppercase" aria-hidden="true">
			<span class="h-px flex-1 bg-surface-200-800"></span><span>{t('or')}</span><span
				class="h-px flex-1 bg-surface-200-800"
			></span>
		</p>
	{/if}
{/if}
{#if external?.imlink}<img src={external.imlink} alt="" class="mx-auto max-w-[150px]" />{/if}
{#if passwordForm}
	<form method="POST" class="space-y-4" use:enhance={toastEnhance()}>
		<input type="hidden" name="redirect" value={redirect} />
		<FormField label={t('Username')}>
			{#snippet children(a)}<input
					{...a}
					class="input"
					name="login"
					value={login}
					autocomplete="username"
					required
				/>{/snippet}
		</FormField>
		<FormField label={t('Password')}>
			{#snippet children(a)}<input
					{...a}
					class="input"
					name="password"
					type="password"
					autocomplete="current-password"
					required
				/>{/snippet}
		</FormField>
		{#if !external}<p class="-mt-2 text-end text-sm">
				<a class="anchor" href="/register#lostpasswd">{t('Lost password?')}</a>
			</p>{/if}
		<button class="btn w-full preset-filled-primary-500">{t('Sign in')}</button>
	</form>
{/if}
