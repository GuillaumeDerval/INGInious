<!--
@component
Logout confirmation (AUTH-06), shown when /logout is opened with GET.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
</script>

<PageHeader title={t('Log out')} />
<form method="POST"><button class="btn preset-filled-primary-500">{t('Log out')}</button></form>
