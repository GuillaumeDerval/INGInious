<!--
@component
Security preferences (AUTH-04): a card with the "Log out other sessions" button
(posted to the default action, result shown as a toast).
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import { t } from '#lib/i18n/index.js';
	import { toastEnhance } from '#lib/components/layout/toaster.js';
	import Card from '#lib/components/ui/Card.svelte';
</script>

<Card
	title={t('Other sessions')}
	description={t('Log out of this account on every other browser and device. This one stays logged in.')}
>
	<form method="POST" use:enhance={toastEnhance()}>
		<button class="btn preset-tonal"
			><LogOutIcon class="size-4" aria-hidden="true" />{t('Log out other sessions')}</button
		>
	</form>
</Card>
