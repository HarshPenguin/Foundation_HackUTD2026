// Manager, Developer and Tester steps for the owner's connected repo.
import { pause } from '../env';
import { think } from '../llm';
import { commitRepoFix, fixProposal, planRepoFixes, readRepoFile, repoFixOf, verifyRepoFix, type RepoFix } from '../repoWork';
import { isApproved, isCode, plural, stripFences, testerInput, type RoleCtx, type RoleResult } from './common';

export async function manageRepo(c: RoleCtx, url: string, name: string): Promise<RoleResult> {
  const { db, task, employee } = c;
  await db.log(task.runId, employee.id, 'plan', `${employee.displayName} is reading the Auditor's findings on ${name}`);
  // Don't re-plan risks that already have an approved fix.
  const already = new Set<string>();
  for (const t of db.tasks()) {
    const f = isCode(t) ? repoFixOf(t.input) : undefined;
    if (f && f.url === url && isApproved(db, t)) already.add(`${f.file}:${f.title}`);
  }
  const plan = await planRepoFixes(url, already);
  await pause(900);
  if (plan.length === 0) {
    await db.log(task.runId, employee.id, 'plan', `No open risks left in ${name}. No developer work this run`);
    return { status: 'done', output: `No open risks in ${name}.` };
  }
  await db.log(task.runId, employee.id, 'plan', `Planned ${plural(plan.length, 'fix', 'fixes')} on ${name}: ${plan.map(p => p.fix.title.split(' (')[0].toLowerCase()).join(', ')}`);
  const lines: string[] = [];
  for (const p of plan) {
    const dev = db.developerNamed(p.developer) ?? db.developers()[0];
    if (!dev) throw new Error('no active developer to assign work to');
    await pause(1000);
    const title = `Fix ${p.fix.title.split(' (')[0].toLowerCase()} in ${p.fix.file}`;
    await db.r.createTask({ runId: task.runId, employeeId: dev.id, taskType: 'code', title, input: JSON.stringify({ repoFix: p.fix }) });
    await db.log(task.runId, employee.id, 'plan', `Assigned ${dev.displayName}: ${p.fix.file}:${p.fix.line}. ${p.fix.why}`);
    lines.push(`- ${dev.displayName}: ${title}`);
  }
  return { status: 'done', output: `Fixes planned on ${name}\n${lines.join('\n')}` };
}

export async function developRepo(c: RoleCtx, f: RepoFix): Promise<RoleResult> {
  const { db, task, employee } = c;
  const name = employee.displayName;
  await db.log(task.runId, employee.id, 'work', `${name} is reading ${f.file}`);
  const original = readRepoFile(f.url, f.file);
  const res = await think(db, task, employee, {
    system:
      'You are a careful developer maintaining a legacy codebase. Fix exactly the problem described with the smallest safe change. Keep everything else identical. Reply with the complete corrected file and nothing else.',
    user: `Problem: ${f.title} at line ${f.line}: \`${f.snippet}\`\nWhy it matters: ${f.why}\n\nCurrent contents of ${f.file}:\n${original}`,
    maxOutputTokens: Math.max(2000, Math.min(8000, Math.ceil(original.length / 3))),
    canned: '',
  });
  const content = stripFences(res.text);
  const plausible = res.live && content.length > original.length * 0.5 && content !== original;
  if (!plausible) {
    // No model connected (or its answer wasn't usable): write the fix up instead of pretending.
    await pause(900);
    await db.log(task.runId, employee.id, 'work', `${res.live ? "The model's patch wasn't usable" : 'No AI model is connected'}, so ${name} wrote up the fix for ${f.file}:${f.line} instead of changing code`);
    return { status: 'done', output: fixProposal(f) };
  }
  await db.log(task.runId, employee.id, 'work', `${name} is writing the fix on a new branch`);
  const slug = `${f.title.split(' (')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}-${task.id}`;
  const b = await commitRepoFix(f.url, slug, f.file, content, `${f.title} in ${f.file}\n\nFoundation task ${task.id} by ${name}, written by ${res.providerName}.`);
  await pause(800);
  await db.log(task.runId, employee.id, 'work', `Committed ${b.branch} on ${f.file} (+${b.added} -${b.removed} lines)`);
  return { status: 'done', output: `${f.title} fixed in ${f.file}. Branch ${b.branch}.`, branch: b.branch, diff: b.diff };
}

export async function testRepo(c: RoleCtx, f: RepoFix): Promise<RoleResult> {
  const { db, task, employee } = c;
  const input = testerInput(task)!;
  await db.log(task.runId, employee.id, 'review', `${employee.displayName} is checking ${input.branch}`);
  const v = await verifyRepoFix(f.url, input.branch, f);
  await pause(900);
  await db.log(
    task.runId,
    employee.id,
    'review',
    `${v.lint.tool}${v.lint.ok ? ' passed' : ` failed (${v.lint.message})`}. Re-scanned ${f.file}: ${v.stillThere ? `the risk is still there in ${plural(v.stillThere, 'place')}` : 'the risk is gone'}`
  );
  if (v.ok) {
    await db.log(task.runId, employee.id, 'review', `Approved ${input.branch}`);
    return { status: 'done', output: `Approved ${input.branch}: ${v.lint.tool} passed and the scanner no longer finds the risk.` };
  }
  await db.log(task.runId, employee.id, 'review', `Rejected ${input.branch}`);
  return { status: 'rejected', output: `Rejected: ${v.lint.ok ? 'the risk is still there' : `syntax check failed: ${v.lint.message}`}.` };
}
