import { cannedReviewerHeadline, formatUsd, SYSTEM_PROMPTS } from '@foundation/shared';
import type { Task } from '../module_bindings/types';
import { pause } from '../env';
import { parseJson, type Db } from '../db';
import { think } from '../llm';
import { INTERRUPTED, isApproved, testerTasksFor, weekAgoMicros, type RoleCtx, type RoleResult } from './common';

export interface Metric {
  employeeId: bigint;
  name: string;
  role: string;
  tasksDone: number;
  rejections: number;
  failures: number;
  costMicros: bigint;
  costPerAcceptedMicros: bigint;
  score: number;
  recommendation: 'keep' | 'coach' | 'replace';
}

/** Tasks a review or update covers: one run, or the last 7 days. */
export function scopeTasks(db: Db, runId: bigint | undefined): Task[] {
  if (runId != null) return db.tasksOfRun(runId);
  const cutoff = weekAgoMicros();
  return db.tasks().filter(t => t.updatedAt.microsSinceUnixEpoch > cutoff);
}

export function computeMetrics(db: Db, tasks: Task[]): Metric[] {
  const skip = new Set(['reviewer', 'communicator', 'translator']);
  const byEmp = new Map<bigint, Task[]>();
  for (const t of tasks) {
    if (t.output === INTERRUPTED) continue; // a restart is not the employee's fault
    if (!byEmp.has(t.employeeId)) byEmp.set(t.employeeId, []);
    byEmp.get(t.employeeId)!.push(t);
  }
  const out: Metric[] = [];
  for (const [employeeId, ts] of byEmp) {
    const e = db.employee(employeeId);
    if (!e || skip.has(e.role)) continue;
    let tasksDone = 0;
    let rejections = 0;
    let failures = 0;
    const costMicros = ts.reduce((s, t) => s + t.costMicros, 0n);
    if (e.role === 'developer') {
      for (const t of ts.filter(t => t.taskType === 'code')) {
        if (t.status === 'failed') failures++;
        else if (isApproved(db, t)) tasksDone++;
        rejections += testerTasksFor(db, t.id).filter(r => r.status === 'rejected').length;
      }
    } else if (e.role === 'tester') {
      tasksDone = ts.filter(t => t.status === 'done' || t.status === 'rejected').length;
      failures = ts.filter(t => t.status === 'failed').length;
    } else {
      tasksDone = ts.filter(t => t.status === 'done').length;
      rejections = ts.filter(t => t.status === 'rejected').length;
      failures = ts.filter(t => t.status === 'failed').length;
    }
    let score = 96 - 12 * rejections - 25 * failures;
    if (e.role === 'developer' && tasksDone === 0) score -= 25;
    score = Math.max(20, Math.min(99, score));
    const recommendation = score >= 80 ? 'keep' : score >= 60 ? 'coach' : 'replace';
    out.push({
      employeeId,
      name: e.displayName,
      role: e.role,
      tasksDone,
      rejections,
      failures,
      costMicros,
      costPerAcceptedMicros: tasksDone > 0 ? costMicros / BigInt(tasksDone) : costMicros,
      score,
      recommendation,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

function cannedNote(m: Metric): string {
  if (m.role === 'developer') {
    if (m.failures) return `${m.failures === 1 ? 'One task' : `${m.failures} tasks`} failed. Needs a closer look at the brief.`;
    if (m.rejections) return `Shipped ${m.tasksDone} after ${m.rejections === 1 ? 'one rejection' : `${m.rejections} rejections`} from the Tester.`;
    return `Shipped ${m.tasksDone === 1 ? 'a clean fix' : `${m.tasksDone} clean fixes`}, approved first time${m.costPerAcceptedMicros > 0n ? `, at ${formatUsd(m.costPerAcceptedMicros)} per accepted change` : ''}.`;
  }
  if (m.role === 'tester') return `Checked ${m.tasksDone} ${m.tasksDone === 1 ? 'change' : 'changes'} with scripted tests before anything counted.`;
  if (m.role === 'manager') return 'Planned the run from the audit and kept it inside the budget.';
  return m.failures ? 'Had trouble finishing its work this run.' : 'Delivered on time.';
}

export async function reviewPerformance(c: RoleCtx): Promise<RoleResult> {
  const { db, task, employee } = c;
  const scope = parseJson<{ runId?: string }>(task.input);
  const runId = scope?.runId ? BigInt(scope.runId) : undefined;
  await db.log(task.runId, employee.id, 'review', `${employee.displayName} is scoring the crew's work${runId != null ? ' on this run' : ' this week'}`);

  const metrics = computeMetrics(db, scopeTasks(db, runId));
  const facts = metrics
    .map(m => `${m.name} (${m.role}): ${m.tasksDone} done, ${m.rejections} rejected, ${m.failures} failed, cost per accepted change ${formatUsd(m.costPerAcceptedMicros)}, score ${m.score}`)
    .join('\n');
  const cannedNotes = Object.fromEntries(metrics.map(m => [m.name, cannedNote(m)]));
  const res = await think(db, task, employee, {
    system: SYSTEM_PROMPTS.reviewer,
    user: `Metrics:\n${facts || 'No tasks in scope.'}`,
    maxOutputTokens: Number(task.maxOutputTokens) || 900,
    jsonMode: true,
    canned: JSON.stringify({ notes: cannedNotes, headline: cannedReviewerHeadline(metrics.map(m => m.name)) }),
  });
  const parsed = parseJson<{ notes?: Record<string, string>; headline?: string }>(res.text);
  const notes = { ...cannedNotes, ...(parsed?.notes ?? {}) };

  for (const m of metrics) {
    await db.r.writeReview({
      employeeId: m.employeeId,
      period: runId != null ? 'this run' : 'this week',
      score: m.score,
      tasksDone: m.tasksDone,
      rejections: m.rejections,
      failures: m.failures,
      costPerAcceptedMicros: m.costPerAcceptedMicros,
      recommendation: m.recommendation,
      summary: String(notes[m.name] ?? cannedNote(m)).slice(0, 400),
    });
  }

  const verdict = (r: string) => (r === 'keep' ? 'Keep' : r === 'coach' ? 'Coach' : '**Replace**');
  const table = [
    '| Employee | Score | Done | Rejected | Failed | Cost per accepted | Verdict |',
    '|---|---|---|---|---|---|---|',
    ...metrics.map(m => `| ${m.name} | ${m.score} | ${m.tasksDone} | ${m.rejections} | ${m.failures} | ${formatUsd(m.costPerAcceptedMicros)} | ${verdict(m.recommendation)} |`),
  ].join('\n');
  const flagged = metrics.filter(m => m.recommendation !== 'keep');
  const body = `${table}\n\n${metrics.map(m => `- **${m.name}:** ${notes[m.name]}`).join('\n')}\n\n${
    flagged.length ? `**On review:** ${flagged.map(m => m.name).join(', ')}.` : 'Everyone on this run is a keep.'
  }`;
  await db.r.writeReport({
    kind: 'performance_review',
    authorEmployeeId: employee.id,
    title: runId != null ? `Performance reviews: run ${runId}` : 'Performance reviews: this week',
    bodyMd: body,
    period: 'week',
  });
  await pause(800);
  const line = metrics.map(m => `${m.name} ${m.score} (${m.recommendation})`).join(', ');
  await db.log(task.runId, employee.id, 'review', metrics.length ? `Reviews written: ${line}` : 'No work to review');
  return { status: 'done', output: parsed?.headline || cannedReviewerHeadline(metrics.map(m => m.name)) };
}
