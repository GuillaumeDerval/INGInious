<!--
@component
Connection instructions of an SSH debug session (TASK-12): the `ssh` command,
the password and, when the INGInious-xterm `webterm` is configured, an
in-browser terminal.

Props: `ssh` (SshDebug), `webterm` (string | null).
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import type { SshDebug } from './types.js';

	/** Props of SshPanel. */
	export interface Props {
		/** Credentials of the session. */
		ssh: SshDebug;
		/** URL of the web terminal, if configured. */
		webterm?: string | null;
	}

	let { ssh, webterm }: Props = $props();
	const command = $derived(
		`ssh ${ssh.user}@${ssh.host} -p ${ssh.port} -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o PreferredAuthentications=password`
	);
	const src = $derived(
		webterm
			? `${webterm}?${new URLSearchParams({ host: ssh.host, port: String(ssh.port), password: ssh.password })}`
			: null
	);
</script>

<div class="space-y-2" data-testid="ssh-panel">
	{#if src}
		<iframe title={t('SSH console')} {src} class="h-96 w-full rounded-base border-0"></iframe>
		<p>{t('Alternatively, you can also paste this command into your terminal:')}</p>
	{:else}
		<p>{t('Paste this command into your terminal:')}</p>
	{/if}
	<pre class="pre overflow-x-auto">{command}</pre>
	<p>{t('The password to connect is')} <code class="code">{ssh.password}</code></p>
</div>
