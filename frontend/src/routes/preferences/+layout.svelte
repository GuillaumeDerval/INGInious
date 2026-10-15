<!--
@component
Preferences layout (AUTH-11/12/13): page title and tabs above the current
preferences page: "My profile", "Sign-in methods" and, set apart in red,
"Delete my account" (only when deletion is allowed).
-->
<script lang="ts">
	import UserIcon from '@lucide/svelte/icons/user-round';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const tabs = $derived([
		{ href: '/preferences/profile', label: t('My profile'), Icon: UserIcon, danger: false },
		{ href: '/preferences/bindings', label: t('Sign-in methods'), Icon: KeyIcon, danger: false },
		...(data.allowDeletion
			? [{ href: '/preferences/delete', label: t('Delete my account'), Icon: TrashIcon, danger: true }]
			: [])
	]);
</script>

<PageHeader title={t('Preferences')} />
<nav aria-label={t('Preferences')} class="mb-6 flex gap-1 overflow-x-auto border-b border-surface-200-800">
	{#each tabs as tab (tab.href)}
		<a
			href={tab.href}
			aria-current={tab.href === page.url.pathname ? 'page' : undefined}
			class="flex items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap {tab.danger
				? 'ms-auto text-error-600-400'
				: ''} {tab.href === page.url.pathname
				? 'border-current font-semibold'
				: 'border-transparent hover:bg-surface-200-800'}"
		>
			<tab.Icon class="size-4" aria-hidden="true" />{tab.label}
		</a>
	{/each}
</nav>
{@render children()}
