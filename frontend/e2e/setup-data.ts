/**
 * Constants and seed data of the integration suite (must match e2e/config.yaml).
 */
import { fileURLToPath } from 'node:url';

/** Identifier of this integration run: parallel runs (one per agent/area) are isolated by it. */
export const E2E_ID = process.env.E2E_ID ?? 'main';
/** Index used to derive a distinct port per run. */
const RUN_INDEX = E2E_ID === 'main' ? 0 : 1 + ([...E2E_ID].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 800);

/** Connection settings of the e2e run (database, port, build directory). */
export const E2E = {
	mongoUrl: process.env.MONGO_TEST_URL ?? 'mongodb://localhost:27017',
	database: E2E_ID === 'main' ? 'INGInious_e2e' : `INGInious_e2e_${E2E_ID}`,
	port: 4173 + RUN_INDEX,
	buildDir: process.env.BUILD_OUT ?? 'build',
	/**
	 * tasks_directory of the tested server, shared with the grading agents (which must
	 * see the course fixtures installed by the tests): `E2E_TASKS_DIR`, by default e2e/.tasks,
	 * mounted by the agents of e2e/compose.yml.
	 */
	tasksDir: process.env.E2E_TASKS_DIR ?? fileURLToPath(new URL('./.tasks', import.meta.url)),
	/** backup_directory of the tested server (course archives made by the tests). */
	backupDir: fileURLToPath(new URL('.generated/backups', import.meta.url)),
	coverageDir: E2E_ID === 'main' ? 'coverage/e2e' : `coverage/e2e-${E2E_ID}`,
	secretKey: 'e2e-secret-key-0123456789abcdef0123456789abcdef',
	/** argon2id hash of the password "superadmin" (legacy deploy/init-mongo.js). */
	passwordHash:
		'argon2id-$argon2id$v=19$m=65536,t=3,p=1$QVNVUEVSU0VDVVJFU0FMVA$NpeSDEsx+FwrIS277T9o/Q4z4Ypicibs3LiLZrftXsBUmBxFnK8FKa45w5q85ewM+dOlzZPMFdAmxpmDVAmLlQ'
};

/** Users created before the suite runs (all with password "superadmin"). */
export const USERS = ['superadmin', 'e2e_admin', 'e2e_tutor', 'e2e_student1', 'e2e_student2', 'e2e_student3'].map(
	(username) => ({
		username,
		realname:
			username === 'superadmin'
				? 'INGInious superadmin'
				: username.replace('e2e_', 'E2E ').replace(/^./, (c) => c.toUpperCase()),
		email: `${username}@inginious.local`,
		password: E2E.passwordHash,
		bindings: {},
		language: 'en',
		code_indentation: '4',
		tos_accepted: true
	})
);
