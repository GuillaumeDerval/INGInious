<!-- LTI-04 account binding confirmation. -->
<script lang="ts">
	import LtiBind from '#lib/components/lti/LtiBind.svelte';
	let { data, form }: import('./$types').PageProps = $props();
</script>

<LtiBind
	user={data.user}
	lti={data.lti}
	bound={!!form && 'bound' in form}
	message={form && 'message' in form ? form.message : null}
/>
