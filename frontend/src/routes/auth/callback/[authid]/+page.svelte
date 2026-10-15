<!--
@component
Re-posts a SAML response to the same URL, this time with the session cookie
(AUTH-17). Submitted automatically; the button is a fallback without JavaScript.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '#lib/i18n/index.js';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let element = $state<HTMLFormElement>();
	onMount(() => element?.submit());
</script>

{#if form?.repost}
	<form bind:this={element} method="POST" class="py-16 text-center">
		{#each Object.entries(form.repost) as [name, value] (name)}<input type="hidden" {name} {value} />{/each}
		<input type="hidden" name="alreadyRedirected" value="yes" />
		<button class="btn preset-filled-primary-500">{t('Continue')}</button>
	</form>
{/if}
