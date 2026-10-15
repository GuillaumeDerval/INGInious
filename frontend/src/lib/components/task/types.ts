/**
 * Data types shared by the task page server code (`lib/server/task`,
 * `lib/server/submissions`) and the task components (TASK-01..25). Only plain
 * serialisable values: rich texts are server-rendered `SafeHtml`.
 */
import type { SafeHtml } from '#lib/utils/safe-html.js';

/** A problem ready to be displayed (TASK-02..06). */
export interface ProblemData {
	id: string;
	/** code, code_single_line, file, multiple_choice, match (or a plugin type). */
	type: string;
	/** Card title: "Question n: name", the name, or "" for a lone unnamed problem. */
	title: string;
	/** Rendered header. */
	header: SafeHtml;
	/** Type-specific options (code: language/default/optional/offset, file: maxSize/allowedExts, MCQ: multiple). */
	language?: string;
	default?: string;
	optional?: boolean;
	offset?: number;
	maxSize?: number;
	allowedExts?: string[];
	multiple?: boolean;
	/** Displayed choices (already shuffled/limited for the viewer). */
	choices?: { index: number; html: SafeHtml }[];
}

/** SSH debug credentials of a running submission (TASK-12). */
export interface SshDebug {
	host: string;
	port: number;
	user: string;
	password: string;
}

/** A submission as sent to the browser by the task actions (TASK-09/10). */
export interface SubmissionJson {
	/** Id, status, result code ("waiting" while grading), grade and ISO date. */
	id: string;
	status: 'done' | 'error' | 'waiting';
	result: string;
	grade: number;
	submittedOn: string;
	/** Translated plain-text title of the result card (empty while waiting). */
	title: string;
	/** Feedback, or the queue message while waiting. */
	text: SafeHtml;
	/** Problem id -> [result, feedback]. */
	problems: Record<string, [string, SafeHtml]>;
	/** Tags visible to the viewer (TASK-20): tag id -> value. */
	tests: Record<string, unknown>;
	/** True when it is the evaluated submission of the viewer. */
	replace: boolean;
	ssh?: SshDebug;
	/** Admins only: the stored document, long strings truncated (TASK-21). */
	debug?: unknown;
	/** When reloading: the stored input, file contents replaced by "" (TASK-10). */
	input?: Record<string, unknown>;
}

/** An entry of the submission history (TASK-10). */
export interface SubmissionSummary {
	/** Id, status, result, grade and ISO submission date. */
	id: string;
	status: string;
	result: string;
	grade: number;
	submittedOn: string;
	/** Names of the visible tags set to true. */
	tags: string[];
}

/** A course tag shown on the task page (TASK-20): type 0 = skill, 1 = misconception. */
export interface TagData {
	id: string;
	name: string;
	type: number;
}

/** "Information" panel of the task page (TASK-01/13/14/18). */
export interface TaskInfoData {
	author: string;
	/** Formatted contact URL (http(s)/mailto only). */
	contactUrl: string | null;
	/** Soft deadline (ISO), null when there is none. */
	deadline: string | null;
	neverAccessible: boolean;
	/** Open but past the soft deadline (shown in red). */
	pastSoftDeadline: boolean;
	/** Shown to registered users and staff only. */
	status: 'notattempted' | 'succeeded' | 'waiting' | 'failed' | null;
	/** Grade and tries of the viewer, submission limit, category tags. */
	grade: number;
	tried: number;
	limit: { amount: number; period: number };
	categories: string[];
	/** Submissions left before the limit (null: unlimited or anonymous). */
	left: number | null;
}

/** Everything the task page needs (returned by `loadTaskPage`). */
export interface TaskPageData {
	/** Ids, (translated) names and rendered statement. */
	courseId: string;
	courseName: string;
	taskId: string;
	name: string;
	context: SafeHtml;
	problems: ProblemData[];
	/** Random inputs of the viewer (TASK-17). */
	random: number[];
	/** Username of the viewer, null for anonymous previews. */
	username: string | null;
	/** Role of the viewer in the course. */
	registered: boolean;
	staff: boolean;
	admin: boolean;
	/** Why the submit button is disabled; null when the viewer can submit. */
	blocked: string | null;
	/** Link to the registration page when the viewer may register. */
	registerUrl: string | null;
	info: TaskInfoData;
	evaluationMode: 'best' | 'last';
	tags: TagData[];
	/** Newest submissions of the viewer (first page of the history, TASK-10), and whether older ones remain. */
	submissions: SubmissionSummary[];
	more: boolean;
	/** Number of submissions of the viewer. */
	submissionCount: number;
	/** Id of the evaluated submission. */
	evaluated: string | null;
	/** Id of a waiting submission to follow on load. */
	waiting: string | null;
	/** Group task: description of the viewer's group (null without group). */
	group: { description: string | null } | null;
	/** Previous / next task ids; staff warnings (course / task invisible to students). */
	prev: string | null;
	next: string | null;
	courseHidden: boolean;
	taskHidden: boolean;
	/** Entries added by plugins (`task_menu` hook). */
	menu: { label: string; href: string }[];
	/** INGInious-xterm URL for the SSH debug iframe (admins). */
	webterm: string | null;
	/**
	 * LTI-05: URL of the JSON actions of the LTI page (carrying the signed `session_id`).
	 * When set, the page is in LTI mode: no breadcrumbs nor links to other INGInious pages.
	 */
	actionUrl?: string;
}
