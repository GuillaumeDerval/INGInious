<!--
@component
Task list of a course page (NAV-10, NAV-12, NAV-13): nested sections
rendered recursively; terminal sections are collapsible cards (`<details>`,
closed when configured so) whose header shows the title and the number of
tasks (succeeded / total for registered users). Each task row shows a status
icon (succeeded, closed, to do), the name, category chips, the deadline chip
or "deadline reached", the weight when it is not 1 and, for registered users,
the grade bar. With a category filter, sections without matching task are hidden.
A section without any visible task yet (e.g. future tasks; legacy shows its empty card unless
it is configured "Hidden if empty") has no count and says "No task available yet".
Sections of large courses come without their tasks (`tasks: null`, closed):
they are fetched from `GET /course/<id>/$section?path=<path>` (JSON)
the first time they are opened.

Props:
- `sections` (SectionView[]): sections to render.
- `courseid` (string): course of the task links.
- `registered` (boolean, default false): shows the grade bars and succeeded counts.
- `category` (string, default ''): only tasks of this category are shown ('' = all).
- `level` (number, default 2): heading level of these sections.
-->
<script lang="ts" module>
	import type { SectionView, TaskItem } from './types.js';

	/** [succeeded, total] visible tasks of a section (recursively) matching `category` ('' = all). */
	export const sectionCount = (section: SectionView, category = ''): [number, number] =>
		section.stats[category] ?? [0, 0];

	/** Number of visible tasks of a list of sections matching `category`. */
	export function countTasks(sections: SectionView[], category = ''): number {
		return sections.reduce((n, s) => n + sectionCount(s, category)[1], 0);
	}
</script>

<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import LockIcon from '@lucide/svelte/icons/lock';
	import ChevronIcon from '@lucide/svelte/icons/chevron-right';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import { track } from '#lib/components/layout/loading.svelte.js';
	import { t } from '#lib/i18n/index.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import GradeBar from '#lib/components/ui/GradeBar.svelte';
	import DeadlineChip from './DeadlineChip.svelte';
	import TaskList from './TaskList.svelte';

	export interface Props {
		sections: SectionView[];
		courseid: string;
		registered?: boolean;
		category?: string;
		level?: number;
	}
	let { sections, courseid, registered = false, category = '', level = 2 }: Props = $props();
	const tag = $derived(`h${Math.min(level, 6)}`);
	/** Tasks fetched for the sections sent without them, by path (`false`: the request failed). */
	let loaded = $state<Record<string, TaskItem[] | false>>({});

	/** Fetches the tasks of a section sent without them, the first time it is opened. */
	async function load(section: SectionView, details: HTMLDetailsElement) {
		if (!details.open || section.tasks || section.path in loaded) return;
		const url = `/course/${courseid}/$section?path=${encodeURIComponent(section.path)}`;
		const res = await track(fetch(url, { headers: { accept: 'application/json' } }).catch(() => null));
		loaded[section.path] = res?.ok ? ((await res.json()) as TaskItem[]) : false;
	}
</script>

{#each sections as section (section.path)}
	{@const [done, total] = sectionCount(section, category)}
	{#if total || !category}
		{#if section.sections}
			<section class="space-y-3">
				<svelte:element this={tag} class="pt-2 text-lg font-semibold">{section.title}</svelte:element>
				<TaskList sections={section.sections} {courseid} {registered} {category} level={level + 1} />
			</section>
		{:else}
			{@const tasks = section.tasks ?? loaded[section.path]}
			<details
				class="group overflow-hidden panel"
				open={!section.closed}
				ontoggle={(e) => load(section, e.currentTarget)}
			>
				<summary
					class="flex list-none items-center gap-3 px-4 py-3 select-none hover:bg-surface-100-900 sm:px-5 [&::-webkit-details-marker]:hidden"
				>
					<ChevronIcon
						class="size-4 shrink-0 text-surface-500 transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90"
						aria-hidden="true"
					/>
					<svelte:element this={tag} class="min-w-0 flex-1 text-base font-semibold">{section.title}</svelte:element>
					<!-- No count for an empty section: its body explains it. -->
					{#if total && registered}
						<Badge tone={done === total ? 'success' : 'neutral'}>{`${done} / ${total}`}</Badge>
					{:else if total}
						<Badge>{total}</Badge>
					{/if}
				</summary>
				{#if !total}
					<p class="border-t border-surface-200-800 px-4 py-3 text-sm text-surface-600-400 sm:px-5">
						{t('No task available yet')}
					</p>
				{:else if tasks}
					<ul class="divide-y divide-surface-200-800 border-t border-surface-200-800">
						{#each tasks.filter((task) => !category || task.categories.includes(category)) as task (task.id)}
							<li>
								<a
									href={`/course/${courseid}/${task.id}`}
									class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-primary-500/5 sm:px-5"
								>
									{#if task.succeeded}
										<CheckIcon class="size-[1.125rem] shrink-0 text-success-600-400" aria-label={t('Succeeded')} />
									{:else if !task.open}
										<LockIcon class="size-[1.125rem] shrink-0 text-surface-500" aria-hidden="true" />
									{:else}
										<CircleIcon class="size-[1.125rem] shrink-0 text-surface-300-700" aria-hidden="true" />
									{/if}
									<span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
										<span class={['font-medium', !task.open && 'text-surface-600-400']}>{task.name}</span>
										{#if !task.open}<Badge tone="error">{t('deadline reached')}</Badge>{:else}<DeadlineChip
												value={task.deadline}
											/>{/if}
										{#each task.categories as cat (cat)}<Badge tone="primary">{cat}</Badge>{/each}
										{#if task.weight !== 1}<Badge>{`${t('Weight')}: ${task.weight}`}</Badge>{/if}
									</span>
									{#if registered}<span class="w-24 shrink-0 sm:w-36"><GradeBar value={task.grade} /></span>{/if}
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<p
						class="flex items-center gap-2 border-t border-surface-200-800 px-4 py-3 text-sm text-surface-600-400 sm:px-5"
					>
						{#if tasks === false}{t('Internal error')}{:else}<LoaderIcon
								class="size-4 animate-spin"
								aria-hidden="true"
							/>{t('Loading...')}{/if}
					</p>
				{/if}
			</details>
		{/if}
	{/if}
{/each}
