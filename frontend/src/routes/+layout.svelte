<!--
@component
Root layout: global stylesheet, browser-side translations, display preferences
(locale, time zone, indentation) for every component, and the application
shell, busy while a navigation or a tracked request is pending. Nested
layouts/pages add sidebar sections by returning `nav: NavSection[]` from their
load function (see #lib/components/layout/nav.ts).
-->
<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/env';
	import { navigating, page } from '$app/state';
	import { setCatalogGetter } from '#lib/i18n/index.js';
	import { setUiPrefs } from '#lib/components/ui/prefs.js';
	import AppShell from '#lib/components/layout/AppShell.svelte';
	import { loading } from '#lib/components/layout/loading.svelte.js';
	import type { NavSection } from '#lib/components/layout/nav.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// In the browser, `t()` reads the catalog of the current page language.
	// (On the server the catalog is bound to the request by hooks.server.ts.)
	if (browser) setCatalogGetter(() => data.catalog);

	// CORE-06: browser errors are reported to Sentry when `sentry_io_url` is configured
	// (the SDK is only downloaded in that case; initialised once, in the browser).
	// `data-hydrated` on <html> marks the page as interactive (the root layout mounts
	// last): before it, forms are posted without JavaScript; the integration tests wait for it,
	// and the performance mark gives the time to interactive (perf/pages.perf.ts).
	onMount(() => {
		document.documentElement.dataset.hydrated = '';
		performance.mark('inginious:hydrated');
		if (data.sentryDsn) void import('@sentry/browser').then((sentry) => sentry.init({ dsn: data.sentryDsn! }));
	});

	setUiPrefs(() => ({
		locale: data.lang.replace('_', '-'),
		timeZone: data.timezone,
		indentation: data.codeIndentation
	}));
</script>

<AppShell
	user={data.user}
	lang={data.lang}
	lti={data.isLti}
	currentPath={page.url.pathname + page.url.search}
	returnTo={page.url.pathname + page.url.search}
	version={data.version}
	privacyHref={data.privacyHref}
	allowRegistration={data.allowRegistration}
	sections={(page.data as { nav?: NavSection[] }).nav ?? []}
	flash={data.flash}
	busy={navigating.to !== null || loading.active}
>
	{@render children()}
</AppShell>
