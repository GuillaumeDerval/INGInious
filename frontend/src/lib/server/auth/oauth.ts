/**
 * Generic OAuth 2 auth method (AUTH-15) and the table of the supported
 * providers (GitHub, Google, Facebook, LinkedIn), built on the `arctic`
 * clients; each bundled `auth.<provider>_auth` plugin is `oauthPlugin(<key>)`.
 * The `state` (and the PKCE verifier) live in the server-side session; the
 * redirect URI is built from the configured public base URL, not from the Host
 * header.
 */
import { Facebook, generateCodeVerifier, generateState, GitHub, Google, LinkedIn, type OAuth2Tokens } from 'arctic';
import type { PluginConfig } from '../config.js';
import { publicUrl } from '../mail.js';
import type { PluginRegistry } from '../plugins/index.js';
import { authMethods, type ExternalUser } from './external.js';

/** The two calls of an arctic client, for one redirect URI. */
export interface OAuthClient {
	/** Authorization URL for a state (and PKCE verifier). */
	url(state: string, verifier: string): URL;
	/** Exchanges the authorization code for tokens. */
	token(code: string, verifier: string): Promise<OAuth2Tokens>;
}

/** An OAuth 2 provider of the table. */
export interface OAuthProvider {
	/** Default display name (plugin option `name` overrides it). */
	name: string;
	/** Creates the arctic client of the provider for a redirect URI. */
	client(options: PluginConfig, redirectUri: string): OAuthClient;
	/** Reads the identity with the access token; null when it is not acceptable. */
	profile(accessToken: string, options: PluginConfig): Promise<ExternalUser | null>;
}

/** GETs a JSON resource of a provider API with a bearer token (throws on HTTP errors). */
export async function getJson<T>(url: string, token: string): Promise<T> {
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'INGInious' }
	});
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return (await response.json()) as T;
}

/** Arctic client class of the providers without PKCE. */
type PlainClient = new (
	id: string,
	secret: string,
	uri: string
) => {
	createAuthorizationURL(state: string, scopes: string[]): URL;
	validateAuthorizationCode(code: string): Promise<OAuth2Tokens>;
};

/** `OAuthProvider.client` of a provider without PKCE, asking for `scopes`. */
const plain =
	(Client: PlainClient, scopes: string[]) =>
	(o: PluginConfig, uri: string): OAuthClient => {
		const client = new Client(String(o.client_id), String(o.client_secret), uri);
		return {
			url: (state) => client.createAuthorizationURL(state, scopes),
			token: (code) => client.validateAuthorizationCode(code)
		};
	};

/** OpenID Connect userinfo document. */
type UserInfo = { sub: string; name: string; email: string; email_verified?: boolean; hd?: string };

/**
 * Supported providers, keyed by the name used in the legacy plugin module.
 * Differences with legacy: GitHub uses the primary *verified* address; Google
 * enforces `domain` and refuses unverified addresses; LinkedIn uses "Sign In
 * with LinkedIn using OpenID Connect" (the legacy `r_liteprofile` API no
 * longer exists).
 */
export const OAUTH_PROVIDERS = {
	github: {
		name: 'Github',
		client: plain(GitHub, ['user:email']),
		async profile(token) {
			const user = await getJson<{ id: number; name: string | null; login: string }>(
				'https://api.github.com/user',
				token
			);
			const emails = await getJson<{ email: string; primary: boolean; verified: boolean }[]>(
				'https://api.github.com/user/emails',
				token
			);
			const email = emails.find((e) => e.primary && e.verified)?.email;
			return email ? { id: String(user.id), realname: user.name || user.login, email } : null;
		}
	},
	google: {
		name: 'Google',
		client(o, uri) {
			const google = new Google(String(o.client_id), String(o.client_secret), uri);
			const url = (state: string, verifier: string) => {
				const link = google.createAuthorizationURL(state, verifier, ['openid', 'email', 'profile']);
				if (o.domain) link.searchParams.set('hd', String(o.domain));
				return link;
			};
			return { url, token: (code, verifier) => google.validateAuthorizationCode(code, verifier) };
		},
		async profile(token, o) {
			const info = await getJson<UserInfo>('https://openidconnect.googleapis.com/v1/userinfo', token);
			return info.email_verified === false || (o.domain && info.hd !== o.domain)
				? null
				: { id: info.sub, realname: info.name, email: info.email };
		}
	},
	facebook: {
		name: 'Facebook',
		client: plain(Facebook, ['public_profile', 'email']),
		async profile(token) {
			const me = await getJson<{ id: string; name: string; email: string }>(
				'https://graph.facebook.com/me?fields=id,name,email',
				token
			);
			return { id: me.id, realname: me.name, email: me.email };
		}
	},
	linkedin: {
		name: 'LinkedIn',
		client: plain(LinkedIn, ['openid', 'profile', 'email']),
		async profile(token) {
			const info = await getJson<UserInfo>('https://api.linkedin.com/v2/userinfo', token);
			return { id: info.sub, realname: info.name, email: info.email };
		}
	}
} satisfies Record<string, OAuthProvider>;

/**
 * Registers an OAuth 2 method configured by a plugin entry (`id`, `name`,
 * `imlink`, `client_id`, `client_secret`, provider options such as `domain`).
 */
export function registerOAuth(options: PluginConfig, provider: OAuthProvider): void {
	const id = String(options.id);
	const client = (url: URL) => provider.client(options, publicUrl(`/auth/callback/${id}`, url));
	authMethods.set(id, {
		id,
		name: String(options.name ?? provider.name),
		imlink: options.imlink as string | undefined,
		async authLink(storage, url) {
			storage.oauth_state = generateState();
			storage.verifier = generateCodeVerifier();
			return client(url)
				.url(storage.oauth_state as string, storage.verifier as string)
				.toString();
		},
		async callback(storage, { url }) {
			const code = url.searchParams.get('code');
			if (!code || !storage.oauth_state || url.searchParams.get('state') !== storage.oauth_state) return null;
			const tokens = await client(url).token(code, storage.verifier as string);
			return provider.profile(tokens.accessToken(), options);
		}
	});
}

/** The `init` function of the bundled plugin of a provider of the table. */
export function oauthPlugin(key: keyof typeof OAUTH_PROVIDERS) {
	return (_registry: PluginRegistry, options: PluginConfig): void => registerOAuth(options, OAUTH_PROVIDERS[key]);
}
