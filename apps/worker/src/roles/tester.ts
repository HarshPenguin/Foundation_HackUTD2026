import { join } from 'node:path';
import { CANNED_TESTER_NOTES, KNOWN_ISSUES, SYSTEM_PROMPTS } from '@foundation/shared';
import { pause } from '../env';
import { parseJson } from '../db';
import { think } from '../llm';
import { phpLint, runFixCheck, scratchFile } from '../checks';
import { checkoutForReview, readMainFile } from '../workspace';
import { testerInput, type RoleCtx, type RoleResult } from './common';
import { repoFixOf } from '../repoWork';
import { testRepo } from './repoRoles';

export async function test(c: RoleCtx): Promise<RoleResult> {
  const { db, task, employee } = c;
  const input = testerInput(task);
  if (!input) {
    await db.log(task.runId, employee.id, 'review', 'No new changes are waiting for review');
    return { status: 'done', output: 'No new changes were waiting for review.' };
  }
  const rf = repoFixOf(task.input);
  if (rf) return testRepo(c, rf);
  const issue = KNOWN_ISSUES[input.fixKey];
  const dev = db.task(BigInt(input.devTaskId));
  const devName = dev ? db.name(dev.employeeId) : 'the Developer';

  await db.log(task.runId, employee.id, 'review', `${employee.displayName} is checking ${input.branch} from ${devName}`);
  const wt = await checkoutForReview(input.branch, task.id);
  try {
    const file = join(wt.dir, input.file);
    const lint = await phpLint(file);
    const check = await runFixCheck(input.fixKey, file);
    let before = '';
    if (input.fixKey === 'rounding' || input.fixKey === 'sqli') {
      const mainCopy = scratchFile(`main-${task.id}-${input.file.replace(/\//g, '_')}`, await readMainFile(input.file));
      const b = await runFixCheck(input.fixKey, mainCopy);
      if (b.total > 0) before = ` (on main only ${b.passed} of ${b.total} passed)`;
    }
    await pause(900);
    await db.log(
      task.runId,
      employee.id,
      'review',
      `php -l ${lint.ok ? 'passed' : 'failed'}. ${check.passed} of ${check.total} ${issue.file} checks passed${before}`
    );

    const verdict = lint.ok && check.ok;
    const failure = !lint.ok ? `syntax error: ${lint.message}` : check.failures[0] ?? '';
    const canned = JSON.stringify({
      approve: verdict,
      notes: verdict ? CANNED_TESTER_NOTES[input.fixKey] : `Rejected: ${failure}.`,
    });
    const res = await think(db, task, employee, {
      system: SYSTEM_PROMPTS.tester,
      user: `Problem being fixed: ${issue.plain}.\nScripted checks: php -l ${lint.ok ? 'ok' : 'FAILED'}; ${check.passed}/${check.total} passed${
        check.failures.length ? `; failures: ${check.failures.join('; ')}` : ''
      }.\n\nDiff:\n${(dev?.diff ?? '').slice(0, 8000)}`,
      maxOutputTokens: Number(task.maxOutputTokens) || 800,
      jsonMode: true,
      canned,
    });
    const review = parseJson<{ approve?: boolean; notes?: string }>(res.text);
    const notes = (review?.notes || parseJson<{ notes: string }>(canned)!.notes).trim();

    await pause(900);
    // The scripted checks decide; the model's review adds notes (and is logged if it disagrees).
    if (verdict) {
      if (res.live && review?.approve === false) await db.log(task.runId, employee.id, 'review', `Model reviewer raised a concern: ${notes}`);
      await db.log(task.runId, employee.id, 'review', `Approved ${input.branch}. ${check.total + 1} checks passed`);
      return { status: 'done', output: `Approved ${input.branch}. ${notes}`, branch: input.branch };
    }
    await db.log(task.runId, employee.id, 'review', `Rejected ${input.branch}: ${failure}`);
    return { status: 'rejected', output: `Rejected ${input.branch}. ${failure}. ${notes}`.trim(), branch: input.branch };
  } finally {
    await wt.cleanup();
  }
}
