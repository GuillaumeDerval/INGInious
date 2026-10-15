/**
 * Preloaded (`node --import`) in the app servers of the coverage tests: requests
 * of `fetch` to the OAuth providers (GitHub, Google, Facebook, LinkedIn) are sent
 * to the fake provider of the test (`E2E_FAKE_PROVIDER`, path prefixed with the
 * original host name) instead of the Internet. The code under test is unchanged.
 */
const target = process.env.E2E_FAKE_PROVIDER;
const HOSTS = new Set([
	'github.com',
	'api.github.com',
	'oauth2.googleapis.com',
	'openidconnect.googleapis.com',
	'graph.facebook.com',
	'www.linkedin.com',
	'api.linkedin.com'
]);
const original = globalThis.fetch;

globalThis.fetch = async (input, init) => {
	const request = new Request(input, init);
	const url = new URL(request.url);
	if (!target || !HOSTS.has(url.hostname)) return original(input, init);
	const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
	return original(`${target}/${url.hostname}${url.pathname}${url.search}`, {
		method: request.method,
		headers: request.headers,
		body
	});
};
