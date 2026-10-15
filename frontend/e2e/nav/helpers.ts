/**
 * Shared setup of the NAV integration tests: each test file installs its own
 * copies of the NAV course fixtures (ids `e2e_<fixture>_<suffix>`, so that
 * files running in parallel never share mutable courses) and the NAV users.
 */
import { installCourse, withDb } from '../fixtures.js';
import { E2E } from '../setup-data.js';

/** NAV users (password "superadmin"); nav_carol has an @ok.org e-mail, nav_dave a github binding. */
const USERS = ['nav_alice', 'nav_bob', 'nav_carol', 'nav_dave', 'nav_tutor', 'nav_admin', 'nav_eve'];

/** Installs the given fixtures and the NAV users; returns fixture -> course id. */
export async function setupNav(suffix: string, fixtures: string[]): Promise<Record<string, string>> {
	const ids = Object.fromEntries(fixtures.map((f) => [f, installCourse(f, `e2e_${f}_${suffix}`)]));
	await withDb(async (db) => {
		for (const username of USERS)
			await db.collection('users').updateOne(
				{ username },
				{
					$setOnInsert: {
						username,
						realname: username.replace('nav_', '').replace(/^./, (c) => c.toUpperCase()) + ' Nav',
						email: username === 'nav_carol' ? 'nav_carol@ok.org' : `${username}@x.org`,
						password: E2E.passwordHash,
						bindings: username === 'nav_dave' ? { github: ['1', {}] } : {},
						language: 'en',
						tos_accepted: true
					}
				},
				{ upsert: true }
			);
		for (const id of Object.values(ids)) await db.collection('courses').deleteOne({ _id: id as never });
	});
	return ids;
}

/** Registers students to a course (legacy `courses` document). */
export const register = (courseid: string, ...students: string[]) =>
	withDb((db) =>
		db
			.collection('courses')
			.updateOne({ _id: courseid as never }, { $addToSet: { students: { $each: students } } }, { upsert: true })
	);
