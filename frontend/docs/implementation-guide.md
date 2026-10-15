# Implementation guide for feature agents

Read `objective.md` and `docs/architecture.md` first (binding rules). This guide lists
what already exists and the exact conventions to follow so that every area looks and
behaves the same. **Do not re-implement anything listed here.**

## 1. Existing server modules (`app/src/lib/server`)

| Module | Exports (main) |
|---|---|
| `app.ts` | `services()` → `{ config, db, sessions, backend }` (singletons), `setServices()` (tests) |
| `config.ts` | `AppConfig` (typed configuration.yaml, `raw` for other keys), `buildConfig()` |
| `db/index.ts` | `Database` (`db.c.users`, `.sessions`, `.submissions`, `.userTasks`, `.courses`, `.audiences`, `.groups`, `.nonce`, `.lisOutcomes`, `.ltiGrades`, `.ltiLaunch`, `.dbVersion`; `putFile/getFile/deleteFile` GridFS exactly like pymongo; `putInput/getInput` BSON submission input), `ObjectId`, `DB_VERSION` |
| `db/types.ts` | document types of every collection (DO NOT change the DB format) |
| `auth/session.ts` | `SessionStore` (`markDirty`, `rotate` (call at login!), `destroy` (logout), `sign/verify` tokens), `Session` |
| `auth/passwords.ts` | `hashPassword`, `verifyPassword` (argon2id/sha512 legacy formats), `needsRehash` |
| `backend/client.ts` | `BackendClient`: `newJob(job, {onDone, onSsh, onStarted})`, `killJob`, `environments`, `queue`, `jobQueueInfo` |
| `request.ts` | request pipeline (already wired in hooks.server.ts): `locals.session`, `locals.user` (`CurrentUser`), `locals.lang` |
| `security/guards.ts` | `requireUser(event)`, `requireSuperadmin(event)`, `forbidLti(event)`, `safeRedirectTarget()`, `signinUrl()` |
| `security/paths.ts` | `safeJoin(base, ...untrusted)`, `cleanRelativePath`, `isValidId` |
| `courses/*` | course/task domain (see the API summary in §4) incl. course guards in `courses/access.ts`: `requireCourse`, `requireCourseAccess`, `requireCourseStaff`, `requireCourseAdmin` |
| `plugins/index.ts` | `plugins()` registry: `addHook`, `callHook`, `callHookRecursive`, `isEnabled`; `BUNDLED` loaders map (legacy module name → TS plugin `init`) |
| `mail.ts` | `sendMail({to, name, subject, text})`, `publicUrl(path, url)` (`base_url` config, else the deployment origin, request origin only on localhost; throws otherwise — see docs/reference/config.md §8) |
| `flash.ts` | flash messages for redirects (see UI section) |
| `text/*` | `renderText(source, {format, ...})` → `SafeHtml` (RST or Markdown, sanitized) — see §5 |

i18n: `import { t } from '#lib/i18n/index.js'` works on server and client. **Reuse the
legacy English msgids** (grep `legacy/inginious/frontend/i18n/messages.pot`) whenever the
wording fits, so the 9 legacy translations apply automatically.

## 2. Routes, forms and endpoints

* Pages: `+page.server.ts` `load` = guard → domain call → return plain serialisable data
  (never Mongo documents with ObjectIds/Dates you did not convert, never secrets).
* Mutations: SvelteKit **form actions** (`actions = { name: async (event) => {...} }`),
  POST only, validated with zod (`z.object(...).safeParse(Object.fromEntries(await request.formData()))`),
  errors returned with `fail(400, { error: t('...') })`. Use `use:enhance` in the page.
* JSON endpoints (`+server.ts`) only where the UI needs AJAX (polling, autocomplete...)
  or for the REST API. Always guard them. Return `Response.json(...)`.
* No GET request may change state.
* Real status codes: `error(404, ...)`, `error(403, ...)`; never "Forbidden" with 200.
* Legacy URLs should be kept when reasonable (`/course/<c>/<t>`, `/admin/<c>/...`,
  `/api/v0/...`, `/lti/...`) so bookmarks and LMS links keep working.

## 3. UI

**Apply `docs/ux-design.md` (binding UX redesign guidelines) to every page.**

* Compose pages from components; every component displays its own data (typed props,
  empty state, formatting, i18n). Put area components in `lib/components/<area>/`.
* Reuse the UI kit (`lib/components/ui/*`, `lib/components/layout/*`) and Skeleton classes.
* Shell conventions (read `lib/components/layout/*` and `ui/*` sources before writing pages):
  - sidebar sections: a page or nested layout `load` returns `nav: NavSection[]` (types in
    `#lib/components/layout/nav.js`; use a universal `+layout.ts` to attach icon components);
  - flash after redirect: `setFlash(cookies, 'success'|'error'|'info'|'warning', t('…'))` from `#lib/server/flash.js`;
  - form actions return `{ message }` / `fail(code, { message })` and pages use
    `use:enhance={toastEnhance(t('Saved.'))}` (`#lib/components/layout/toaster.js`, also `notify(kind, msg)`);
  - `PageHeader` sets the document title; `DateTime`/`CodeEditor` read the user's locale,
    timezone and indentation from context (no props needed);
  - `SearchSelect` endpoints answer `GET url?q=` with `[{ value, label }]`;
  - root layout data: `user`, `lang`, `isLti`, `timezone`, `codeIndentation`, `version`,
    `allowRegistration`, `privacyHref`, `flash`.
* Rich text (task context, feedback, descriptions) only through
  `lib/components/common/RichText.svelte` with server-rendered `SafeHtml`.

## 4. Course domain API (`#lib/server/courses/<file>.js`)

* `accessible.ts`: `parseDate`, `accessibleTime(value)` → `{start,end,softEnd}`, `isOpen`, `isOpenWithSoftDeadline`, `stdDate`...
* `files.ts`: `idChecker`, `coursePath`, `parseYaml`/`dumpYaml` (legacy-compatible YAML), `writeFileAtomic`, `translator`.
* `course.ts`: `Course` (`tr(lang, text)`, `textFormat`, `dispenser`, ACL, LTI/archive flags), `getCourse` (throws `NotFoundError`), `listCourses`, `courseTaskIds`, `saveCourse`, `createCourse`, `deleteCourse`.
* `task.ts`: `Task` (`textFormat`, `environmentParameters`, `problems`, `tr`), `getTask`, `listTasks`, `saveTask`, `createTask`, `deleteTask`, `migrateTaskContent`, `hasLegacyTasks`, `importLegacyTasks`.
* `dispenser.ts`: toc / combinatory_test / contest: `parseDispenser`, `parseTaskConfig`, `taskConfig`, `groupSubmission`, `accessibility`, `userTaskList`, `courseGrades`, `allCategories`, `orderedTasks`, `checkDispenserData`, `sectionTasks`.
* `problems.ts`: `createProblem`, `problemView(problem, {language, username, tr, defaults})`, `buildInput(problems, formData, defaults)` → legacy input dict or null, `registerProblemType`.
* `members.ts`: `isSuperadmin`, `isCourseAdmin`, `isCourseStaff`, `isRegistered`, `registeredUsers`, `addStudent`, `unregisterUser`, `courseAudiences`, `audiencesPerStudent`, `courseGroups`, `userGroup`, `allowedGroups`, `joinGroup`, `leaveGroup`, `pinnedCourses`, `pinCourse`, `unpinCourse`, `userSawTask`, `taskCaches`, `courseCaches`, `checkTokens`.
* `access.ts`: `courseIsOpenToUser`, `isAcceptedByAcl`, `isRegistrationPossible`, `registerUser`, `taskIsVisibleByUser`, `taskCanUserSubmit`, `closedMessage` + the course guards.

Read the source of the module before using it (exported functions are documented).

## 5. Text rendering

`import { renderText } from '#lib/server/text/index.js'` —
`renderText(source, { showEverything, headerLevel, random, language, ltiAssetRewrite, now })`.
**Markup choice (objective):** every text is reStructuredText unless its first line is
`#MD`, then it is Markdown — detected per text by `renderText` (no setting, no
`text_format` key: it was removed). Editors must use `#lib/components/ui/RichTextInput.svelte`
(RST/Markdown switch hiding the marker, optional server preview via `previewUrl`); the
helpers are in `#lib/utils/text-format.js`. Grader feedback may also start with `#MD`.
→ `SafeHtml` (`#lib/utils/safe-html.js`, also `textToSafeHtml`; `escapeHtml` in `#lib/utils/escape.js`), displayed with
`<RichText html={...} />` (`#lib/components/common/RichText.svelte`: math, code highlighting,
`<time>` formatting, legacy Bootstrap classes styled). Render on the server (inside the request,
so fixed strings are translated). Grader feedback uses the task's format. Output is always sanitized.

## 6. Plugins

Only the hooks used by bundled plugins are implemented (third-party Python plugins cannot
run in this frontend): `main_menu`, `course_menu`, `task_menu` (return `NavItem`s instead of
HTML), `submission_done`, `task_editor_tab`, `task_editor_submit`, plus plugin pages (normal
SvelteKit routes that 404 when the plugin is not enabled: `plugins().isEnabled(module)`).
A bundled plugin is a file `lib/server/plugins/bundled/<legacy.module.name>.ts` exporting
`init(registry, options)`; it is discovered automatically (no central list to edit).

## 7. Tests (mandatory for every feature)

* **Unit/component**: next to the code (`*.test.ts` server project, `*.svelte.test.ts`
  browser project). DB tests: `createTestDatabase()` from `lib/server/testing/db.ts`.
  Run only your files: `cd app && npx vitest run --project server <paths> --coverage --coverage.include='<glob>'`.
  ≥ 95 % on every metric for your files.
* **Integration**: `app/e2e/<area>/*.e2e.ts`, `import { test, expect, loginAs, installCourse, withDb } from '../fixtures.js'`.
  Each feature ID of your area has at least one test whose title **starts with the ID**
  (`test('NAV-06 a student registers with the course password', ...)`).
  Course fixtures go to `app/e2e/fixtures/courses/<name>/` and are installed with
  `installCourse(name)` (copied to `infra/tasks/e2e_<name>`, graded by the real agents).
  Seed users: superadmin, e2e_admin, e2e_tutor, e2e_student1..3 (password "superadmin");
  create other data with `withDb`. Use unique names per test (tests run in parallel).
  Run ONLY with your own isolated identity (other agents run e2e in parallel):
  `cd app && E2E_ID=<area> npm run test:e2e:run -- e2e/<area>` — builds into `build-<area>`,
  uses database `INGInious_e2e_<area>` and its own port, and prints the merged
  server+browser coverage (report in `coverage/e2e-<area>/report`). Never run the plain
  `npm run test:e2e` / `vite build` into `build/` (reserved for the coordinator).
* The grading backend of the Colima stack may be temporarily down; if a test needs real
  grading and the backend does not answer, write the test anyway and report it.
* Never commit tests that depend on another area's unfinished pages.

## 8. Budgets (cloc code lines, comments excluded)

The whole app must stay ≤ ~11,300 code lines. Per-area budgets are given in your task.
Prefer data-driven code, shared components and small functions; no copy-paste between pages.
