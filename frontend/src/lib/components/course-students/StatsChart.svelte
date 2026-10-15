<!--
@component
Chart of the statistics page (CSTU-17, Chart.js): a line chart (e.g. "All
submissions" and "Valid submissions" per hour or per day, area-filled) or a
bar chart (e.g. submissions per task, horizontal: every bar is labelled, long labels are
truncated with the full text in the tooltip, and the chart grows with the number of bars).
With `partial`, the last point of a line chart is a bucket still running (e.g. today): its
segment is dashed instead of looking like a drop. Colours come from the theme
tokens (CSS variables resolved at draw time) so the chart follows the palette,
light and dark mode; the chart is redrawn when the colour scheme changes. The
canvas has a textual summary for assistive technologies.

Props:
- `labels` (string[]): category labels (ISO start dates of the buckets with `dates`).
- `series` (ChartSeries[]): data series (label, values, palette colour).
- `type` ('line' | 'bar', default 'line'); `horizontal` (boolean): horizontal bars.
- `dates` ('hour' | 'day', optional): labels are ISO dates, formatted in the user's locale.
- `partial` (boolean, default false): the last bucket is incomplete (dashed segment).
- `summary` (string): accessible description of the chart.
-->
<script lang="ts" module>
	/** A data series of the chart. */
	export interface ChartSeries {
		label: string;
		data: number[];
		/** Palette colour (theme token family). */
		color: 'primary' | 'success' | 'warning' | 'error' | 'secondary' | 'tertiary';
	}

	/**
	 * Resolves a CSS colour expression (e.g. `var(--color-primary-500)`, OKLCH) to `rgba()` with the
	 * given alpha: Chart.js only parses rgb/hex colours, so the browser computes it on a 1px canvas.
	 */
	export function themeColor(expr: string, alpha = 1): string {
		const probe = document.createElement('span');
		probe.style.color = expr;
		document.body.append(probe);
		const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
		ctx.fillStyle = getComputedStyle(probe).color;
		probe.remove();
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
</script>

<script lang="ts">
	import {
		Chart,
		BarController,
		BarElement,
		LineController,
		LineElement,
		PointElement,
		LinearScale,
		CategoryScale,
		Filler,
		Legend,
		Tooltip
	} from 'chart.js';
	import { formatDate, uiPrefs } from '#lib/components/ui/prefs.js';

	/** Props of StatsChart. */
	export interface Props {
		labels: string[];
		series: ChartSeries[];
		type?: 'line' | 'bar';
		horizontal?: boolean;
		dates?: 'hour' | 'day';
		partial?: boolean;
		summary: string;
	}

	let { labels, series, type = 'line', horizontal = false, dates, partial = false, summary }: Props = $props();
	/** Longest category label shown on an axis (the tooltip shows the whole label). */
	const LABEL_MAX = 24;
	/** Truncates a category label to `LABEL_MAX` characters. */
	const short = (label: string) => (label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label);
	const prefs = uiPrefs();
	Chart.register(
		BarController,
		BarElement,
		LineController,
		LineElement,
		PointElement,
		LinearScale,
		CategoryScale,
		Filler,
		Legend,
		Tooltip
	);
	/** Colour scheme, tracked so that the chart is redrawn with the dark/light tokens. */
	let dark = $state(false);
	$effect(() => {
		const media = matchMedia('(prefers-color-scheme: dark)');
		const update = () => (dark = media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});

	/** Svelte attachment creating (and destroying) the chart on the canvas. */
	function chart(canvas: HTMLCanvasElement) {
		void dark; // redraw on colour scheme change
		const mode = dates === 'hour' ? ({ weekday: 'short', hour: 'numeric', minute: '2-digit' } as const) : 'date';
		const text = themeColor('var(--color-surface-600-400)');
		const grid = themeColor('var(--color-surface-200-800)');
		const font = { family: getComputedStyle(canvas).fontFamily, size: 12 };
		const axis = { ticks: { color: text, font }, grid: { color: grid }, border: { display: false } };
		const value = { ...axis, beginAtZero: true, ticks: { ...axis.ticks, precision: 0 } };
		// Horizontal bars: every bar keeps its (truncated) label; dates are skipped when crowded.
		const category = {
			...axis,
			grid: { display: false },
			ticks: horizontal
				? { ...axis.ticks, autoSkip: false, callback: (i: string | number) => short(labels[Number(i)]) }
				: { ...axis.ticks, maxRotation: 0, autoSkipPadding: 16 }
		};
		const last = labels.length - 1;
		const c = new Chart(canvas, {
			type,
			data: {
				labels: dates ? labels.map((iso) => formatDate(iso, prefs(), mode)) : labels,
				datasets: series.map((s) => {
					const color = themeColor(`var(--color-${s.color}-500)`);
					return {
						label: s.label,
						data: s.data,
						borderColor: color,
						backgroundColor: type === 'bar' ? color : themeColor(`var(--color-${s.color}-500)`, 0.12),
						fill: type === 'line',
						tension: 0.3,
						borderWidth: type === 'bar' ? 0 : 2,
						pointRadius: 0,
						pointHoverRadius: 4,
						pointBackgroundColor: color,
						// The running bucket (last point) is drawn dashed.
						segment: {
							borderDash: (ctx: { p1DataIndex: number }) => (partial && ctx.p1DataIndex === last ? [5, 4] : undefined)
						},
						borderRadius: 4,
						maxBarThickness: 18
					};
				})
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				indexAxis: horizontal ? 'y' : 'x',
				interaction: { mode: 'index', intersect: false },
				scales: horizontal ? { x: value, y: category } : { x: category, y: value },
				plugins: {
					legend: {
						position: 'bottom',
						labels: { color: text, font, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8 }
					},
					tooltip: { titleFont: font, bodyFont: font, padding: 10, cornerRadius: 8, boxPadding: 4 }
				}
			}
		});
		return () => c.destroy();
	}
</script>

<!-- Horizontal bars: about 2.5rem per category (two bars and their gap), at least the default height. -->
<div
	role="img"
	aria-label={summary}
	class="relative h-72"
	style:height={horizontal ? `max(18rem, ${labels.length * 2.5 + 3}rem)` : undefined}
>
	<canvas {@attach chart}></canvas>
</div>
