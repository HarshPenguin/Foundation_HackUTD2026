// Offline self-test: runs the Tester's PHP checks against legacy-demo (should fail) and the
// playbook fixes (should pass), then makes one Maritime call. No database needed.
import { join } from 'node:path';
import { FIX_KEYS, KNOWN_ISSUES } from '@foundation/shared';
import { env } from '../env';
import { phpLint, runFixCheck, scratchFile } from '../checks';
import { CANNED_FIXES } from '../fixes';
import { MaritimeProvider } from '../providers/maritime';

async function main() {
  let bad = 0;
  for (const key of FIX_KEYS) {
    const file = KNOWN_ISSUES[key].file;
    const before = await runFixCheck(key, join(env.legacyDemoDir, file));
    const fixedPath = scratchFile(`selftest-${key}.php`, CANNED_FIXES[key]);
    const lint = await phpLint(fixedPath);
    const after = await runFixCheck(key, fixedPath);
    const ok = !before.ok && after.ok && lint.ok;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${key}: legacy ${before.passed}/${before.total}, fix ${after.passed}/${after.total}, lint ${lint.ok ? 'ok' : lint.message}`);
    for (const f of after.failures) console.log(`       fix failure: ${f}`);
  }
  const m = new MaritimeProvider('Maritime', 'gpt-5-mini');
  try {
    const r = await m.complete({ system: 'Reply with one word.', user: 'Say ok.', maxOutputTokens: 200 });
    console.log(`Maritime: ok (${r.inputTokens} in / ${r.outputTokens} out): ${r.text.slice(0, 40)}`);
  } catch (err) {
    console.log(`Maritime: unavailable (${(err as Error).message}). The crew will use its offline playbook.`);
  }
  process.exit(bad ? 1 : 0);
}

void main();
