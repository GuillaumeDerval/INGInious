<!--
@component
Thin progress bar at the very top of the window, shown while the application
waits for the server (page navigation, form submission, task action), so a slow
server never leaves a click without visual feedback. It only appears after
`delay` ms: fast responses do not flash it. The progress is indeterminate (a
segment in the INGInious green/yellow sweeping across); with reduced motion the
bar is static.

Props:
- `active` (boolean): true while something is loading.
- `delay` (number, default 150): milliseconds before the bar appears.
-->
<script lang="ts">
	import { t } from '#lib/i18n/index.js';

	/** Props of LoadingBar. */
	export interface Props {
		/** True while something is loading. */
		active: boolean;
		/** Milliseconds before the bar appears. */
		delay?: number;
	}

	let { active, delay = 150 }: Props = $props();

	/** True once the loading has lasted longer than `delay`. */
	let shown = $state(false);

	$effect(() => {
		if (!active) {
			shown = false;
			return;
		}
		const timer = setTimeout(() => (shown = true), delay);
		return () => clearTimeout(timer);
	});
</script>

{#if shown}
	<div
		role="progressbar"
		aria-label={t('Loading...')}
		class="bar pointer-events-none fixed inset-x-0 top-0 z-60 overflow-hidden bg-primary-200-800"
	>
		<div class="sweep h-full w-1/3 rounded-full bg-linear-to-r from-primary-500 via-secondary-300 to-primary-500"></div>
	</div>
{/if}

<style>
	/* Height set here (not with a utility class) so the bar never collapses. */
	.bar {
		height: 4px;
	}
	/* Starts mid-sweep (negative delay) so the segment is visible from the first frame. */
	.sweep {
		animation: sweep 1.1s ease-in-out -0.4s infinite;
	}
	@keyframes sweep {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sweep {
			width: 100%;
			animation: none;
		}
	}
</style>
