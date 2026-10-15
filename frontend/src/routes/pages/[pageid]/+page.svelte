<!--
@component
Static page (AUTH-02), also the welcome page of the home page (AUTH-01): the
rendered text in a readable-width card.
-->
<script lang="ts">
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import RichText from '#lib/components/common/RichText.svelte';
	import type { StaticPage } from '#lib/server/auth/static-pages.js';

	let { data }: { data: StaticPage } = $props();
</script>

<PageHeader title={data.title} />
<article class="max-w-3xl panel p-5 sm:p-8"><RichText html={data.html} /></article>
