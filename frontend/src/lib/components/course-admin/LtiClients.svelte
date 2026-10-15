<!--
@component
LTI 1.3 clients of a course (CADM-04, LTI-01): for each client of the global
and course configurations, the URLs to copy into the LMS (launch, OIDC login,
JWKS, each with a copy button), its public key (collapsed) and the deployment
secrets, which can be generated (32 hex characters from the browser CSPRNG) or
removed. Secrets are edited in `secrets`
(`"<iss>/<client_id>/<deployment_id>" -> secret`), saved with the form.

Props:
- `clients` (LtiClient[]): clients to show (no private keys).
- `courseid` (string): course id used in the course-level URLs.
- `origin` (string): site origin for absolute URLs.
- `secrets` (Record<string, string>): deployment secrets, mutated in place.
-->
<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import { t } from '#lib/i18n/index.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import CopyField from '#lib/components/ui/CopyField.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import type { LtiClient } from '#lib/server/course-admin/settings.js';

	/** Props (documented in the component comment above). */
	export interface Props {
		clients: LtiClient[];
		courseid: string;
		origin: string;
		secrets: Record<string, string>;
	}

	let { clients, courseid, origin, secrets }: Props = $props();
	/** Value copied last (its button shows a check mark for 1.5 s). */
	let copied = $state('');
	async function copy(value: string) {
		await navigator.clipboard.writeText(value);
		copied = value;
		setTimeout(() => (copied = ''), 1500);
	}
</script>

{#snippet url(label: string, value: string)}
	<dt>{label}</dt>
	<dd class="flex min-w-0 items-center gap-1">
		<code class="min-w-0 truncate" title={value}>{value}</code>
		<button
			type="button"
			class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal"
			aria-label={t('Copy {}', label)}
			title={t('Copy')}
			onclick={() => copy(value)}
			>{#if copied === value}<CheckIcon class="text-success-600-400" />{:else}<CopyIcon />{/if}</button
		>
	</dd>
{/snippet}

<div class="space-y-4">
	<div>
		<h3 class="text-sm font-semibold">{t('LTI 1.3 clients')}</h3>
		<p class="text-sm text-surface-600-400">{t('Copy these values into the tool configuration of your platform.')}</p>
	</div>
	<dl class="kv">{@render url(`${t('Launch URL')} (LTI 1.1)`, `${origin}/lti/${courseid}/<taskid>`)}</dl>
	{#each clients as c (c.type + c.iss + c.clientId)}
		{@const suffix = c.type === 'course' ? `/${courseid}` : ''}
		<section class="rounded-container border border-surface-200-800">
			<header
				class="flex flex-wrap items-center gap-2 rounded-t-container border-b border-surface-200-800 bg-surface-100-900 px-4 py-2.5"
			>
				<PlugIcon class="size-4 text-surface-500" aria-hidden="true" />
				<span class="min-w-0 truncate text-sm font-semibold">{c.iss}</span>
				<Badge tone={c.type === 'course' ? 'primary' : 'neutral'}
					>{c.type === 'course' ? t('Course') : t('Global')}</Badge
				>
			</header>
			<div class="space-y-4 p-4">
				<dl class="kv">
					<dt>{t('Client ID')}</dt>
					<dd><code>{c.clientId}</code></dd>
					{@render url(`${t('Launch URL')} / ${t('Deep Link URL')}`, `${origin}/lti1.3/launch${suffix}`)}
					{@render url(t('OIDC Login URL'), `${origin}/lti1.3/oidc_login${suffix}`)}
					{@render url(t('JWKS keyset'), `${origin}/lti1.3/jwks${suffix}/${c.keysetHash}`)}
					<dt>{t('Required custom parameters')}</dt>
					<dd><code>{c.type === 'global' ? 'courseid, ' : ''}taskid, secret</code></dd>
				</dl>
				{#if c.publicKey}
					<details class="text-sm">
						<summary class="font-medium text-surface-700-300">{t('Public key')}</summary>
						<pre class="mt-2 overflow-x-auto rounded-base bg-surface-100-900 p-3 text-xs">{c.publicKey}</pre>
					</details>
				{/if}
				<div class="space-y-2">
					<p class="eyebrow">{t('Deployment secrets')}</p>
					<ul class="divide-y divide-surface-200-800 rounded-base border border-surface-200-800">
						{#each c.deploymentIds as dep (dep)}
							{@const key = `${c.iss}/${c.clientId}/${dep}`}
							<li class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
								<code class="text-xs">{dep}</code>
								{#if secrets[key]}
									<div class="min-w-48 flex-1"><CopyField label={t('Secret')} value={secrets[key]} secret /></div>
									<button
										type="button"
										class="btn-icon text-surface-600-400 btn-icon-sm hover:preset-tonal-error"
										aria-label={t('Delete')}
										title={t('Delete')}
										onclick={() => delete secrets[key]}><TrashIcon /></button
									>
								{:else}
									<span class="flex-1 text-sm text-surface-600-400">{t('No secret yet')}</span>
									<button
										type="button"
										class="btn preset-tonal btn-sm"
										onclick={() => (secrets[key] = crypto.randomUUID().replaceAll('-', ''))}
										><KeyIcon />{t('Generate secret')}</button
									>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			</div>
		</section>
	{:else}
		<EmptyState
			compact
			icon={PlugIcon}
			title={t('No LTI 1.3 client')}
			description={t('Declare clients in the additional raw configuration above, then save to see their URLs.')}
		/>
	{/each}
</div>
