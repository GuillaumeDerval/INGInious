<!--
@component
/courselist (NAV-01): searchable grid of the open courses (CourseCard), searched and
paginated by the server (ListSearch, Pager; the count of matching courses is shown); anonymous visitors
are invited to sign in, logged-in users are told where to find all theirs.
Each card shows the name, the sanitized description, an access chip stating
clearly what the visitor can do ("Registered", "Registration open",
"Password required", "Preview available", "Registration closed", "External
platform") and a single call-to-action (Open / Register / Preview, or the
external platform of LTI courses, in a new tab).
-->
<script lang="ts">
	import ExternalIcon from '@lucide/svelte/icons/external-link';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import KeyIcon from '@lucide/svelte/icons/key';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import CheckIcon from '@lucide/svelte/icons/circle-check';
	import LockIcon from '@lucide/svelte/icons/lock';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.js';
	import RichText from '#lib/components/common/RichText.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge, { type Tone } from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Pager from '#lib/components/ui/Pager.svelte';
	import CourseCard from '#lib/components/nav/CourseCard.svelte';
	import ListSearch from '#lib/components/nav/ListSearch.svelte';
	import { withQuery } from '#lib/utils/url.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Access chip (tone, icon, text) and call-to-action of a course for the viewer. */
	const access = (
		c: PageProps['data']['courses'][number]
	): [Tone, typeof LockIcon, string, string | null, string | null] =>
		c.isLti
			? ['primary', ExternalIcon, t('External platform'), c.ltiUrl && t('Open'), c.ltiUrl]
			: c.registered
				? ['success', CheckIcon, t('Registered'), t('Open'), `/course/${c.id}`]
				: c.autoRegistration
					? c.password
						? ['warning', KeyIcon, t('Password required'), t('Register'), `/register/${c.id}`]
						: ['success', UserPlusIcon, t('Registration open'), t('Register'), `/register/${c.id}`]
					: c.preview
						? ['primary', EyeIcon, t('Preview available'), t('Preview'), `/course/${c.id}`]
						: ['neutral', LockIcon, t('Registration closed'), null, null];
</script>

<PageHeader
	title={t('Course list')}
	subtitle={t('Browse the courses open on this platform and register to the ones you follow.')}
/>
<div class="space-y-6">
	{#if data.loggedIn}
		<Alert kind="info" title={t('Public courses')}>
			{t(
				"This page lists all the courses that are available now. If you are a course administrator, go to your 'My courses' page to see all of them."
			)}
			<a class="anchor" href="/mycourses">{t('My courses')}</a>
		</Alert>
	{:else}
		<Alert kind="info">
			{t('Please register or sign in to see the complete list of courses and be able to submit answers to problems.')}
			<a class="anchor" href="/signin?redirect=/courselist">{t('Sign in')}</a>
		</Alert>
	{/if}
	<div class="flex flex-wrap items-center justify-between gap-3">
		<ListSearch value={data.q} label={t('Search a course by its name')} />
		<Badge>{t('{} courses', data.count)}</Badge>
	</div>
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
		{#each data.courses as c (c.id)}
			{@const [tone, icon, chip, cta, href] = access(c)}
			<CourseCard id={c.id} name={c.name}>
				<RichText html={c.description} class="line-clamp-3 text-sm text-surface-700-300" />
				{#snippet footer()}
					<Badge {tone} {icon}>{chip}</Badge>
					{#if cta}
						<a
							class="btn btn-sm {c.registered ? 'preset-tonal' : 'preset-tonal-primary'}"
							{href}
							target={c.isLti ? '_blank' : undefined}
							rel={c.isLti ? 'noopener noreferrer' : undefined}
							aria-label={`${cta}: ${c.name}`}
							>{cta}{#if c.isLti}<ExternalIcon class="size-3.5" aria-hidden="true" />{/if}</a
						>
					{/if}
				{/snippet}
			</CourseCard>
		{/each}
	</div>
	{#if !data.courses.length}<EmptyState icon={SearchIcon} title={t('No course found.')} />{/if}
	<Pager page={data.page} pages={data.pages} href={(p) => withQuery(page.url, { page: p })} />
</div>
