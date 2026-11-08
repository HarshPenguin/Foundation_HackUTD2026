import { FIX_KEYS, formatUsd, KNOWN_ISSUES, SYSTEM_PROMPTS } from '@foundation/shared';
import { pause } from '../env';
import { parseJson } from '../db';
import { think } from '../llm';
import { fixedKeys, fixKeyOf, isApproved, plural, type RoleCtx, type RoleResult } from './common';
import { connectedRepo } from '../repoWork';
import { scopeTasks } from './reviewer';

export function channelPhrase(channel: string | undefined): string {
  if (channel === 'sms') return 'texted to you';
  if (channel === 'in_app') return 'posted in My Communications';
  return 'sent to your email';
}

export async function communicate(c: RoleCtx): Promise<RoleResult> {
  const { db, task, employee } = c;
  const scope = parseJson<{ runId?: string }>(task.input);
  const runId = scope?.runId ? BigInt(scope.runId) : undefined;
  await db.log(task.runId, employee.id, 'info', `${employee.displayName} is writing your update`);

  const settings = db.settings();
  const owner = settings?.ownerName || 'there';
  const tasks = scopeTasks(db, runId);
  const code = tasks.filter(t => t.taskType === 'code');
  const shipped = code.filter(t => isApproved(db, t));
  const shippedKeys = new Set(shipped.map(fixKeyOf));
  const notShipped = code.filter(t => !isApproved(db, t) && !shippedKeys.has(fixKeyOf(t)));
  const fixed = fixedKeys(db);
  const open = FIX_KEYS.filter(k => !fixed.has(k));
  const switches = [...db.conn.db.activity.iter()].filter(a => a.kind === 'switch' && (runId == null || a.runId === runId));
  const onReview = db.employees().filter(e => e.status === 'on_review');
  const budget = db.budget();

  // Draft facts first; the model only rewrites them. Spend so far includes this task's own reservation estimate.
  const spentSoFar = tasks.reduce((s, t) => s + t.costMicros, 0n);
  const facts = () => {
    const runRow = runId != null ? db.run(runId) : undefined;
    const spent = runRow ? runRow.totalMicros : spentSoFar;
    const b = db.budget() ?? budget;
    const lines: string[] = [];
    lines.push(`Hi ${owner}. Here's what your crew did on MediClaim ${runId != null ? 'in this run' : 'this week'}.`);
    lines.push('');
    if (shipped.length) {
      lines.push(`**Shipped (${plural(shipped.length, 'change')}, all reviewed by the Tester)**`);
      for (const t of shipped) {
        const k = fixKeyOf(t);
        lines.push(`- ${t.title}${t.branch ? ` (branch \`${t.branch}\`)` : ''}${k ? `. Before: ${KNOWN_ISSUES[k].plain.toLowerCase()}.` : ''}`);
      }
    } else {
      lines.push('**Shipped:** nothing this time.');
    }
    if (notShipped.length) lines.push('', `**Not shipped yet:** ${notShipped.map(t => t.title.toLowerCase()).join(', ')}. It goes back on the plan.`);
    lines.push('');
    lines.push(
      `**Money:** ${formatUsd(spent)} spent ${runId != null ? 'this run' : 'this week'}${
        b ? `, ${formatUsd(b.spentMicros)} of your ${formatUsd(b.limitMicros)} weekly budget` : ''
      }.${b?.spendLocked ? ' The spending lock is on, so nothing can go over that.' : ''}`
    );
    for (const s of switches.slice(0, 2)) lines.push(`- ${s.message.replace(/\.?$/, '.')} Your crew kept working without asking you.`);
    if (open.length && !connectedRepo(db)) lines.push('', `**Still open:** ${open.map(k => KNOWN_ISSUES[k].plain.toLowerCase()).join('; ')}.`);
    if (onReview.length) lines.push('', `**People:** ${onReview.map(e => e.displayName).join(', ')} ${onReview.length === 1 ? 'is' : 'are'} on review.`);
    return lines.join('\n');
  };

  const draft = facts();
  const res = await think(db, task, employee, {
    system: SYSTEM_PROMPTS.communicator,
    user: `Owner name: ${owner}. Rewrite these facts as the update email. Keep every number exactly.\n\n${draft}`,
    maxOutputTokens: Number(task.maxOutputTokens) || 1000,
    canned: draft,
  });
  // Simulated/offline: rebuild after commitSpend so the money line includes this task's own cost.
  const body = res.live ? res.text.trim() : facts();

  await db.r.writeReport({
    kind: 'weekly_update',
    authorEmployeeId: employee.id,
    title: runId != null ? 'Your update from the crew' : 'Your weekly update',
    bodyMd: body,
    period: 'week',
  });
  await pause(700);
  // MOCK: no email or SMS leaves the worker; the update is stored as a report row the web app shows.
  // Real: send bodyMd with an email/SMS provider (e.g. Resend, Twilio) on the owner's chosen channel.
  await db.log(task.runId, employee.id, 'info', `Update ${channelPhrase(settings?.commChannel)}`);
  const runRow = runId != null ? db.run(runId) : undefined;
  return {
    status: 'done',
    output: `Shipped ${plural(shipped.length, 'change')}${notShipped.length ? `, ${notShipped.length} not shipped` : ''}. Spent ${formatUsd(runRow?.totalMicros ?? spentSoFar)}.`,
  };
}
