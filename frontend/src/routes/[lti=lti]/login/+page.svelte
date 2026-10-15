<!-- LTI-04 login step inside the LMS iframe. -->
<script lang="ts">
	import LtiLogin from '#lib/components/lti/LtiLogin.svelte';
	let { data }: import('./$types').PageProps = $props();
</script>

<LtiLogin bindUrl={data.bindUrl} />
