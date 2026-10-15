<!--
@component
Terms of service acceptance checkbox `term_policy_check` (AUTH-09) with links
to the terms and privacy pages.

Props:
- `links` ({ terms, privacy }): URLs of the two pages.
- `checked` (boolean, default false): initial state.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';

	/** Props of TosCheckbox. */
	export interface Props {
		/** URLs of the terms of service and privacy policy pages. */
		links: { terms: string; privacy: string };
		/** Initially checked. */
		checked?: boolean;
	}

	let { links, checked = false }: Props = $props();
	/** The legacy sentence, split around its two link placeholders. */
	const parts = $derived(
		t('I have read the {a1start}Terms of service{a1end} and the {a2start}Privacy policy{a2end}.').split(
			/\{(a[12])start\}(.*?)\{a[12]end\}/
		)
	);
</script>

<label class="flex items-center gap-2 text-sm">
	<input class="checkbox" type="checkbox" name="term_policy_check" {checked} />
	<span>
		{#each parts as part, i (i)}{#if i % 3 === 1}<a
					class="anchor"
					href={part === 'a1' ? links.terms : links.privacy}
					target="_blank">{parts[i + 1]}</a
				>{:else if i % 3 === 0}{part}{/if}{/each}
	</span>
</label>
