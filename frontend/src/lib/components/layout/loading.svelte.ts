/**
 * Global "something is loading" state of the application shell.
 *
 * Client-side navigations are tracked by SvelteKit (`navigating` of
 * `$app/state`); this module tracks the other requests started by the user
 * (enhanced form submissions, task page actions) so that the shell's
 * LoadingBar is shown while any of them is pending.
 */

/** Number of user-initiated requests in flight. */
let pending = $state(0);

/** Reactive view of the pending requests. */
export const loading = {
	/** True while at least one tracked request is pending. */
	get active(): boolean {
		return pending > 0;
	}
};

/** Marks a request as started; call the returned function exactly once (`finally`) when it ends. */
export function start(): () => void {
	pending++;
	return () => void pending--;
}

/** Tracks a request: the loading bar is shown until the promise settles. */
export async function track<T>(request: Promise<T>): Promise<T> {
	const end = start();
	try {
		return await request;
	} finally {
		end();
	}
}
