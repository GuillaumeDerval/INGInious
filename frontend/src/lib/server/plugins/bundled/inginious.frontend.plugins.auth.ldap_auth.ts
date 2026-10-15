/**
 * LDAP sign-in (AUTH-16, legacy `ldap_auth`): the user types the campus login
 * and password in a form hosted by INGInious (`/auth/page/<id>`). Options:
 * `id`, `name` (default "LDAP"), `imlink`, `host`, `port`, `encryption`
 * (none | ssl | tls), `base_dn`, `request` (filter, `{}` = login), `bind_dn`
 * (optional initial bind as the user, `{}` = login), `cn`, `mail`.
 * The login is escaped in the filter (RFC 4515) and in the bind DN
 * (RFC 4514), and `encryption: tls` really performs StartTLS.
 */
import { Client, Filter } from 'ldapts';
import { t } from '#lib/i18n/index.js';
import type { PluginRegistry } from '../index.js';
import type { PluginConfig } from '../../config.js';
import { authMethods } from '../../auth/external.js';

/** Escapes a value placed in a distinguished name (RFC 4514). */
export function escapeDn(value: string): string {
	return value
		.replace(/[,+"\\<>;=]/g, '\\$&')
		.replace(/^[ #]/, '\\$&')
		.replace(/ $/, '\\ ');
}

/** First value of an LDAP attribute, as a string. */
const first = (value: unknown) => String((Array.isArray(value) ? value[0] : value) ?? '');

/** Registers the LDAP auth method. */
export function init(_registry: PluginRegistry, o: PluginConfig): void {
	const id = String(o.id);
	const [cn, mail] = [String(o.cn ?? 'cn'), String(o.mail ?? 'mail')];
	authMethods.set(id, {
		id,
		name: String(o.name ?? 'LDAP'),
		imlink: o.imlink as string | undefined,
		form: true,
		authLink: async () => `/auth/page/${id}`,
		async callback(_storage, { form }) {
			const login = String(form?.get('login') ?? '')
				.trim()
				.toLowerCase();
			const password = String(form?.get('password') ?? '');
			// An empty password would be an anonymous bind, which always succeeds.
			if (!password.trim()) return t('Empty password');
			const ssl = o.encryption === 'ssl';
			const client = new Client({
				url: `${ssl ? 'ldaps' : 'ldap'}://${o.host}${o.port ? `:${o.port}` : ''}`,
				timeout: 10_000,
				connectTimeout: 10_000
			});
			try {
				let entries;
				try {
					if (o.encryption === 'tls') await client.startTLS();
					if (o.bind_dn) await client.bind(String(o.bind_dn).replace('{}', escapeDn(login)), password);
					const filter = String(o.request ?? '(uid={})').replace('{}', Filter.escape(login));
					entries = (await client.search(String(o.base_dn), { filter, attributes: [cn, mail] })).searchEntries;
				} catch {
					return t('Cannot contact host');
				}
				if (!entries.length) return t('Unknown user');
				try {
					await client.bind(entries[0].dn, password);
				} catch {
					return t('Incorrect password');
				}
				const [email, realname] = [first(entries[0][mail]), first(entries[0][cn])];
				if (!email || !realname) return t("Can't get field {} from your LDAP server", email ? cn : mail);
				return { id: login, realname, email };
			} finally {
				await client.unbind().catch(() => undefined);
			}
		}
	});
}
