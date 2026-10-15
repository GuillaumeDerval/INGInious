<!--
@component
Home page (AUTH-01): the operator's welcome page, displayed by the static page
component of `/pages/<pageid>` (AUTH-02).
-->
<script lang="ts">
	import StaticPage from './pages/[pageid]/+page.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<StaticPage {data} />
