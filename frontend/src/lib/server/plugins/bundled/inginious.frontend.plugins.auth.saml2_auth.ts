/**
 * SAML 2 single sign-on (AUTH-17, legacy `saml2_auth`) with `@node-saml/node-saml`.
 * The legacy python3-saml settings are mapped: `sp.entityId` (issuer),
 * `sp.privateKey`/`sp.x509cert`, `sp.NameIDFormat`, `idp.singleSignOnService.url`,
 * `idp.x509cert` + `idp.additionalX509certs` (all accepted), `security.wantAssertionsSigned`
 * / `wantMessagesSigned`, `attributes` (`uid`, `cn`, `email`) and `additional`.
 * The RelayState is an opaque random value checked against the session;
 * it never carries the return URL.
 *
 * A response is only accepted for the AuthnRequest of the same session: the
 * request id is kept in the session (`auth_storage.<id>.request`) and the
 * `InResponseTo` of the response must match it. Each assertion is accepted once:
 * its id is recorded in the `saml_assertions` collection, whose TTL index
 * forgets it after `ASSERTION_TTL`. MongoDB (rather than process memory) keeps
 * the record across restarts and processes, like the LTI nonces.
 */
import { randomBytes } from 'node:crypto';
import { SAML, ValidateInResponseTo, type CacheProvider } from '@node-saml/node-saml';
import type { PluginRegistry } from '../index.js';
import type { PluginConfig } from '../../config.js';
import { publicUrl } from '../../mail.js';
import { services } from '../../app.js';
import { isDuplicate } from '../../auth/accounts.js';
import { authMethods, type AuthStorage } from '../../auth/external.js';

/** Collection of the assertion ids already used (TTL index on `expires`, see db/index.ts). */
export const ASSERTION_COLLECTION = 'saml_assertions';
/** How long a used assertion id is remembered (ms); longer than any assertion validity window in practice. */
const ASSERTION_TTL = 24 * 3600_000;

/**
 * node-saml request-id cache backed by the flow state of the session: the id of the
 * AuthnRequest is saved there, and only that id is known when the response arrives.
 */
function sessionCache(storage: AuthStorage): CacheProvider {
	return {
		saveAsync: async (key, value) => ((storage.request = { key, value }), { value, createdAt: Date.now() }),
		getAsync: async (key) => {
			const request = storage.request as { key: string; value: string } | undefined;
			return request?.key === key ? request.value : null;
		},
		removeAsync: async (key) => (delete storage.request, key)
	};
}

/**
 * Records the id of an accepted assertion.
 * @returns false when the assertion was already used (replay), or has no id.
 */
async function firstUse(id: string, assertionId: unknown): Promise<boolean> {
	if (typeof assertionId !== 'string' || !assertionId) return false;
	return services()
		.db.db.collection<{ _id: string; expires: Date }>(ASSERTION_COLLECTION)
		.insertOne({ _id: `${id}:${assertionId}`, expires: new Date(Date.now() + ASSERTION_TTL) })
		.then(
			() => true,
			(e) => (isDuplicate(e) ? false : Promise.reject(e))
		);
}

/** A loosely typed section of the plugin options. */
type Section = Record<string, string | undefined> & {
	singleSignOnService?: { url?: string };
	additionalX509certs?: string[];
};

/** Registers the SAML auth method. */
export function init(_registry: PluginRegistry, o: PluginConfig): void {
	const id = String(o.id);
	const [sp, idp, security] = [o.sp, o.idp, o.security].map((s) => (s ?? {}) as Section);
	const attributes = o.attributes as Record<string, string> | undefined;
	const additional = (o.additional ?? {}) as Record<string, string>;
	const saml = (url: URL, storage: AuthStorage) =>
		new SAML({
			callbackUrl: publicUrl(`/auth/callback/${id}`, url),
			entryPoint: idp.singleSignOnService?.url,
			issuer: String(sp.entityId),
			audience: String(sp.entityId),
			idpCert: [idp.x509cert, ...(idp.additionalX509certs ?? [])].filter((c): c is string => !!c),
			privateKey: sp.privateKey,
			decryptionPvk: sp.privateKey,
			identifierFormat: sp.NameIDFormat ?? null,
			wantAssertionsSigned: (security.wantAssertionsSigned as unknown as boolean) ?? true,
			wantAuthnResponseSigned: (security.wantMessagesSigned as unknown as boolean) ?? false,
			validateInResponseTo: ValidateInResponseTo.always,
			cacheProvider: sessionCache(storage)
		});
	authMethods.set(id, {
		id,
		name: String(o.name ?? 'SAML'),
		imlink: o.imlink as string | undefined,
		async authLink(storage, url) {
			storage.relay = randomBytes(16).toString('hex');
			return saml(url, storage).getAuthorizeUrlAsync(storage.relay as string, undefined, {});
		},
		async callback(storage, { url, form }) {
			const [response, relay] = [form?.get('SAMLResponse'), form?.get('RelayState')];
			if (!attributes || typeof response !== 'string' || !storage.relay || relay !== storage.relay) return null;
			const { profile } = await saml(url, storage).validatePostResponseAsync({
				SAMLResponse: response,
				RelayState: String(relay)
			});
			const assertion = profile?.getAssertion?.() as { Assertion?: { $?: { ID?: unknown } } } | undefined;
			if (profile && !(await firstUse(id, assertion?.Assertion?.$?.ID))) return null;
			const get = (urn: string) => {
				const value = profile?.[urn] ?? (profile?.attributes as Record<string, unknown> | undefined)?.[urn];
				return String((Array.isArray(value) ? value[0] : value) ?? '');
			};
			const extra = Object.fromEntries(Object.entries(additional).map(([key, urn]) => [key, get(urn)]));
			return profile
				? { id: get(attributes.uid), realname: get(attributes.cn), email: get(attributes.email), additional: extra }
				: null;
		},
		metadata: (url) => saml(url, {}).generateServiceProviderMetadata(sp.x509cert ?? null, sp.x509cert ?? null)
	});
}
