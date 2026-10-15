/**
 * Server-side pagination shared by the list pages (users, submissions, students,
 * courses...): the page number read from the URL is clamped to the existing pages
 * and the matching slice is described by `skip`/`limit` (MongoDB cursor or array
 * slice), so that a page never sends more than `size` rows to the browser.
 */

/** One page of a list. */
export interface PageSlice {
	/** Current page (1-based, always valid). */
	page: number;
	/** Number of pages (at least 1, even for an empty list). */
	pages: number;
	/** Items to skip, and items of the page. */
	skip: number;
	limit: number;
}

/**
 * Slice of the page `wished` (1-based; invalid values give 1, too large ones the last page)
 * of a list of `total` items with `size` items per page.
 */
export function pageSlice(total: number, wished: unknown, size: number): PageSlice {
	const pages = Math.max(1, Math.ceil(total / size));
	const page = Math.min(Math.max(1, Math.trunc(Number(wished)) || 1), pages);
	return { page, pages, skip: (page - 1) * size, limit: size };
}
