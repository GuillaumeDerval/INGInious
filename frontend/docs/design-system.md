# INGInious design system (binding for every page)

Calm, modern, content-first. Reference pages: the task page (`lib/components/task/TaskView.svelte`)
and the admin task list (`routes/admin/[courseid]/tasks`, `course-admin/TocEditor.svelte`).
Copy their patterns before inventing new ones. Complements `docs/ux-design.md` (UX rules).

## 1. Where things live

| File | Content |
|---|---|
| `src/lib/styles/theme.css` | Skeleton theme `inginious` (`data-theme` in `src/app.html`): palettes, fonts, radii, backgrounds |
| `src/lib/styles/components.css` | component layer: Skeleton overrides (`btn`, `badge`, `input`, `checkbox`, `table`...) + utilities `panel`, `eyebrow`, `kv`, `kbd`, `menu-item` |
| `src/lib/components/ui/*` | kit components (Card, PageHeader, Badge, Alert, EmptyState, MoreMenu, CopyField, DataTable...) |
| `static/logo.png` | INGInious logo (header, favicon) |

No per-page `<style>` blocks and no new colours: use tokens and the classes below. The
`@tailwindcss/forms` plugin is **not** used (it fought Skeleton's form classes).

## 2. Tokens

**Colours** (OKLCH, shades 50–950; use Skeleton light/dark pairs such as `text-surface-600-400`):

| Palette | Role |
|---|---|
| `primary` (snake green of the logo, #618d34) | brand, primary buttons, links, focus ring, active nav, selection |
| `secondary` (hat yellow of the logo, #ffe85f) | highlights only, ALWAYS with dark text (`bg-secondary-300 text-secondary-950`): active-item indicator, header brand strip, course badge, stars/pinned, "current"/"new" badges |
| `tertiary` (coral of the logo) | rare accents (illustrations, charts) |
| `success` (emerald) / `warning` (amber) / `error` | results and states (ResultBadge, Alert, destructive actions) — hues kept apart from the brand green/yellow |
| `surface` (warm neutrals, green hint) | text, borders, backgrounds |

The logo is `/logo.svg` (official INGInious snake with its hat). Brand colours are the user's
explicit request (objective.md): new UI must use green + yellow consistently.

**Surfaces.** Page = root background (surface-100 light, near-black dark). Elevated (cards,
inputs, popovers, header) = `bg-surface-50-950` (use `panel`). Subtle fill inside a card
(table header, config band, code block) = `bg-surface-100-900`. Borders = `border-surface-200-800`.
Tints of a colour on any surface: `bg-<color>-500/10` + `text-<color>-700-300` (+ `ring-<color>-500/25`).

**Text.** Body 15px (`--typo-base--font-size`), UI text `text-sm` (14px), meta `text-xs` (12px,
the minimum, never smaller). Primary text = inherited; secondary = `text-surface-600-400`;
placeholder/disabled = `text-surface-500`. Headings weight 650, tracking `-0.015em`.
Page title `text-2xl sm:text-[1.75rem] font-semibold` (PageHeader); card title `text-base font-semibold`;
section label `eyebrow`. Numbers in tables/grades: `tabular-nums`. Code: `font-mono`.

**Shape & depth.** `rounded-base` (8px: buttons, inputs, rows), `rounded-container` (12px: cards,
alerts, dialogs). Cards: hairline border + `panel` shadow; menus `shadow-lg`; dialogs `shadow-2xl`.
**Focus:** every focusable element shows a 2px primary outline (`:focus-visible`, global);
inputs show a primary border + halo. Never remove outlines.

**Spacing.** Page sections `space-y-6`; inside cards `space-y-4`; card padding `p-4 sm:p-6`
(Card) or `px-4 py-3 sm:px-5` for header/footer bands; list rows `py-2 px-3`.

## 3. Components and classes

**Buttons** (`btn` = 36px, `btn-sm` = 31px, `btn-lg` = 40px; never mix sizes in one row):
- primary (one per screen): `btn preset-filled-primary-500`
- secondary: `btn preset-tonal`; tinted secondary: `btn preset-tonal-primary|warning`
- ghost (toolbars, rows): `btn hover:preset-tonal`
- danger: trigger `btn preset-tonal-error`, confirmation `btn preset-filled-error-500` (ConfirmDialog)
- icon button: `btn-icon` (+`btn-icon-sm` in rows) `text-surface-600-400 hover:preset-tonal`, **always**
  `aria-label` and `title` (tooltip) with the same text. Icons are lucide, `size-4`, before the label.
- Every button has the `btn`/`btn-icon` base class (a bare `preset-tonal btn-sm` is a bug).

**Row actions** (tables, list rows): at most 2–3 visible icon buttons (most frequent: settings,
edit, view), the rest in an icon-only `MoreMenu` (`iconOnly`, label "More actions") whose entries
use `menu-item` (icon + text); destructive entries `text-error-600-400`, delete via a trash icon menu
or `ConfirmDialog`. See `TocEditor` and `course-students/SubmissionTable`.

**Badges** — `Badge` (tones neutral/primary/success/warning/error, optional icon): 12px, tinted
with a hairline ring. Results: `ResultBadge`. Counts in headers: `<Badge>{n}</Badge>`.
Filter chips: `chip` + `preset-filled-primary-500` (active) / `preset-tonal` (inactive).

**Forms** — `FormField` (label + hint + error, a11y attrs) around `input`, `select`, `textarea`
(36px, 14px text; `field-sm` for compact rows); checkboxes/radios `checkbox`/`radio` (custom,
brand fill); labels `label-text` (13px medium) or FormField. Group long forms in Cards; sticky
`SaveBar` at the bottom; inline errors with `aria-invalid`.

**Cards** — `Card` (title, description, actions, content) for page sections; raw `panel` for custom
cards (list cards, result cards with tinted header band: see `SubmissionResult`).
A card with a list: header band `border-b`, rows `divide-y divide-surface-200-800`, footer band.

**Key/value info** — `<dl class="kv"><dt>Label</dt><dd>Value</dd></dl>` (two columns, muted keys,
medium values). Big figures: `eyebrow` label above `text-2xl font-semibold tabular-nums` (TaskInfo).

**Tables** — `DataTable` (or `table` inside a `panel`): header band, 12px semibold headers, hover
rows, numbers right-aligned (`text-end tabular-nums`), actions in the last column as icon buttons.

**Alerts** — `Alert` (info/success/warning/error, title, dismissible): tinted box + coloured icon.
Toasts (`notify`) for action feedback; Alert for persistent page state.

**Loading** — `LoadingBar` (in the shell): indeterminate green/yellow bar at the top of the window
while a navigation or a tracked request is pending (`loading.svelte.ts`: `track()` / `start()`).
Every enhanced form uses `toastEnhance()` or `busyEnhance()`: the form and its submit button get
`aria-busy="true"`, the button shows a spinner instead of its icon and cannot be clicked again.
Local waits (search fields, submission grading) show their own spinner (`LoaderIcon animate-spin`).

**Empty states** — `EmptyState` (icon in a tinted circle, title, description, actions); `compact`
inside cards/side panels. Every empty list explains why and offers the next action.

**Menus & dialogs** — `MoreMenu` (secondary actions, content `class="w-56 p-1.5"` + `menu-item`
entries); `ConfirmDialog` for destructive actions; side panels: native `<dialog>` aligned to the
end with sticky header/footer (TocEditor task settings).

**Secrets** — `CopyField` (label, value, `secret`): monospace, copy button, masked with reveal.

**Navigation** — sidebar sections come from `nav: NavSection[]`; a section with `context`
(subtitle) and optional `contextHref` renders a context header card (e.g. the course in the admin
area: put it first). Active item = white pill with primary text and a hat-yellow left indicator.

## 4. Page anatomy

1. `PageHeader`: breadcrumbs (muted, last = current page), title, optional one-line `subtitle`
   explaining the page, actions on the right (secondary/icon buttons; the primary action of the
   page usually lives where the work happens, e.g. the submit bar or the SaveBar).
2. Page-level alerts (`space-y-3`).
3. Content: `space-y-6` stack of Cards; settings-like pairs side by side with
   `grid gap-4 lg:grid-cols-2`; work pages in two columns (`lg:grid-cols-2`, reading content left,
   sticky action panel right, stacked on mobile).
4. Sticky bottom `SaveBar` for forms with unsaved changes.

Responsive: everything must work at 390px (stack columns, wrap action rows, tables scroll in their
`panel`); check light and dark (`prefers-color-scheme`).

## 5. Do / don't

- Do use one primary button per view; don't put several filled buttons side by side.
- Do use icon buttons with tooltips for repeated row actions; don't render 5 text buttons per row.
- Do use `text-surface-600-400` for secondary text; don't use opacity or raw greys (`text-gray-*`).
- Do use tints (`bg-x-500/10`) for status; don't use saturated fills for large areas.
- Do keep text ≥ 12px and contrast AA; don't rely on colour only (add icon or text).
- Do use `Card`/`panel`; don't hand-roll `card border ... shadow` combinations.
- Do write plain-language subtitles and empty-state hints; don't leave blank areas.
- Don't add CSS files, `<style>` blocks or new npm dependencies for styling.
