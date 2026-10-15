# UX redesign guidelines

The objective asks for every legacy feature to remain, but with a UI that is clearly
more beautiful, efficient and understandable than legacy INGInious (Bootstrap 4 pages
with long side columns, modals everywhere, jargon, little feedback on progress).
These guidelines are binding for every page. They must be applied **within the code
budget**: the improvements come from layout and component choices, not from extra code.

## 1. Principles

1. **Show progress and what to do next.** Students always see their grade/progress, the
   next deadline and the next task to work on. Staff see what needs attention.
2. **One primary action per screen**, visually dominant (filled primary button); secondary
   actions are tonal/ghost buttons or live in a "⋯" menu. Destructive actions are red and
   always confirmed (`ConfirmDialog`).
3. **Context is always visible**: breadcrumbs (`PageHeader`) — Course › Section › Task —
   and the sidebar shows the sections of the current context (course menu inside a course,
   admin menu inside the course administration).
4. **Progressive disclosure**: advanced options are collapsed by default (`<details>` /
   "Advanced settings" sections) instead of long forms; dangerous settings are grouped.
5. **Immediate feedback**: toasts after actions, inline validation messages next to the
   field, live submission status (queued → running → graded, with the queue position).
   A click never stays without feedback when the server is slow: the loading bar at the top
   of the window during navigations and requests (after 150 ms), and a spinner on the
   submit button of a pending form (a second submission is ignored).
6. **Plain language**: explain jargon (dispenser → "Task list layout", environment →
   "Grading environment", audience → "Audience (class group)"). Reuse legacy msgids only
   when the wording is clear.
7. **Responsive & accessible**: every page usable at 390 px, keyboard navigation, visible
   focus, labels on every input, colour is never the only signal (icons + text), dark mode.
8. **Empty states teach**: every empty list says why it is empty and what to do
   (`EmptyState` with an action).

## 2. Page patterns

### Student side
* **My courses (dashboard)**: "Continue where you left off" strip (last tried tasks as
  cards with status), then course cards (pinned first) showing name, role badge, progress
  bar (grade %), tasks succeeded/total and the next deadline; filters as chips
  (All / Pinned / Archived / LTI), search box. Upcoming deadlines (upcoming_tasks plugin)
  as a compact list when enabled.
* **Course list**: searchable card grid; each card states its access clearly
  ("Open", "Password required", "Registration closed", "Preview available") with a single
  call-to-action (Register / Open / Preview).
* **Course page**: header with course name, overall grade ring/bar and "x / y tasks
  succeeded"; tasks grouped by section (collapsible), each row: status icon, name, grade,
  deadline chip ("due in 2 days", red when close/past), category chips; filter chips for
  categories; the description below the header (collapsible when long). Staff see an
  "Administration" button.
* **Task page**: two columns on wide screens — statement on the left, answer panel on the
  right (sticky); on small screens stacked. The answer panel holds the problems, the Submit
  button (also `Ctrl/Cmd+Enter`), limits as chips near the title ("3 submissions left",
  "Deadline Mon 14:00", "Group: Team A"), the latest result card on top (ResultBadge +
  grade + feedback), per-problem feedback directly under each problem, and the history as
  a compact timeline (evaluated submission marked, click to reload). Staff tools (debug,
  SSH, view all submissions) are grouped in a "Staff tools" menu.

### Course administration
* **Admin sidebar** with clear groups: *Course* (Settings, Task list, Danger zone),
  *People* (Students, Audiences, Groups), *Results* (Submissions, Statistics).
* **Settings**: one page with section cards (General, Access & registration, Staff,
  Groups, LTI, Tags) and an anchor list on wide screens; a sticky save bar appears when
  there are unsaved changes; dates use native date-time inputs.
* **Task list editor**: sections as cards with drag & drop tasks; per-task settings open in
  a side panel (not a modal over a modal); badges summarise each task's settings
  (weight, limits, hidden, group).
* **Task editor**: vertical tabs (General, Grading environment, Problems, Files, plugin
  tabs); problems as reorderable cards with type icon; every rich text field is a
  `RichTextInput` (RST/Markdown switch + preview); sticky save bar with unsaved indicator;
  validation errors listed at the top and highlighted in place.
* **Students / audiences / groups**: searchable tables with bulk actions; groups as cards
  with capacity indicator (3/4) and member chips; import/export in a secondary menu.
* **Submissions**: collapsible filter panel (most used filters first), results table with
  result badges and grades, selection + bulk action bar (download, replay); the
  submission view is split: input on the left, feedback on the right.
* **Statistics**: KPI cards on top (submissions, success rate, average grade, active
  students) then charts and tables.

### Site
* **Sign-in / registration**: centred card, external providers as buttons with icons above
  the password form, password strength hint, clear generic error messages.
* **Preferences**: tabs (Profile, Sign-in methods, Delete account) with the danger action
  isolated.
* **User administration**: searchable table with inline actions.

## 3. Visual language

INGInious Skeleton theme and component classes (**`docs/design-system.md`, binding**); cards with subtle borders and rounded corners; generous
spacing (`space-y-6` between sections); headings `h1` page title (via `PageHeader`), `h2`
section titles; icons from `@lucide/svelte` next to labels for scanning; status colours:
success = green, failed/crash/error = red, timeout/overflow/killed = amber, waiting = blue
(see `ResultBadge`); numbers right-aligned in tables; dates relative when close
("in 2 days") with the absolute date in a tooltip (`DateTime`).
