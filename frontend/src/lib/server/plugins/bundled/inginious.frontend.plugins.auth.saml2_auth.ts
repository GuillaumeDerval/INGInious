/**
 * SAML 2 single sign-on (AUTH-17, legacy `saml2_auth`) with `@node-saml/node-saml`.
 * The legacy python3-saml settings are mapped: `sp.entityId` (issuer),
 * `sp.privateKey`/`sp.x509cert`, `sp.NameIDFormat`, `idp.singleSignOnService.url`,
 * `idp.x509cert` + `idp.additionalX509certs` (all accepted), `security.wantAssertionsSigned`
 * / `wantMessagesSigned`, `attributes` (`uid`, `cn`, `email`) and `additional`.
 * The RelayState is an opaque random value checked against the session;
 * it never carries the return URL.
 */
import { randomBytes } from 'node:crypto';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import type { PluginRegistry } from '../index.js';
import type { PluginConfig } from '../../config.js';
import { publicUrl } from '../../mail.js';
import { authMethods } from '../../auth/external.js';

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
	const saml = (url: URL) =>
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
			validateInResponseTo: ValidateInResponseTo.never
		});
	authMethods.set(id, {
		id,
		name: String(o.name ?? 'SAML'),
		imlink: o.imlink as string | undefined,
		async authLink(storage, url) {
			storage.relay = randomBytes(16).toString('hex');
			return saml(url).getAuthorizeUrlAsync(storage.relay as string, undefined, {});
		},
		async callback(storage, { url, form }) {
			const [response, relay] = [form?.get('SAMLResponse'), form?.get('RelayState')];
			if (!attributes || typeof response !== 'string' || !storage.relay || relay !== storage.relay) return null;
			const { profile } = await saml(url).validatePostResponseAsync({
				SAMLResponse: response,
				RelayState: String(relay)
			});
			const get = (urn: string) => {
				const value = profile?.[urn] ?? (profile?.attributes as Record<string, unknown> | undefined)?.[urn];
				return String((Array.isArray(value) ? value[0] : value) ?? '');
			};
			const extra = Object.fromEntries(Object.entries(additional).map(([key, urn]) => [key, get(urn)]));
			return profile
				? { id: get(attributes.uid), realname: get(attributes.cn), email: get(attributes.email), additional: extra }
				: null;
		},
		metadata: (url) => saml(url).generateServiceProviderMetadata(sp.x509cert ?? null, sp.x509cert ?? null)
	});
}
