/**
 * Plain, serialisable view models of the student-side navigation pages
 * (NAV-01..21). They are produced by `#lib/server/nav/*` and displayed by the
 * components of this folder; keeping them here (isomorphic, types only) lets
 * components import them without touching server code. Names are translated.
 */

/** One entry of the "Last tried exercises" widget (NAV-21): status/result of the latest submission. */
export interface LastTriedItem {
	courseid: string;
	taskid: string;
	courseName: string;
	taskName: string;
	status: string;
	result: string;
}

/** One visible task of the course task list (NAV-10): `open` is false once the hard deadline passed, `deadline` = soft deadline (ISO) or null. */
export interface TaskItem {
	id: string;
	name: string;
	succeeded: boolean;
	grade: number;
	weight: number;
	open: boolean;
	categories: string[];
	deadline: string | null;
}

/**
 * A section of the course task list (NAV-10): `sections` for a non-terminal section (else null),
 * or `tasks` (null while not loaded: large courses load the tasks of a section when it is opened).
 */
export interface SectionView {
	title: string;
	/** Position in the table of contents (indices, e.g. "0.2"): key of the on-demand loading. */
	path: string;
	closed: boolean;
	sections: SectionView[] | null;
	tasks: TaskItem[] | null;
	/** Number of [succeeded, visible] tasks per category ('' = all tasks). */
	stats: Record<string, [number, number]>;
}

/** A group shown on /group/<courseid> (NAV-16), with its free seats (`available`). */
export interface GroupView {
	id: string;
	description: string;
	available: number;
	members: { username: string; realname: string; email: string }[];
}
