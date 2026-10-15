/**
 * A minimal SAML identity provider for the integration tests (AUTH-14/17): a
 * self-signed certificate (openssl) and signed SAML responses (xml-crypto, the
 * library node-saml itself uses).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { SignedXml } from 'xml-crypto';
import { E2E_ID } from '../setup-data.js';

const dir = `e2e/.generated/saml-${E2E_ID}`;
mkdirSync(dir, { recursive: true });
execFileSync(
	'openssl',
	[
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-subj',
		'/CN=idp',
		'-days',
		'2',
		'-keyout',
		`${dir}/key.pem`,
		'-out',
		`${dir}/cert.pem`
	],
	{ stdio: 'ignore' }
);
const privateKey = readFileSync(`${dir}/key.pem`, 'utf8');
/** Certificate of the test IdP (for the plugin configuration). */
export const idpCert = readFileSync(`${dir}/cert.pem`, 'utf8');

/** Escapes XML text. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * A base64 SAML response with a signed assertion for the attributes given.
 * @param acs assertion consumer service URL; @param audience SP entity id;
 * @param attributes attribute values (an array for a multi-valued attribute).
 * @param inResponseTo id of the AuthnRequest answered (none: unsolicited response).
 */
export function samlResponse(
	acs: string,
	audience: string,
	attributes: Record<string, string | string[]>,
	inResponseTo?: string
): string {
	const now = new Date();
	const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
	const id = () => `_${randomBytes(8).toString('hex')}`;
	const answers = inResponseTo ? ` InResponseTo="${esc(inResponseTo)}"` : '';
	const attrs = Object.entries(attributes)
		.map(
			([name, value]) =>
				`<saml:Attribute Name="${esc(name)}">${[value]
					.flat()
					.map((v) => `<saml:AttributeValue>${esc(v)}</saml:AttributeValue>`)
					.join('')}</saml:Attribute>`
		)
		.join('');
	const xml =
		`<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id()}" Version="2.0" IssueInstant="${at(0)}" Destination="${acs}"${answers}>` +
		`<saml:Issuer>https://idp.example</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
		`<saml:Assertion ID="${id()}" Version="2.0" IssueInstant="${at(0)}"><saml:Issuer>https://idp.example</saml:Issuer>` +
		`<saml:Subject><saml:NameID>${esc([attributes.uid ?? 'x'].flat()[0])}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${at(5)}" Recipient="${acs}"${answers}/></saml:SubjectConfirmation></saml:Subject>` +
		`<saml:Conditions NotBefore="${at(-5)}" NotOnOrAfter="${at(5)}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
		`<saml:AuthnStatement AuthnInstant="${at(0)}" SessionIndex="s"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
		`<saml:AttributeStatement>${attrs}</saml:AttributeStatement></saml:Assertion></samlp:Response>`;
	const signature = new SignedXml({ privateKey, publicCert: idpCert });
	signature.addReference({
		xpath: "//*[local-name(.)='Assertion']",
		digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
		transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#']
	});
	signature.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
	signature.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
	signature.computeSignature(xml, {
		location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' }
	});
	return Buffer.from(signature.getSignedXml()).toString('base64');
}

/** Id of the AuthnRequest carried by an IdP redirect URL (HTTP-Redirect binding: deflated, base64). */
export function requestId(location: string): string {
	const xml = inflateRawSync(Buffer.from(new URL(location).searchParams.get('SAMLRequest')!, 'base64')).toString();
	return /\bID="([^"]+)"/.exec(xml)![1];
}
