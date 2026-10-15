<!--
@component
Application chrome shared by every page (CORE-01, AUTH-18): sticky header
(menu toggle, logo, language/sign-in or user menu), navigation sidebar
(collapsible on desktop, drawer on small screens), main content, footer and
toasts (including the flash message of the request), and the loading bar.

Global links depend on the login state; `sections` adds page-specific
sections (e.g. course menu) below them. LTI sessions get a minimal chrome:
no navigation, no menus, logo not clickable, "Powered by" footer.

Props:
- `user` (CurrentUser-like | null): logged-in user, null for anonymous visitors.
- `lang` (string): current UI language.
- `currentPath` (string), `returnTo` (string): current path, and path+query to come back to.
- `version` (string), `privacyHref` (string | null): footer data.
- `allowRegistration` (boolean): shows the "Register" link to anonymous users.
- `lti` (boolean): minimal LTI chrome.
- `sections` (NavSection[]): page-specific navigation sections.
- `flash` ({ kind, message } | null): message to show once as a toast.
- `busy` (boolean): the page waits for the server (LoadingBar, `aria-busy` on the content).
- `children` (Snippet): page content.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import XIcon from '@lucide/svelte/icons/x';
	import GraduationCapIcon from '@lucide/svelte/icons/graduation-cap';
	import LibraryIcon from '@lucide/svelte/icons/library-big';
	import UsersIcon from '@lucide/svelte/icons/users';
	import StoreIcon from '@lucide/svelte/icons/store';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import { t } from '#lib/i18n/index.js';
	import NavMenu from './NavMenu.svelte';
	import UserMenu from './UserMenu.svelte';
	import LanguageMenu from './LanguageMenu.svelte';
	import Footer from './Footer.svelte';
	import Toaster from './Toaster.svelte';
	import LoadingBar from './LoadingBar.svelte';
	import { notify, type ToastKind } from './toaster.js';
	import type { NavSection } from './nav.js';

	/** Props of AppShell. */
	export interface Props {
		/** Logged-in user, or null for anonymous visitors. */
		user: { username: string; realname: string; superadmin: boolean } | null;
		/** Current UI language code. */
		lang: string;
		/** Path of the current page (active menu entry). */
		currentPath: string;
		/** Path and query of the current page (return target of the language switch). */
		returnTo: string;
		/** INGInious version (footer). */
		version: string;
		/** Privacy policy URL, when configured (footer). */
		privacyHref?: string | null;
		/** True when self-registration is allowed. */
		allowRegistration?: boolean;
		/** True in LTI sessions (minimal chrome). */
		lti?: boolean;
		/** Page-specific navigation sections. */
		sections?: NavSection[];
		/** One-shot message coming from the server (#lib/server/flash.ts). */
		flash?: { kind: ToastKind; message: string } | null;
		/** True while the page waits for the server (navigation, form submission...). */
		busy?: boolean;
		/** Page content. */
		children: Snippet;
	}

	let {
		user,
		lang,
		currentPath,
		returnTo,
		version,
		privacyHref = null,
		allowRegistration = true,
		lti = false,
		sections = [],
		flash = null,
		busy = false,
		children
	}: Props = $props();

	/** Desktop sidebar hidden by the user. */
	let collapsed = $state(false);
	/** Mobile drawer open. */
	let drawerOpen = $state(false);
	/** Large screen (`lg`): the sidebar is shown instead of the drawer. */
	const large = new MediaQuery('min-width: 1024px', false);

	/** Global sections, depending on the login state (legacy layout.html sidebar). */
	const nav = $derived.by((): NavSection[] => {
		const main = user
			? [
					{ label: t('My courses'), href: '/mycourses', icon: GraduationCapIcon },
					{ label: t('Course list'), href: '/courselist', icon: LibraryIcon }
				]
			: [
					{ label: t('Course list'), href: '/courselist', icon: LibraryIcon },
					{ label: t('Sign in'), href: '/signin', icon: LogInIcon },
					...(allowRegistration ? [{ label: t('Register'), href: '/register', icon: UserPlusIcon }] : [])
				];
		const admin: NavSection[] = user?.superadmin
			? [
					{
						title: t('Administration'),
						items: [
							{ label: t('Users'), href: '/administrator/users', icon: UsersIcon },
							{ label: t('Marketplace'), href: '/marketplace', icon: StoreIcon }
						]
					}
				]
			: [];
		return [{ items: main }, ...sections, ...admin];
	});

	// Show the flash message once per server load. Deferred: the toast group
	// (a child component) only listens to the toaster once it is mounted.
	$effect(() => {
		const message = flash;
		if (message) setTimeout(() => notify(message.kind, message.message));
	});

	// Close the drawer after a navigation.
	$effect(() => {
		void currentPath;
		drawerOpen = false;
	});

	/** Hamburger button: collapses the sidebar on large screens, opens the drawer otherwise. */
	function toggleMenu() {
		if (large.current) collapsed = !collapsed;
		else drawerOpen = true;
	}
</script>

<a href="#main-content" class="sr-only fixed start-2 top-2 z-50 btn preset-filled-primary-500 focus:not-sr-only"
	>{t('Skip to content')}</a
>
<LoadingBar active={busy} />
<div class="flex min-h-screen flex-col">
	<header
		class="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-surface-200-800 bg-surface-50-950 px-3 sm:px-4"
	>
		<!-- Brand strip: the snake green fading into the hat yellow of the INGInious logo. -->
		<div
			class="pointer-events-none absolute inset-x-0 top-0 h-1 bg-linear-to-r from-primary-500 via-primary-400 to-secondary-300"
			aria-hidden="true"
		></div>
		{#if !lti}
			<button
				type="button"
				class="btn-icon text-surface-600-400 hover:preset-tonal"
				aria-label={t('Open menu')}
				aria-expanded={large.current ? !collapsed : drawerOpen}
				aria-controls="app-sidebar"
				onclick={toggleMenu}
			>
				<MenuIcon class="size-5" aria-hidden="true" />
			</button>
		{/if}
		<svelte:element
			this={lti ? 'span' : 'a'}
			href={lti ? undefined : '/'}
			class="flex items-center gap-2 rounded-base pe-1 text-[1.0625rem] font-semibold tracking-tight text-surface-950-50"
		>
			<img src="/logo.svg" alt="" class="h-8 w-auto" width="21" height="32" />
			<span>INGInious</span>
		</svelte:element>
		<div class="flex-1"></div>
		{#if !lti}
			{#if user}
				<UserMenu {user} />
			{:else}
				<LanguageMenu current={lang} {returnTo} />
				<a href="/signin" class="btn preset-filled-primary-500 btn-sm">{t('Sign in')}</a>
			{/if}
		{/if}
	</header>

	<div class="flex flex-1">
		{#if !lti && !collapsed}
			<aside
				id="app-sidebar"
				class="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-e border-surface-200-800 px-3 py-5 lg:block"
			>
				<NavMenu sections={nav} {currentPath} />
			</aside>
		{/if}
		<main id="main-content" aria-busy={busy} class="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
			<div class="mx-auto max-w-6xl">{@render children()}</div>
		</main>
	</div>
	<Footer {version} {privacyHref} {lti} />
</div>

{#if !lti}
	<Dialog open={drawerOpen} onOpenChange={(d) => (drawerOpen = d.open)}>
		<Portal>
			<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-950/50" />
			<Dialog.Positioner class="fixed inset-0 z-50 flex justify-start">
				<Dialog.Content class="h-screen w-72 max-w-[85vw] space-y-4 overflow-y-auto bg-surface-100-900 p-3 shadow-xl">
					<header class="flex items-center justify-between">
						<Dialog.Title class="flex items-center gap-2 px-2 font-semibold tracking-tight"
							><img src="/logo.svg" alt="" class="h-7 w-auto" width="19" height="28" />INGInious</Dialog.Title
						>
						<Dialog.CloseTrigger class="btn-icon hover:preset-tonal" aria-label={t('Close')}>
							<XIcon class="size-5" aria-hidden="true" />
						</Dialog.CloseTrigger>
					</header>
					<NavMenu sections={nav} {currentPath} />
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}
<Toaster />
