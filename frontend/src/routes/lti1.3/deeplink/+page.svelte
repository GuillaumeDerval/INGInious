<!-- LTI-10 deep-linking task picker. -->
<script lang="ts">
	import DeepLinkPicker from '#lib/components/lti/DeepLinkPicker.svelte';
	let { data, form }: import('./$types').PageProps = $props();
</script>

<DeepLinkPicker courses={data.courses} response={form} />
