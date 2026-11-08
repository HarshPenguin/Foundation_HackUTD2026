import {
  cannedManagerPlan,
  FIX_KEYS,
  isFixKey,
  KNOWN_ISSUES,
  SYSTEM_PROMPTS,
  type DevTaskInput,
  type Directive,
  type FixKey,
  type ManagerPlan,
} from '@foundation/shared';
import { pause } from '../env';
import { parseJson } from '../db';
import { think } from '../llm';
import { fixedKeys, plural, type RoleCtx, type RoleResult } from './common';

/** The owner's most recent "please fix/upgrade X" request from chat, if it came in the last 15 minutes. */
function recentOwnerRequest(c: RoleCtx): string | undefined {
  const cutoff = BigInt(Date.now() - 15 * 60 * 1000) * 1000n;
  const msgs = [...c.db.conn.db.chatMessage.iter()]
    .filter(m => m.role === 'translator' && m.directiveJson && m.at.microsSinceUnixEpoch > cutoff)
    .sort((a, b) => (a.id < b.id ? 1 : -1));
  for (const m of msgs) {
    const d = parseJson<Directive>(m.directiveJson);
    if (d?.intent === 'start_maintenance' && d.summary) return d.summary;
  }
  return undefined;
}

export async function manage(c: RoleCtx): Promise<RoleResult> {
  const { db, task, employee } = c;
  await db.log(task.runId, employee.id, 'plan', `${employee.displayName} is reading the latest audit and update plan`);

  const fixed = fixedKeys(db);
  const open = FIX_KEYS.filter(k => !fixed.has(k));
  const request = recentOwnerRequest(c);
  if (request) await db.log(task.runId, employee.id, 'plan', `Including your request from chat: "${request}"`);

  const defaultKeys = open.slice(0, 2);
  const canned = cannedManagerPlan(defaultKeys);
  const audit = db.latestReport('audit')?.bodyMd ?? '';
  const updatePlan = db.latestReport('update_plan')?.bodyMd ?? '';
  const user = [
    `Latest audit:\n${audit.slice(0, 2500)}`,
    `Latest update plan:\n${updatePlan.slice(0, 1500)}`,
    `Already fixed and approved: ${[...fixed].join(', ') || 'nothing yet'}`,
    `Still open: ${open.join(', ') || 'nothing'}`,
    request ? `The owner asked: ${request}` : '',
    'Plan this run. Only pick fixKeys that are still open.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const res = await think(db, task, employee, {
    system: SYSTEM_PROMPTS.manager,
    user,
    maxOutputTokens: Number(task.maxOutputTokens) || 900,
    jsonMode: true,
    canned: JSON.stringify(canned),
  });

  let plan = parseJson<ManagerPlan>(res.text);
  const valid = (plan?.tasks ?? []).filter(t => isFixKey(t.fixKey) && open.includes(t.fixKey));
  // de-duplicate and cap at 3
  const seen = new Set<FixKey>();
  const tasks = valid.filter(t => (seen.has(t.fixKey) ? false : (seen.add(t.fixKey), true))).slice(0, 3);
  if (!plan || (tasks.length === 0 && defaultKeys.length > 0)) {
    if (res.live) await db.log(task.runId, employee.id, 'plan', `The model's plan didn't match the audit, so ${employee.displayName} used the standard update plan`);
    plan = canned;
  } else {
    plan = { summary: plan.summary || canned.summary, tasks };
  }

  await pause(900);
  if (plan.tasks.length === 0) {
    await db.log(task.runId, employee.id, 'plan', 'Nothing urgent is left in the update plan. No developer work this run');
    return { status: 'done', output: 'No open fixes in the update plan.' };
  }
  await db.log(
    task.runId,
    employee.id,
    'plan',
    `Planned ${plural(plan.tasks.length, 'task')}: ${plan.tasks.map(t => KNOWN_ISSUES[t.fixKey].title.toLowerCase()).join(', ')}`
  );

  const lines: string[] = [];
  for (const t of plan.tasks) {
    const issue = KNOWN_ISSUES[t.fixKey];
    const dev = db.developerNamed(t.developer) ?? db.developerNamed(issue.developer) ?? db.developers()[0];
    if (!dev) throw new Error('no active developer to assign work to');
    const input: DevTaskInput = { fixKey: t.fixKey, file: issue.file, instructions: issue.instructions, attempt: 1 };
    await pause(1000);
    await db.r.createTask({ runId: task.runId, employeeId: dev.id, taskType: 'code', title: issue.title, input: JSON.stringify(input) });
    await db.log(task.runId, employee.id, 'plan', `Assigned ${dev.displayName}: ${issue.title.toLowerCase()} (${issue.file}). ${t.why || issue.plain}`);
    lines.push(`- ${dev.displayName}: ${issue.title} (${issue.file})`);
  }
  return { status: 'done', output: `${plan.summary}\n${lines.join('\n')}` };
}
