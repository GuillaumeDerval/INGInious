<!--
@component
Language picker (AUTH-10). Choosing a language POSTs the form to `/language`
(no side effect on GET), which stores it in
the session and redirects back to `returnTo`.

Props:
- `current` (string): code of the current language (a key of `LANGUAGES`, see `resolveLanguage`).
- `returnTo` (string): same-site path to come back to after the change.
-->
<script lang="ts">
	import { Menu, Portal } from '@skeletonlabs/skeleton-svelte';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import { LANGUAGES, t } from '#lib/i18n/index.js';

	/** Props of LanguageMenu. */
	export interface Props {
		/** Code of the current language (a key of `LANGUAGES`). */
		current: string;
		/** Path (and query) of the current page. */
		returnTo: string;
	}

	let { current, returnTo }: Props = $props();

	let form: HTMLFormElement;
	let input: HTMLInputElement;

	/** Submits the form with the selected language (mouse and keyboard). */
	function select(value: string) {
		input.value = value;
		form.requestSubmit();
	}
</script>

<form bind:this={form} method="POST" action="/language" class="contents">
	<input bind:this={input} type="hidden" name="language" value={current} />
	<input type="hidden" name="redirect" value={returnTo} />
</form>
<Menu onSelect={(d) => select(d.value)}>
	<Menu.Trigger class="btn btn-sm hover:preset-tonal" aria-label={t('Language')}>
		<GlobeIcon class="size-4" aria-hidden="true" />
		<span class="hidden sm:inline">{LANGUAGES[current]}</span>
	</Menu.Trigger>
	<Portal>
		<Menu.Positioner>
			<Menu.Content class="z-50 panel p-1.5 shadow-lg outline-none">
				{#each Object.entries(LANGUAGES) as [code, name] (code)}
					<Menu.Item value={code} lang={code.replace('_', '-')} aria-current={code === current ? 'true' : undefined}>
						<Menu.ItemText class={code === current ? 'font-semibold' : ''}>{name}</Menu.ItemText>
					</Menu.Item>
				{/each}
			</Menu.Content>
		</Menu.Positioner>
	</Portal>
</Menu>
