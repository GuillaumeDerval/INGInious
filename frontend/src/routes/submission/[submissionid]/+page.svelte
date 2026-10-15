<!--
@component
Staff view of a submission (CSTU-15): a summary band (result, grade, date,
students, tags), then a split view with the answers per problem on the left
(inputs not defined in the task flagged) and the rendered feedback (global then
per problem, hidden blocks shown) on the right, followed by the debug dump for
admins. Download in the header; replays (CSTU-14) in a "Replay" menu.
-->
<script lang="ts">
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ReplayIcon from '@lucide/svelte/icons/rotate-ccw';
	import UserIcon from '@lucide/svelte/icons/user-round';
	import BugIcon from '@lucide/svelte/icons/bug';
	import ChevronIcon from '@lucide/svelte/icons/chevron-right';
	import {
		adminCrumbs,
		Alert,
		Badge,
		DateTime,
		MoreMenu,
		PageHeader,
		ResultBadge,
		RichText,
		enhance,
		formatGrade,
		t,
		toastEnhance
	} from '#lib/components/course-admin/kit.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const s = $derived(data.submission);
	const base = $derived(`/admin/${data.course.id}`);
	const first = $derived(s.users[0]);
	const waiting = $derived(s.status === 'waiting');
	/** Replay entries: [action, label, admin only, icon]. */
	const replays = $derived(
		(
			[
				['replay', t('Replay submission'), true, ReplayIcon],
				['copy', t('Replay as {}', data.user?.realname), false, UserIcon],
				['debug', t('Replay/debug as {}', data.user?.realname), true, BugIcon]
			] as const
		).filter(([, , admin]) => data.admin || !admin)
	);
</script>

<PageHeader
	title={data.task.name}
	subtitle={t('Submission {} by {}', s.id, s.users.map((u) => u.realname).join(', '))}
	breadcrumbs={adminCrumbs(
		data.course,
		{ label: first.realname, href: `${base}/student/${first.username}` },
		{ label: data.task.name, href: `${base}/submissions?users=${first.username}&tasks=${data.task.id}` },
		s.id
	)}
>
	{#snippet actions()}
		{#if !waiting}<a class="btn preset-tonal" href={`${base}/submissions/submissions.tgz?submission=${s.id}`} download
				><DownloadIcon aria-hidden="true" />{t('Download full submission')}</a
			>{/if}
		<MoreMenu label={t('Replay')} icon={ReplayIcon} class="w-72 p-1.5">
			{#each replays as [action, label, , Icon] (action)}
				<form method="POST" action={`?/${action}`} use:enhance={toastEnhance()}>
					<button class="menu-item"><Icon aria-hidden="true" />{label}</button>
				</form>
			{/each}
		</MoreMenu>
	{/snippet}
</PageHeader>

<div class="space-y-6">
	<!-- Summary band: the key facts of the submission at a glance. -->
	<dl class="grid grid-cols-2 gap-x-6 gap-y-4 panel px-5 py-4 md:grid-cols-4">
		<div>
			<dt class="eyebrow">{t('Result')}</dt>
			<dd class="mt-1.5"><ResultBadge result={s.result} /></dd>
		</div>
		<div>
			<dt class="eyebrow">{t('Grade')}</dt>
			<dd class="text-2xl font-semibold tabular-nums">{waiting ? '—' : formatGrade(s.grade)}</dd>
		</div>
		<div>
			<dt class="eyebrow">{t('Submitted on')}</dt>
			<dd class="mt-1 text-sm font-medium"><DateTime value={s.submittedOn} /></dd>
		</div>
		<div class="min-w-0">
			<dt class="eyebrow">{t('Students')}</dt>
			<dd class="mt-1 space-y-0.5 text-sm">
				{#each s.users as u (u.username)}<a
						class="block truncate font-medium text-primary-700-300 hover:underline"
						href={`${base}/student/${u.username}`}
						>{u.realname} <span class="text-surface-600-400">{`(${u.username})`}</span></a
					>{/each}
			</dd>
		</div>
		{#if data.tags.length}
			<div class="col-span-full border-t border-surface-200-800 pt-3">
				<dt class="sr-only">{t('Tags')}</dt>
				<dd class="flex flex-wrap gap-1.5">
					{#each data.tags as tag, i (i)}<span title={tag.title}><Badge tone={tag.tone}>{tag.label}</Badge></span
						>{/each}
				</dd>
			</div>
		{/if}
	</dl>

	<div class="grid items-start gap-6 lg:grid-cols-2">
		<section class="space-y-3" aria-label={t('Answers')}>
			<h2 class="eyebrow">{t('Answers')}</h2>
			{#each data.inputs as p, i (p.id)}
				<article class="overflow-hidden panel">
					<header
						class="flex items-center gap-2 border-b border-surface-200-800 bg-surface-100-900 px-4 py-2.5 text-sm sm:px-5"
					>
						<span class="font-semibold">{t('Question {}: {}', i + 1, p.name)}</span>
						<code class="ms-auto text-xs text-surface-600-400">{p.id}</code>
					</header>
					<div class="space-y-3 p-4 sm:px-5">
						{#if !p.defined}<Alert kind="warning">{t('This problem id is not defined in the task.')}</Alert>{/if}
						<pre
							class="max-h-96 overflow-auto rounded-base bg-surface-100-900 px-3 py-2.5 text-[0.8125rem] leading-relaxed whitespace-pre-wrap">{p.value ||
								'—'}</pre>
					</div>
				</article>
			{:else}<p class="text-sm text-surface-600-400">{t('Nothing to show.')}</p>{/each}
		</section>
		<section class="space-y-3" aria-label={t('Feedback')}>
			<h2 class="eyebrow">{t('Feedback')}</h2>
			{#if data.feedback}
				{@const feedback = data.feedback}
				<article class="divide-y divide-surface-200-800 overflow-hidden panel">
					<div class="px-4 py-4 sm:px-5"><RichText html={feedback.text} class="prose-sm" /></div>
					{#each data.inputs.filter((p) => feedback.problems[p.id]) as p (p.id)}
						<div class="space-y-2 px-4 py-4 sm:px-5">
							<h3 class="text-sm font-semibold">{p.name}</h3>
							<RichText html={feedback.problems[p.id][1]} class="prose-sm" />
						</div>
					{/each}
				</article>
			{:else}<Alert>{t('This submission is being graded.')}</Alert>{/if}
			{#if data.debug}
				<details class="group panel">
					<summary class="flex list-none items-center gap-2 px-4 py-3 text-sm font-semibold sm:px-5">
						<ChevronIcon
							class="size-4 text-surface-500 transition-transform group-open:rotate-90 rtl:rotate-180"
							aria-hidden="true"
						/>
						<BugIcon class="size-4 text-surface-500" aria-hidden="true" />{t('Debug information')}
					</summary>
					<pre
						class="max-h-[32rem] overflow-auto border-t border-surface-200-800 bg-surface-100-900 px-4 py-3 text-xs sm:px-5">{data.debug}</pre>
				</details>
			{/if}
		</section>
	</div>
</div>
