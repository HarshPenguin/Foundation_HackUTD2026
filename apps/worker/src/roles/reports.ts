// Scheduled single-employee runs: one LLM step, one report.
import {
  cannedAudit,
  cannedInsights,
  cannedMarketing,
  cannedResearch,
  cannedUpdatePlan,
  formatUsd,
  SYSTEM_PROMPTS,
  type ReportKind,
  type Role,
} from '@foundation/shared';
import { pause } from '../env';
import type { Db } from '../db';
import { think } from '../llm';
import { listFiles, readMainFile } from '../workspace';
import { isApproved, type RoleCtx, type RoleResult } from './common';

interface Spec {
  kind: ReportKind;
  title: string;
  period: string;
  verb: string;
  context: (db: Db) => Promise<string>;
  canned: (db: Db) => string;
  done: string;
}

function shippedTitles(db: Db): string[] {
  const cut = BigInt(Date.now() - 30 * 24 * 3600 * 1000) * 1000n;
  return db
    .tasks()
    .filter(t => t.taskType === 'code' && t.updatedAt.microsSinceUnixEpoch > cut && isApproved(db, t))
    .map(t => t.title);
}

function purserLines(db: Db): string[] {
  const lines: string[] = [];
  const nowMicros = BigInt(Date.now()) * 1000n;
  for (const p of db.providers()) {
    const idleDays = p.lastUsedAt ? Number((nowMicros - p.lastUsedAt.microsSinceUnixEpoch) / 86_400_000_000n) : 999;
    if (idleDays >= 30 && p.balanceMicros > 0n)
      lines.push(`**${p.name} hasn't been used in ${idleDays >= 999 ? 'a long time' : `${idleDays} days`}** but holds ${formatUsd(p.balanceMicros)}. Consider removing that key or putting it first in a chain.`);
    if (p.status === 'stopped') lines.push(`**${p.name} is stopped** (${p.statusReason.replace(/^external:/, '')}). Your crew is skipping it. Switch or upgrade on My Finances.`);
    else if (p.status === 'low') lines.push(`**${p.name} is nearly empty** (${formatUsd(p.balanceMicros - p.reservedMicros)} left). In Autonomous mode the crew will switch automatically.`);
  }
  const b = db.budget();
  if (b) {
    lines.push(`**This week:** ${formatUsd(b.spentMicros)} of ${formatUsd(b.limitMicros)} spent. Switching models saved ${formatUsd(b.savedBySwitchingMicros)}.`);
  }
  const used = db.providers().filter(p => p.usesThisWeek > 0).map(p => p.name);
  if (used.length) lines.push(`**APIs you actually used this week:** ${used.join(', ')}.`);
  return lines;
}

const SPECS: Partial<Record<Role, Spec>> = {
  researcher: {
    kind: 'research',
    title: 'Stack research: PHP and jQuery',
    period: 'month',
    verb: 'is researching the MediClaim stack',
    context: async db => `Stack: ${[...db.conn.db.project.iter()][0]?.stackSummary ?? 'PHP 5.6, jQuery 1.4, MySQL'}\nLast research drop:\n${db.latestReport('research')?.bodyMd ?? 'none'}`,
    canned: () => cannedResearch(),
    done: 'Research drop delivered to the Updater',
  },
  marketer: {
    kind: 'marketing_strategy',
    title: 'Marketing strategy: what shipped',
    period: 'month',
    verb: 'is turning what shipped into a marketing plan',
    context: async db => `Shipped in the last 30 days:\n${shippedTitles(db).map(t => `- ${t}`).join('\n') || 'nothing yet'}`,
    canned: db => cannedMarketing(shippedTitles(db)),
    done: 'Marketing strategy ready in My Communications',
  },
  auditor: {
    kind: 'audit',
    title: 'How MediClaim works',
    period: 'monthly',
    verb: 'is mapping the MediClaim codebase',
    context: async () => {
      const files = await listFiles();
      const heads = await Promise.all(
        files.filter(f => f.endsWith('.php')).slice(0, 6).map(async f => `--- ${f}\n${(await readMainFile(f)).slice(0, 600)}`)
      );
      return `Files:\n${files.join('\n')}\n\n${heads.join('\n\n')}`;
    },
    canned: () => cannedAudit(),
    done: 'Audit written: 5 risks, 1 dead file',
  },
  updater: {
    kind: 'update_plan',
    title: 'Update plan for Developers',
    period: 'month',
    verb: 'is turning research into an update plan',
    context: async db => `Audit:\n${db.latestReport('audit')?.bodyMd ?? ''}\n\nResearch:\n${db.latestReport('research')?.bodyMd ?? ''}`,
    canned: () => cannedUpdatePlan(),
    done: 'Update plan sent to the Manager',
  },
  purser: {
    kind: 'insights',
    title: 'Spending insights',
    period: 'week',
    verb: 'is reviewing what your APIs cost this week',
    context: async db => purserLines(db).join('\n'),
    canned: db => cannedInsights(purserLines(db)),
    done: 'Spending insights ready on My Finances',
  },
};

export function hasReportSpec(role: string): boolean {
  return role in SPECS;
}

export async function writeRoleReport(c: RoleCtx): Promise<RoleResult> {
  const { db, task, employee } = c;
  const spec = SPECS[employee.role as Role];
  if (!spec) return { status: 'done', output: 'Nothing to do for this role.' };
  await db.log(task.runId, employee.id, 'work', `${employee.displayName} ${spec.verb}`);
  const context = await spec.context(db).catch(() => '');
  const canned = spec.canned(db);
  const res = await think(db, task, employee, {
    system: SYSTEM_PROMPTS[employee.role as Role],
    user: `${context}\n\n${employee.handoffNote ? `Handoff note: ${employee.handoffNote}\n\n` : ''}Write this period's ${spec.kind.replace('_', ' ')}.`,
    maxOutputTokens: Number(task.maxOutputTokens) || 1200,
    canned,
  });
  const body = (res.text || canned).trim();
  await db.r.writeReport({ kind: spec.kind, authorEmployeeId: employee.id, title: spec.title, bodyMd: body, period: spec.period });
  await pause(700);
  await db.log(task.runId, employee.id, 'info', spec.done);
  return { status: 'done', output: spec.done };
}

