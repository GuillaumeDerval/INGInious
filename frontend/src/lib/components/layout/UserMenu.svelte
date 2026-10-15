<!--
@component
Dropdown menu of the logged-in user (AUTH-18): avatar with initials and real
name, links to My courses, Course list, Preferences, Service status,
Administration (superadmins only) and a "Log out" entry that POSTs to `/logout`
(logging out never happens on a GET request).

Props:
- `user` ({ username, realname, superadmin }): the current user.
-->
<script lang="ts">
	import { Menu, Portal } from '@skeletonlabs/skeleton-svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import { t } from '#lib/i18n/index.js';

	/** Props of UserMenu. */
	export interface Props {
		/** Current user (only the displayed fields are needed). */
		user: { username: string; realname: string; superadmin: boolean };
	}

	let { user }: Props = $props();

	let logoutForm: HTMLFormElement;

	const name = $derived(user.realname || user.username);
	/** Up to two initials of the displayed name. */
	const initials = $derived(
		name
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w.charAt(0).toUpperCase())
			.join('')
	);
	const links = $derived([
		{ href: '/mycourses', label: t('My courses') },
		{ href: '/courselist', label: t('Course list') },
		{ href: '/preferences', label: t('Preferences') },
		{ href: '/queue', label: t('Service status') },
		...(user.superadmin ? [{ href: '/administrator/users', label: t('Administration') }] : [])
	]);
</script>

<form bind:this={logoutForm} method="POST" action="/logout" class="hidden"></form>
<Menu onSelect={(d) => d.value === 'logout' && logoutForm.requestSubmit()}>
	<Menu.Trigger class="btn gap-2 ps-1 btn-sm hover:preset-tonal" aria-label={t('User menu')}>
		<span
			class="grid size-8 place-items-center rounded-full preset-filled-primary-500 text-xs font-bold"
			aria-hidden="true">{initials}</span
		>
		<span class="hidden max-w-48 truncate md:inline">{name}</span>
		<ChevronDownIcon class="size-4" aria-hidden="true" />
	</Menu.Trigger>
	<Portal>
		<Menu.Positioner>
			<Menu.Content class="z-50 min-w-56 panel p-1.5 shadow-lg outline-none">
				<div class="mb-1 border-b border-surface-200-800 px-3 pt-1.5 pb-2.5 text-sm">
					<div class="truncate font-semibold">{name}</div>
					<div class="truncate text-surface-600-400">{user.username}</div>
				</div>
				{#each links as link (link.href)}
					<Menu.Item value={link.href}>
						{#snippet element(attributes)}
							<a {...attributes as Record<string, unknown>} href={link.href}>{link.label}</a>
						{/snippet}
					</Menu.Item>
				{/each}
				<Menu.Separator />
				<Menu.Item value="logout" class="justify-start gap-2">
					<LogOutIcon class="size-4" aria-hidden="true" />
					<Menu.ItemText>{t('Log out')}</Menu.ItemText>
				</Menu.Item>
			</Menu.Content>
		</Menu.Positioner>
	</Portal>
</Menu>
