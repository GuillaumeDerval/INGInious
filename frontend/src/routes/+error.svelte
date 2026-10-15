<!--
@component
Error page (CORE-02), rendered inside the application shell for every
`error(status, message)` and unexpected failure. Shows a friendly, translated
title and explanation for the status; the message of expected errors is
displayed as text (unexpected errors only carry a generic message, see
hooks: stack traces are never sent to the browser).
-->
<script lang="ts">
	import { page } from '$app/state';
	import SearchXIcon from '@lucide/svelte/icons/search-x';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import ServerCrashIcon from '@lucide/svelte/icons/server-crash';
	import { t } from '#lib/i18n/index.js';

	const status = $derived(page.status);
	/** Title, explanation and icon per family of status codes. */
	const view = $derived.by(() => {
		if (status === 404)
			return {
				title: t('Page not found'),
				text: t('The requested URL was not found on the server.'),
				Icon: SearchXIcon
			};
		if (status === 401 || status === 403)
			return {
				title: t('Forbidden'),
				text: t("You don't have the rights to access this page."),
				Icon: ShieldAlertIcon
			};
		if (status < 500)
			return { title: t('Error {}', status), text: t('The request could not be processed.'), Icon: ShieldAlertIcon };
		return {
			title: t('Internal error'),
			text: t(
				'Something bad happened. The error has been logged, please contact your administrator if the error persists.'
			),
			Icon: ServerCrashIcon
		};
	});
	/** Error detail; generic messages added by SvelteKit itself are redundant with the title. */
	const message = $derived.by(() => {
		const text = page.error?.message ?? '';
		return ['not found', 'internal error', view.title.toLowerCase()].includes(text.toLowerCase()) ? '' : text;
	});
</script>

<svelte:head><title>{`${view.title} | INGInious`}</title></svelte:head>

<section class="mx-auto flex max-w-xl flex-col items-center gap-3 py-12 text-center sm:py-20">
	<div
		class="mb-2 grid size-16 place-items-center rounded-full {status >= 500
			? 'bg-error-500/10 text-error-600-400'
			: 'bg-warning-500/12 text-warning-700-300'}"
	>
		<view.Icon class="size-8" aria-hidden="true" />
	</div>
	<p class="eyebrow">{t('Error {}', status)}</p>
	<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">{view.title}</h1>
	<p class="text-surface-600-400">{view.text}</p>
	{#if message}<p class="panel px-4 py-2.5 text-sm" data-testid="error-message">
			{message}
		</p>{/if}
	<div class="flex flex-wrap justify-center gap-2 pt-3">
		<a href="/" class="btn preset-filled-primary-500">{t('Back to home')}</a>
		<a href="/courselist" class="btn preset-tonal">{t('Course list')}</a>
	</div>
</section>
