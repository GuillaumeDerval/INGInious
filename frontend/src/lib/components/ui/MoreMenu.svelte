<!--
@component
Secondary actions menu (ux-design §2: secondary actions in a "⋯" menu, e.g.
import/export, staff tools): a button opening a floating card with the
`children` content; closes on Escape or when clicking outside (native `<details>`).

Props:
- `label` (string): button label.
- `icon` (Component | null, default ellipsis): icon before the label (none with null).
- `summaryClass` (string, default "preset-tonal"): extra classes of the button.
- `class` (string, default "w-80 space-y-3 p-4"): size/layout classes of the floating card.
- `iconOnly` (boolean, default false): icon-only trigger (`btn-icon`, label as tooltip and accessible name).
- `children` (Snippet): menu content (links, small forms; use the `menu-item` class for entries).

@example <MoreMenu label={t('Staff tools')} icon={WrenchIcon} summaryClass="preset-tonal btn-sm">...</MoreMenu>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';

	/** Props of MoreMenu. */
	export interface Props {
		/** Button label. */
		label: string;
		/** Icon before the label (null: none). */
		icon?: typeof EllipsisIcon | null;
		/** Extra classes of the button (tone, size). */
		summaryClass?: string;
		/** Size/layout classes of the floating card. */
		class?: string;
		/** Hides the label visually (icon-only button); the label stays the accessible name. */
		iconOnly?: boolean;
		/** Menu content. */
		children: Snippet;
	}

	let {
		label,
		icon: Icon = EllipsisIcon,
		summaryClass = 'preset-tonal',
		class: klass = 'w-80 space-y-3 p-4',
		iconOnly = false,
		children
	}: Props = $props();
	let menu: HTMLDetailsElement;
</script>

<svelte:window
	onclick={(e) => menu.open && !menu.contains(e.target as Node) && (menu.open = false)}
	onkeydown={(e) => e.key === 'Escape' && (menu.open = false)}
/>
<details class="relative" bind:this={menu}>
	<summary
		class="{iconOnly ? 'btn-icon' : 'btn'} cursor-pointer list-none {summaryClass}"
		title={iconOnly ? label : undefined}
		aria-label={iconOnly ? label : undefined}
		>{#if Icon}<Icon class="size-4" aria-hidden="true" />{/if}{#if !iconOnly}{label}{/if}</summary
	>
	<div class="absolute end-0 z-30 mt-1.5 panel shadow-lg {klass}">
		{@render children()}
	</div>
</details>
