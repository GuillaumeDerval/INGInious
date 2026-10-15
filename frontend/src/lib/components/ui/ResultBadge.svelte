<!--
@component
Badge showing the result of a submission (TASK/SUB features): maps the
INGInious result codes (success, failed, crash, timeout, overflow, killed,
error, waiting) to a color, an icon and a translated label. Unknown values
are shown as is with a neutral color.

Props:
- `result` (string): result code (`submissions.result`, or "waiting" while grading).
- `grade` (number, optional): grade (0-100) appended to the label.
-->
<script lang="ts">
	import type { Component } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/circle-check';
	import XIcon from '@lucide/svelte/icons/circle-x';
	import BugIcon from '@lucide/svelte/icons/bug';
	import ClockIcon from '@lucide/svelte/icons/clock-alert';
	import MemoryIcon from '@lucide/svelte/icons/memory-stick';
	import SkullIcon from '@lucide/svelte/icons/octagon-x';
	import AlertIcon from '@lucide/svelte/icons/triangle-alert';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import { t } from '#lib/i18n/index.js';
	import { formatGrade } from '#lib/utils/grade.js';
	import Badge, { type Tone } from './Badge.svelte';

	/** Props of ResultBadge. */
	export interface Props {
		/** Result code. */
		result: string;
		/** Optional grade, in percent. */
		grade?: number;
	}

	let { result, grade }: Props = $props();

	/** Presentation of every known result code. */
	const RESULTS: Record<string, { tone: Tone; icon: Component; label: () => string }> = {
		success: { tone: 'success', icon: CheckIcon, label: () => t('Succeeded') },
		failed: { tone: 'error', icon: XIcon, label: () => t('Failed') },
		crash: { tone: 'error', icon: BugIcon, label: () => t('Crash') },
		timeout: { tone: 'warning', icon: ClockIcon, label: () => t('Timeout') },
		overflow: { tone: 'warning', icon: MemoryIcon, label: () => t('Overflow') },
		killed: { tone: 'warning', icon: SkullIcon, label: () => t('Killed') },
		error: { tone: 'error', icon: AlertIcon, label: () => t('Internal error') },
		waiting: { tone: 'primary', icon: LoaderIcon, label: () => t('Waiting') }
	};

	const view = $derived(RESULTS[result] ?? { tone: 'neutral' as Tone, icon: AlertIcon, label: () => result });
	const text = $derived(grade === undefined ? view.label() : `${view.label()} · ${formatGrade(grade)}`);
</script>

<Badge tone={view.tone} icon={view.icon}>
	{text}
</Badge>
