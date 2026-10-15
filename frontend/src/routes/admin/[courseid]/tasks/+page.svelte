<!--
@component
Task list administration page (CADM-06..09, reference page of docs/design-system.md):
legacy task migration banner, layout (dispenser) choice as described radio cards and WebDAV credentials side by
side (copyable, password masked; a button generates the password when the admin has none yet), then the course
structure editor.
-->
<script lang="ts">
	import {
		adminCrumbs,
		Alert,
		Card,
		CopyField,
		PageHeader,
		TocEditor,
		enhance,
		t,
		toastEnhance
	} from '#lib/components/course-admin/kit.js';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const course = $derived(data.adminCourse);
	/** Name and plain-language description of each layout (dispenser). */
	const NAMES: Record<string, [string, string]> = {
		toc: ['Table of contents', 'Sections of tasks shown in order.'],
		combinatory_test: ['Combinatory test', 'Each student sees a random subset of the tasks of each section.'],
		contest: ['Contest', 'Sections of tasks with the timing and scoreboard of a contest.']
	};
</script>

<PageHeader
	title={t('Task list')}
	subtitle={t('Organise the tasks of the course in sections and set their grading options.')}
	breadcrumbs={adminCrumbs(course, t('Task list'))}
/>

<div class="space-y-6">
	{#if data.legacy}
		<Alert kind="warning">
			{t(
				'This course currently includes legacy tasks with settings that have to be imported to the task dispenser settings to be effective.'
			)}
			<form method="POST" action="?/migrate" use:enhance={toastEnhance()}>
				<button class="mt-2 btn preset-filled-warning-500 btn-sm">{t('Migrate tasks')}</button>
			</form>
		</Alert>
	{/if}
	<div class={['grid gap-4', data.webdav && 'lg:grid-cols-2']}>
		<Card
			title={t('Task list layout')}
			description={t('Changing it wipes the current structure (task files are kept).')}
		>
			<form method="POST" action="?/dispenser" class="space-y-4" use:enhance={toastEnhance()}>
				<fieldset class="space-y-2">
					<legend class="sr-only">{t('Task list layout')}</legend>
					{#each data.dispensers as d (d)}
						<label
							class="flex cursor-pointer items-start gap-3 rounded-base border border-surface-200-800 px-3 py-2 transition-colors hover:bg-surface-100-900/60 has-checked:border-primary-500/60 has-checked:bg-primary-500/5"
						>
							<input type="radio" class="mt-0.5 radio" name="dispenser" value={d} checked={d === data.kind} />
							<span class="min-w-0">
								<span class="flex items-center gap-2 text-sm font-medium"
									>{t(NAMES[d][0])}{#if d === data.kind}<span class="badge bg-secondary-300 text-secondary-950"
											>{t('Current')}</span
										>{/if}</span
								>
								<span class="block text-xs text-surface-600-400">{t(NAMES[d][1])}</span>
							</span>
						</label>
					{/each}
				</fieldset>
				<button class="btn preset-tonal-warning btn-sm">{t('Change layout')}</button>
			</form>
		</Card>
		{#if data.webdav}
			<!-- Flex column: the client hint sits at the bottom, level with the layout card. -->
			<Card
				class="flex flex-col"
				title={t('WebDAV access')}
				description={t('Use this URL to access your course folder using WebDAV:')}
			>
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="sm:col-span-2"><CopyField label="URL" value={data.webdav.url} /></div>
					<CopyField label={t('Username')} value={data.webdav.username} />
					{#if data.webdav.password}
						<CopyField label={t('Password')} value={data.webdav.password} secret />
					{:else}
						<form method="POST" action="?/webdav" class="self-end" use:enhance={toastEnhance()}>
							<button class="btn preset-tonal btn-sm"><KeyIcon />{t('Generate secret')}</button>
						</form>
					{/if}
				</div>
				<p class="mt-auto border-t border-surface-200-800 pt-4 text-xs text-surface-600-400 max-lg:mt-4">
					{t('Any WebDAV client (Finder, Windows Explorer, Cyberduck...) can edit the task files in bulk.')}
				</p>
			</Card>
		{/if}
	</div>
	{#if data.kind === 'combinatory_test'}
		<Alert kind="info" title={t('Combinatory tests')}
			>{t(
				'Only the specified amount of tasks to be displayed will be shown to the user. There is no state: changing the amount of tasks per section, section position or section title will affect the effective task set a user will be displayed.'
			)}</Alert
		>
	{/if}
	{#key data.structure}
		<TocEditor
			kind={data.kind}
			structure={data.structure}
			tasks={data.tasks}
			errors={data.errors}
			courseid={course.id}
		/>
	{/key}
</div>
