/**
 * URL helpers of the list pages: links that change some query parameters of the
 * current URL (page, filters) and keep the others.
 */

/**
 * Search string (`?a=1&b=2`) of `url` with `changes` applied: a `null` value removes
 * the parameter, any other value replaces it.
 * @example withQuery(page.url, { page: 3 }) // "?q=alice&page=3"
 */
export function withQuery(url: { search: string }, changes: Record<string, string | number | null>): string {
	const params = new URLSearchParams(url.search);
	for (const [name, value] of Object.entries(changes))
		if (value === null) params.delete(name);
		else params.set(name, String(value));
	const search = params.toString();
	return search ? `?${search}` : '?';
}

/**
 * URL of the form action `name` that keeps the query of `url` (`?q=a&/pin`): SvelteKit
 * lands an enhanced submission on its action URL without the action key, so a bare
 * `?/pin` would drop the current search, filters and page.
 * @example actionUrl(page.url, 'pin') // "?q=alice&/pin"
 */
export const actionUrl = (url: { search: string }, name: string) =>
	`${url.search || '?'}${url.search ? '&' : ''}/${name}`;
