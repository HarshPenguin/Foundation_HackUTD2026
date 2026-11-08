import { FIX_KEYS, KNOWN_ISSUES, slugFor, SYSTEM_PROMPTS, type FixKey } from '@foundation/shared';
import { pause } from '../env';
import { think } from '../llm';
import { CANNED_FIXES, FIX_SUMMARIES } from '../fixes';
import { phpLint, runFixCheck, scratchFile } from '../checks';
import { commitFixOnBranch, readMainFile } from '../workspace';
import { devInput, fixedKeys, fixKeyOf, stripFences, type RoleCtx, type RoleResult } from './common';
import { repoFixOf } from '../repoWork';
import { developRepo } from './repoRoles';

function pickKey(c: RoleCtx): FixKey {
  const fromTask = fixKeyOf(c.task);
  if (fromTask) return fromTask;
  // Scheduled developer run with no assignment: take this developer's next open issue.
  const fixed = fixedKeys(c.db);
  const base = c.employee.displayName.replace(/ #\d+$/, '');
  const mine = FIX_KEYS.filter(k => !fixed.has(k) && KNOWN_ISSUES[k].developer === base);
  return mine[0] ?? FIX_KEYS.find(k => !fixed.has(k)) ?? 'sqli';
}

export async function develop(c: RoleCtx): Promise<RoleResult> {
  const { db, task, employee } = c;
  const rf = repoFixOf(task.input);
  if (rf) return developRepo(c, rf);
  const input = devInput(task);
  const key = input?.fixKey ?? pickKey(c);
  const issue = KNOWN_ISSUES[key];
  const attempt = input?.attempt ?? 1;
  const name = employee.displayName;

  await db.log(task.runId, employee.id, 'work', attempt > 1 ? `${name} is taking another pass at ${issue.file} after the Tester's notes` : `${name} is reading ${issue.file}`);
  const original = await readMainFile(issue.file);
  const canned = CANNED_FIXES[key];

  const user = [
    `Problem: ${issue.plain}.`,
    `What to do: ${input?.instructions ?? issue.instructions}`,
    input?.testerFeedback ? `The Tester rejected the last attempt: ${input.testerFeedback}` : '',
    `Current contents of ${issue.file}:\n${original}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const res = await think(db, task, employee, {
    system: SYSTEM_PROMPTS.developer,
    user,
    maxOutputTokens: Number(task.maxOutputTokens) || 2000,
    canned,
  });

  let content = stripFences(res.text);
  if (!/^<\?php|<html/i.test(content.trimStart())) content = canned;
  if (res.live && content !== canned) {
    const scratch = scratchFile(`dev-${task.id}-${issue.file.replace(/\//g, '_')}`, content);
    const lint = await phpLint(scratch);
    let problem = lint.ok ? '' : `it failed a syntax check (${lint.message})`;
    if (!problem && attempt > 1) {
      const check = await runFixCheck(key, scratch);
      if (!check.ok) problem = `it still failed a check (${check.failures[0] ?? 'unknown'})`;
    }
    if (problem) {
      await db.log(task.runId, employee.id, 'work', `The model's patch didn't hold up: ${problem}. ${name} applied its tested fix instead`);
      content = canned;
    }
  }
  if (!content.endsWith('\n')) content += '\n';

  await pause(1000);
  await db.log(task.runId, employee.id, 'work', `${name} is writing the fix on a new branch`);
  const summary = content === canned ? FIX_SUMMARIES[key] : `${FIX_SUMMARIES[key]} (written by ${res.providerName})`;
  const message = `${issue.title}\n\n${summary}.\n\nFoundation task ${task.id} by ${name}${attempt > 1 ? `, attempt ${attempt}` : ''}.`;
  const slug = attempt > 1 ? `${slugFor(key)}-v${attempt}` : slugFor(key);
  const b = await commitFixOnBranch(slug, task.id, issue.file, content, message);

  await pause(800);
  await db.log(task.runId, employee.id, 'work', `Committed ${b.branch}: ${summary.charAt(0).toLowerCase()}${summary.slice(1)} (+${b.added} -${b.removed} lines)`);
  return {
    status: 'done',
    output: `${summary}. Branch ${b.branch}: ${b.added} lines added, ${b.removed} removed in ${issue.file}.`,
    branch: b.branch,
    diff: b.diff,
  };
}
