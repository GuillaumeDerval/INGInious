// Regenerates legacy-corpus.json (golden outputs of the legacy docutils renderer):
//   node app/tests/fixtures/rst/collect-corpus.mjs > /tmp/in.json
//   docker cp app/tests/fixtures/rst/legacy_render.py inginious-frontend-1:/tmp/
//   docker exec -i inginious-frontend-1 sh -c 'cd /inginious && TZ=UTC PYTHONPATH=/inginious python3.14 /tmp/legacy_render.py' \
//       < /tmp/in.json > app/tests/fixtures/rst/legacy-corpus.json
// It collects every distinct context / description / problem header / MCQ choice text
// of infra/tasks and examples/demo-tasks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
function* walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (e.name.endsWith('.yaml')) yield p;
	}
}
const out = [];
const seen = new Set();
for (const root of ['infra/tasks', 'examples/demo-tasks'])
	for (const file of walk(path.join(base, root))) {
		let doc;
		try {
			doc = YAML.parse(fs.readFileSync(file, 'utf8'));
		} catch {
			continue;
		}
		const add = (key, rst) => {
			if (typeof rst === 'string' && rst.trim() && !seen.has(rst)) {
				seen.add(rst);
				out.push({ file: path.relative(base, file), key, rst });
			}
		};
		add('context', doc?.context);
		add('description', doc?.description);
		for (const [pid, p] of Object.entries(doc?.problems ?? {})) {
			add(`${pid}.header`, p?.header);
			(p?.choices ?? []).forEach((c, i) => add(`${pid}.choices.${i}`, c?.text));
		}
	}
process.stdout.write(JSON.stringify(out));
