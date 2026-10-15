/**
 * Route parameter matchers (`src/routes/[name=matcher]`).
 *  - `lti`: the LTI 1.1 / 1.3 path prefix (`/lti/…` and `/lti1.3/…` share their task, login,
 *    bind and best submission pages: the LTI version comes from the session, LTI-04/05).
 */
import { defineParams } from '@sveltejs/kit/params';

export const params = defineParams({
	/** `lti` or `lti1.3`. */
	lti: (param) => (param === 'lti' || param === 'lti1.3' ? param : undefined)
});
