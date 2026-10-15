<!--
@component
Account deletion page (AUTH-13): the user confirms by typing their e-mail
address in the confirmation dialog.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import Card from '#lib/components/ui/Card.svelte';
	import ConfirmDialog from '#lib/components/ui/ConfirmDialog.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<Card
	title={t('Delete my account')}
	description={t('This will also delete all your data ! Are you really sure ?')}
	class="border-error-500/50"
>
	<ConfirmDialog
		title={t('Delete my account')}
		description={t('To confirm, type your email address :')}
		triggerLabel={t('Delete my account')}
		confirmLabel={t('Delete my account')}
		confirmText={data.email}
		action="/preferences/delete"
		fields={{ delete_email: data.email }}
	/>
</Card>
