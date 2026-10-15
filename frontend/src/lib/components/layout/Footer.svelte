<!--
@component
Page footer (CORE-01, AUTH-18): INGInious version, copyright, AGPL notice and,
when terms of service are configured, the privacy policy link.
In an LTI session a shorter "Powered by INGInious" text is shown.

Props:
- `version` (string): INGInious version.
- `privacyHref` (string | null, optional): URL of the privacy policy page.
- `lti` (boolean, optional): LTI variant.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';

	/** Props of Footer. */
	export interface Props {
		/** INGInious version shown in the footer. */
		version: string;
		/** URL of the privacy policy page, when configured. */
		privacyHref?: string | null;
		/** True in LTI sessions (minimal chrome). */
		lti?: boolean;
	}

	let { version, privacyHref = null, lti = false }: Props = $props();
</script>

<footer class="border-t border-surface-200-800 px-4 py-3 text-xs text-surface-600-400">
	<p
		class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 [&>*+*]:before:me-2 [&>*+*]:before:content-['·']"
	>
		{#if lti}
			<a class="anchor" href="https://www.inginious.org" rel="noopener noreferrer" target="_blank"
				>{t('Powered by INGInious v.{}, a free and open-source grading tool.', version)}</a
			>
		{:else}
			<span>{t('Running INGInious v.{}', version)}</span>
			<span>© 2014-2026 Université catholique de Louvain.</span>
			<a class="hover:underline" href="https://www.inginious.org" rel="noopener noreferrer" target="_blank"
				>{t('INGInious is distributed under AGPL license')}</a
			>
		{/if}
		{#if privacyHref}<a class="hover:underline" href={privacyHref}>{t('Privacy Policy')}</a>{/if}
	</p>
</footer>
