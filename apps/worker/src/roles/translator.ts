import { FIX_KEYS, formatUsd, KNOWN_ISSUES, SYSTEM_PROMPTS, type Directive, type DirectiveIntent, type FixKey } from '@foundation/shared';
import { parseJson, type Db } from '../db';
import { think } from '../llm';
import { fixedKeys, fixKeyOf, isApproved, weekAgoMicros, type RoleCtx, type RoleResult } from './common';

/** Compact, plain-text snapshot of the database for the Translator's prompt. */
export function snapshot(db: Db): string {
  const b = db.budget();
  const s = db.settings();
  const project = [...db.conn.db.project.iter()][0];
  const fixed = fixedKeys(db);
  const open = FIX_KEYS.filter(k => !fixed.has(k));
  const lastRun = db.runs().filter(r => r.status !== 'running' && r.trigger !== 'chat').pop();
  const running = db.runs().filter(r => r.status === 'running' && r.trigger !== 'chat');
  const audit = db.latestReport('audit');
  const notes = [...db.conn.db.notification.iter()].filter(n => !n.resolved).slice(-5);
  const lines = [
    `Owner: ${s?.ownerName ?? 'the owner'}. Mode: ${s?.mode ?? 'autonomous'}.`,
    project ? `App: ${project.name}. Health score ${project.healthScore}/100. Stack: ${project.stackSummary}` : '',
    b
      ? `Weekly budget: ${formatUsd(b.spentMicros)} spent of ${formatUsd(b.limitMicros)}${b.reservedMicros > 0n ? `, ${formatUsd(b.reservedMicros)} held for work in progress` : ''}. Spending lock ${b.spendLocked ? 'on' : 'off'}. ${b.autonomousHalted ? 'Autonomous work is paused for the week.' : ''} Saved by switching models: ${formatUsd(b.savedBySwitchingMicros)}.`
      : '',
    `Providers: ${db
      .providers()
      .map(p => `${p.name} (${p.model}) ${formatUsd(p.balanceMicros)} left, ${p.status}${p.statusReason ? ` (${p.statusReason.replace(/^external:/, '')})` : ''}`)
      .join('; ')}.`,
    `Open risks: ${open.map(k => KNOWN_ISSUES[k].plain).join('; ') || 'none'}.`,
    `Fixed and approved: ${[...fixed].map(k => KNOWN_ISSUES[k].title).join('; ') || 'nothing yet'}.`,
    audit ? `Latest audit (${audit.title}): ${audit.bodyMd.replace(/\s+/g, ' ').slice(0, 700)}` : '',
    lastRun ? `Last run: ${lastRun.summary || lastRun.status}. Cost ${formatUsd(lastRun.totalMicros)}.` : '',
    running.length ? `A maintenance run is in progress right now.` : '',
    `Employees on review: ${db.employees().filter(e => e.status === 'on_review').map(e => e.displayName).join(', ') || 'none'}.`,
    notes.length ? `Pending notifications: ${notes.map(n => n.title).join('; ')}.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export function classify(text: string): DirectiveIntent {
  const t = text.toLowerCase();
  if (/\b(fix|upgrade|update|modernize|modernise|patch|repair|improve|start|run now|change|rewrite|add)\b/.test(t) && !/\?\s*$/.test(t.trim()) ) return 'start_maintenance';
  if (/\b(upgrade|fix|patch)\b.*\b(my|the)\b/.test(t)) return 'start_maintenance';
  if (/\b(bill|cost|spend|spent|spending|money|budget|price|charge|expens|pay|credit)/.test(t)) return 'billing';
  if (/\b(safe|secur|hack|risk|vulnerab|attack|breach|leak)/.test(t)) return 'question';
  if (/\b(status|doing|progress|working|happen|crew|team|update)\b/.test(t)) return 'status';
  return 'other';
}

/** Plain-English answer built only from database state (no LLM). */
export function cannedAnswer(db: Db, text: string, intent: DirectiveIntent): string {
  const b = db.budget();
  const fixed = fixedKeys(db);
  const open = FIX_KEYS.filter(k => !fixed.has(k));
  const weekCut = weekAgoMicros();
  const shippedThisWeek = db
    .tasks()
    .filter(t => t.taskType === 'code' && t.input !== '' && t.updatedAt.microsSinceUnixEpoch > weekCut && isApproved(db, t));
  const lower = text.toLowerCase();

  if (intent === 'billing') {
    const switches = [...db.conn.db.spendEvent.iter()].filter(e => e.kind === 'switch' && e.at.microsSinceUnixEpoch > weekCut);
    const low = db.providers().filter(p => p.status !== 'healthy');
    const parts = [
      b ? `You've spent ${formatUsd(b.spentMicros)} of your ${formatUsd(b.limitMicros)} weekly budget.` : 'I could not read your budget just now.',
    ];
    if (switches.length) {
      const names = [...new Set(switches.map(e => db.provider(e.providerId)?.name).filter(Boolean))];
      parts.push(`It went up mainly because a cheaper model ran low, so your crew switched ${switches.length === 1 ? 'once' : `${switches.length} times`} to ${names.join(' and ')}, which costs more per task.`);
    } else if (low.length) {
      parts.push(`${low.map(p => p.name).join(' and ')} ${low.length === 1 ? 'is' : 'are'} running low, so some work may move to a pricier model.`);
    } else {
      parts.push('Nothing unusual: the crew used its normal models.');
    }
    if (b?.spendLocked) parts.push(`The spending lock is on, so it can't go past ${formatUsd(b.limitMicros)}.`);
    return parts.join(' ');
  }
  if (intent === 'question' || /safe|secur/.test(lower)) {
    if (!open.length) return 'For the problems we know about, yes. Every risk from the last audit has an approved fix. The Auditor checks again on its next run.';
    const top = open.slice(0, 2).map(k => KNOWN_ISSUES[k].plain.toLowerCase());
    const doneKeys = [...new Set(shippedThisWeek.map(fixKeyOf).filter((k): k is FixKey => !!k))];
    const done = doneKeys.length ? ` This week the crew already fixed ${doneKeys.map(k => KNOWN_ISSUES[k].short).join(' and ')}.` : '';
    return `Not fully yet. The Auditor's biggest open ${open.length === 1 ? 'risk' : 'risks'}: ${top.join(', and ')}.${done} Tell me "fix it" and I'll have the Manager start a run.`;
  }
  if (intent === 'status') {
    const running = db.runs().some(r => r.status === 'running' && r.trigger !== 'chat');
    const last = db.runs().filter(r => r.status !== 'running' && r.trigger !== 'chat').pop();
    return `${running ? 'Your crew is working on MediClaim right now. Watch the live panel on My Developers.' : 'Your crew is between runs.'}${last ? ` Last run: ${last.summary || last.status}` : ''}`;
  }
  if (intent === 'start_maintenance') return ''; // filled in by the caller once the run starts
  const project = [...db.conn.db.project.iter()][0];
  return `Here's where things stand: MediClaim's health score is ${project?.healthScore ?? '?'} out of 100, ${open.length} known ${open.length === 1 ? 'risk is' : 'risks are'} open${
    b ? `, and you've spent ${formatUsd(b.spentMicros)} of ${formatUsd(b.limitMicros)} this week` : ''
  }. Ask me if your app is safe, why your bill changed, or tell me what to fix.`;
}

async function startMaintenance(c: RoleCtx, summary: string): Promise<string> {
  const { db, task, employee } = c;
  try {
    await db.r.startRun({ trigger: 'manual' });
    await db.log(task.runId, employee.id, 'plan', `Passed your request to the Manager: "${summary}"`);
    return 'started';
  } catch (err) {
    const msg = (err as Error).message;
    return /already in progress/i.test(msg) ? 'busy' : `error: ${msg}`;
  }
}

function maintenanceReply(text: string, outcome: string): string {
  const login = /login|log in|sign.?in/i.test(text)
    ? " MediClaim doesn't have a separate login page today, so the crew will start with the open security fixes it depends on."
    : '';
  if (outcome === 'started') return `Done. I asked the Manager to start a run for that. You can watch the Developers and the Tester on My Developers.${login}`;
  if (outcome === 'busy') return `A run is already in progress, so I've noted this for the Manager's next plan.${login}`;
  return `I couldn't start a run just now. Try Run now on My Developers.${login}`;
}

export async function translate(c: RoleCtx): Promise<RoleResult> {
  const { db, task, employee } = c;
  const question = task.input;
  const guess = classify(question);
  const snap = snapshot(db);
  const cannedText = cannedAnswer(db, question, guess);
  const res = await think(db, task, employee, {
    system: SYSTEM_PROMPTS.translator,
    user: `Database snapshot:\n${snap}\n\nOwner's message: ${question}`,
    maxOutputTokens: Number(task.maxOutputTokens) || 500,
    jsonMode: true,
    canned: JSON.stringify({ reply: cannedText, intent: guess, summary: question.slice(0, 140) }),
  });
  const parsed = parseJson<{ reply?: string; intent?: DirectiveIntent; summary?: string }>(res.text);
  const intent: DirectiveIntent = (['question', 'start_maintenance', 'billing', 'status', 'other'] as const).includes(parsed?.intent as DirectiveIntent)
    ? (parsed!.intent as DirectiveIntent)
    : guess;
  const directive: Directive = { intent, summary: (parsed?.summary || question).slice(0, 200) };

  let reply = (parsed?.reply || cannedText || cannedAnswer(db, question, 'other')).trim();
  if (intent === 'start_maintenance') {
    const outcome = await startMaintenance(c, directive.summary);
    const note = maintenanceReply(question, outcome);
    reply = res.live && parsed?.reply ? `${reply} ${note}` : note;
  }
  return { status: 'done', output: reply.replace(/!/g, '.'), directiveJson: JSON.stringify(directive) };
}

/** Blocked chat task: no budget for any model, so answer from the database with no LLM call. */
export async function translateBlocked(c: RoleCtx): Promise<RoleResult> {
  const { db, task } = c;
  const intent = classify(task.input);
  let answer = cannedAnswer(db, task.input, intent).replace(/ Tell me "fix it"[^.]*\./, '');
  if (intent === 'start_maintenance') answer = "I can't start new work until the weekly budget resets or you raise it on My Finances.";
  const directive: Directive = { intent, summary: task.input.slice(0, 200) };
  const reason = task.blockReason ? ` (${task.blockReason.toLowerCase()})` : '';
  return {
    status: 'done',
    output: `Spending is paused right now${reason}, so I'm answering from what I already know without using an AI model. ${answer}`.trim(),
    directiveJson: JSON.stringify(directive),
  };
}
