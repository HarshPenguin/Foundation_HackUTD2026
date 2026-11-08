// The work loop. All state is derived from subscribed tables, so a restarted worker picks up where it left off.
import { formatUsd, KNOWN_ISSUES, reservationFor, SYSTEM_PROMPTS, type DevTaskInput, type Role, type TesterTaskInput } from '@foundation/shared';
import type { Run, Task } from './module_bindings/types';
import { ACTIVE, Db } from './db';
import { env, pause } from './env';
import { devInput, fixKeyOf, INTERRUPTED, isApproved, isCode, plural, testerInput, testerTasksFor, type RoleCtx, type RoleResult } from './roles/common';
import { manage } from './roles/manager';
import { develop } from './roles/developer';
import { test } from './roles/tester';
import { reviewPerformance } from './roles/reviewer';
import { communicate } from './roles/communicator';
import { translate, translateBlocked } from './roles/translator';
import { hasReportSpec, writeRoleReport } from './roles/reports';
import { audit } from './roles/auditor';
import { connectedRepo, repoFixOf } from './repoWork';

type Handler = (c: RoleCtx) => Promise<RoleResult>;

function handlerFor(role: string): Handler {
  switch (role) {
    case 'translator':
      return translate;
    case 'manager':
      return manage;
    case 'developer':
      return develop;
    case 'tester':
      return test;
    case 'reviewer':
      return reviewPerformance;
    case 'communicator':
      return communicate;
    case 'auditor':
      return audit;
    default:
      return hasReportSpec(role) ? writeRoleReport : async () => ({ status: 'done', output: 'Nothing to do.' });
  }
}

export class Pipeline {
  private inFlight = new Set<string>();
  private runBusy = new Set<string>();
  private ticking = false;
  enabled = false;

  constructor(public db: Db) {}

  status() {
    return { inFlight: [...this.inFlight], enabled: this.enabled };
  }

  /** Look at the tables and start whatever work is due. Safe to call often. */
  tick() {
    if (!this.enabled || this.ticking) return;
    this.ticking = true;
    try {
      const tasks = this.db.tasks().sort((a, b) => (a.id < b.id ? -1 : 1));
      for (const t of tasks) {
        const key = t.id.toString();
        if (this.inFlight.has(key)) continue;
        if (t.status === 'queued' || t.status === 'reserved') {
          // Chat answers skip the queue so the owner is never kept waiting behind a run.
          if (t.taskType !== 'chat' && this.workSlotsUsed() >= env.concurrency) continue;
          this.spawn(key, () => this.processTask(t.id));
        } else if (t.status === 'blocked' && t.taskType === 'chat') {
          this.spawn(key, () => this.processBlockedChat(t.id));
        } else if (t.status === 'running') {
          // Running but not ours: the worker restarted mid-task. Fail it so its reservation is released.
          this.spawn(key, () => this.failOrphan(t.id));
        }
      }
      for (const r of this.db.runs()) {
        if (r.status !== 'running') continue;
        const key = r.id.toString();
        if (this.runBusy.has(key)) continue;
        this.runBusy.add(key);
        this.coordinate(r)
          .catch(err => console.error(`[run ${r.id}] coordinator error:`, (err as Error).message))
          .finally(() => this.runBusy.delete(key));
      }
    } finally {
      this.ticking = false;
    }
  }

  private workSlotsUsed() {
    let n = 0;
    for (const id of this.inFlight) if (this.db.task(BigInt(id))?.taskType !== 'chat') n++;
    return n;
  }

  private spawn(key: string, fn: () => Promise<void>) {
    this.inFlight.add(key);
    fn()
      .catch(err => console.error(`[task ${key}] unexpected error:`, err))
      .finally(() => {
        this.inFlight.delete(key);
        setTimeout(() => this.tick(), 50);
      });
  }

  private async processTask(taskId: bigint) {
    const db = this.db;
    let task = db.task(taskId);
    if (!task) return;
    const emp = db.employee(task.employeeId);
    if (!emp) {
      await this.complete(task, { status: 'failed', output: 'The employee for this task no longer exists.' });
      return;
    }

    if (task.status === 'queued') {
      const est = reservationFor(emp.role, task.taskType, `${SYSTEM_PROMPTS[emp.role as Role] ?? ''}\n${task.title}\n${task.input}`);
      try {
        await db.r.reserveBudget({ taskId, inputTokens: BigInt(est.inputTokens), maxOutputTokens: BigInt(est.maxOutputTokens) });
      } catch (err) {
        console.warn(`[task ${taskId}] reserveBudget: ${(err as Error).message}`);
        return; // someone else moved it; the next tick sees the new status
      }
      task = db.task(taskId)!;
      if (task.status === 'waiting_user') {
        await db.log(task.runId, emp.id, 'budget', `${emp.displayName} is waiting for you: ${task.blockReason}. Switch or upgrade on My Finances`);
        return;
      }
      if (task.status === 'blocked') {
        if (task.taskType === 'chat') return this.answerBlockedChat(task);
        await db.log(task.runId, emp.id, 'budget', `${emp.displayName} can't start "${task.title}": ${task.blockReason}`);
        return;
      }
      if (task.status !== 'reserved') return;
      if (task.taskType === 'code' || emp.role === 'manager') await this.logReservation(task, emp.displayName);
    }

    try {
      if (task.status === 'reserved') await db.r.claimTask({ taskId });
      else if (task.status !== 'running') return;
      const fresh = db.task(taskId) ?? task;
      const result = await handlerFor(emp.role)({ db, task: fresh, employee: emp, run: db.run(fresh.runId) });
      await this.complete(fresh, result);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.error(`[task ${taskId}] failed:`, msg);
      await db.log(task.runId, emp.id, 'info', `${emp.displayName} hit a problem on "${task.title}" and stopped: ${msg.slice(0, 200)}`);
      await this.complete(task, { status: 'failed', output: `Failed: ${msg.slice(0, 500)}` });
    }
  }

  private async logReservation(task: Task, who: string) {
    const db = this.db;
    const purser = db.byRole('purser');
    const p = db.provider(task.providerId);
    const b = db.budget();
    if (!purser || !p) return;
    await db.log(
      task.runId,
      purser.id,
      'budget',
      `Reserved ${formatUsd(task.reservedMicros)} on ${p.name} for ${who}.${b ? ` Weekly budget: ${formatUsd(b.spentMicros)} of ${formatUsd(b.limitMicros)} used` : ''}`
    );
  }

  private async processBlockedChat(taskId: bigint) {
    const task = this.db.task(taskId);
    if (task && task.status === 'blocked' && task.taskType === 'chat') await this.answerBlockedChat(task);
  }

  private async answerBlockedChat(task: Task) {
    const db = this.db;
    const emp = db.employee(task.employeeId);
    try {
      await db.r.claimTask({ taskId: task.id });
      const result = emp
        ? await translateBlocked({ db, task, employee: emp, run: db.run(task.runId) })
        : { status: 'done' as const, output: "Spending is paused right now, so I can't look into that yet.", directiveJson: '' };
      await this.complete(task, result);
    } catch (err) {
      console.error(`[task ${task.id}] blocked chat failed:`, (err as Error).message);
      await this.complete(task, { status: 'failed', output: 'Sorry, I could not answer that just now.' });
    }
  }

  private async failOrphan(taskId: bigint) {
    const task = this.db.task(taskId);
    if (!task || task.status !== 'running') return;
    await this.db.log(task.runId, task.employeeId, 'info', `"${task.title}" was interrupted by a worker restart. Its held budget was released`);
    await this.complete(task, { status: 'failed', output: INTERRUPTED });
  }

  private async complete(task: Task, r: RoleResult) {
    try {
      await this.db.r.completeTask({
        taskId: task.id,
        status: r.status,
        output: r.output,
        branch: r.branch ?? '',
        diff: r.diff ?? '',
        directiveJson: r.directiveJson ?? '',
      });
    } catch (err) {
      console.error(`[task ${task.id}] completeTask failed:`, (err as Error).message);
    }
  }

  // ------------------------------------------------------------------ run coordination

  private async coordinate(run: Run) {
    const db = this.db;
    const tasks = db.tasksOfRun(run.id).filter(t => t.taskType !== 'chat');
    if (tasks.length === 0) return; // the chat thread run stays open
    const active = tasks.some(t => ACTIVE.has(t.status));
    const blocked = tasks.filter(t => t.status === 'blocked');
    const lead = db.employee(tasks[0].employeeId);
    const crewRun = lead?.role === 'manager' || tasks.some(isCode);
    // Follow-ups (Tester, second tries) start as soon as a change lands, even while other work is running.
    if (crewRun && !blocked.length) {
      if (await this.followUps(run, tasks)) return;
    }
    if (active) return;

    if (blocked.length) {
      const finished = tasks.filter(t => t.status === 'done').length;
      return this.finish(
        run,
        'halted',
        `Paused: ${blocked[0].blockReason || 'no budget left'}. ${finished} of ${tasks.length} tasks finished before the stop.`,
        lead?.id ?? 0n
      );
    }

    if (!crewRun) {
      const t = tasks[0];
      const summary = (t.output.split('\n')[0] || `${lead?.displayName ?? 'The crew'} finished`).slice(0, 300);
      return this.finish(run, t.status === 'done' ? 'done' : 'halted', summary, lead?.id ?? 0n);
    }
    if (lead?.role === 'manager' && tasks.filter(t => t.employeeId === lead.id).every(t => t.status === 'failed') && !tasks.some(isCode)) {
      return this.finish(run, 'halted', 'The Manager could not plan this run.', lead.id);
    }

    // Manager runs end with the Reviewer, then the Communicator.
    const code = tasks.filter(isCode);
    if (lead?.role === 'manager' && code.length > 0) {
      const has = (role: string) => tasks.some(t => db.employee(t.employeeId)?.role === role);
      const scope = JSON.stringify({ runId: run.id.toString() });
      if (!has('reviewer')) {
        const reviewer = db.byRole('reviewer');
        if (reviewer) {
          await pause(800);
          await db.r.createTask({ runId: run.id, employeeId: reviewer.id, taskType: 'review', title: 'Write performance reviews for this run', input: scope });
          return;
        }
      }
      if (!has('communicator')) {
        const comm = db.byRole('communicator');
        if (comm) {
          await pause(800);
          await db.r.createTask({ runId: run.id, employeeId: comm.id, taskType: 'general', title: 'Send the owner an update', input: scope });
          return;
        }
      }
    }

    // Everything is terminal: close the run.
    const shipped = code.filter(t => isApproved(db, t));
    const keys = new Set(code.map(t => fixKeyOf(t) ?? repoFixOf(t.input)?.title ?? t.title));
    const fresh = db.run(run.id) ?? run;
    const repoName = connectedRepo(db)?.name ?? 'your repo';
    const proposals = code.filter(t => t.status === 'done' && !t.branch && repoFixOf(t.input));
    const repoShipped = shipped.filter(t => repoFixOf(t.input));
    const summary =
      repoShipped.length > 0
        ? `Fixed ${repoShipped.length} of ${plural(keys.size, 'planned risk')} in ${repoName}, each on its own branch and checked by the Tester. Spent ${formatUsd(fresh.totalMicros)}.`
        : proposals.length > 0
        ? `Wrote ${plural(proposals.length, 'fix plan')} for ${repoName}. Connect an AI key in onboarding and the Developers will apply them on branches. Spent ${formatUsd(fresh.totalMicros)}.`
        : code.length === 0
        ? 'Nothing urgent was left in the update plan.'
        : `Fixed ${shipped.length} of ${plural(keys.size, 'planned issue')}${
            shipped.length ? `: ${[...new Set(shipped.map(fixKeyOf))].map(k => (k ? KNOWN_ISSUES[k].short : 'a fix')).join(', ')}` : ''
          }. Spent ${formatUsd(fresh.totalMicros)}.`;
    return this.finish(run, 'done', summary, lead?.id ?? 0n);
  }

  /** Creates at most one follow-up task. Returns true if it did. */
  private async followUps(run: Run, tasks: Task[]): Promise<boolean> {
    const db = this.db;
    // 0. Redo, once, any task a worker restart interrupted.
    for (const t of tasks.filter(t => t.status === 'failed' && t.output === INTERRUPTED)) {
      const lead = db.employee(tasks[0].employeeId);
      if (t.id === tasks[0].id && lead?.role === 'manager' && tasks.some(isCode)) continue; // the plan already went out
      if (tasks.some(o => o.id > t.id && o.title === t.title && o.employeeId === t.employeeId)) continue;
      await db.r.createTask({ runId: run.id, employeeId: t.employeeId, taskType: t.taskType, title: t.title, input: t.input });
      await db.log(run.id, t.employeeId, 'info', `${db.name(t.employeeId)} is picking "${t.title}" back up after the restart`);
      return true;
    }
    // A Manager that never planned anything: nothing else to follow up.
    if (tasks.every(t => t.employeeId === tasks[0].employeeId && t.status === 'failed')) return false;

    // 1. Every finished change gets a Tester task.
    for (const dev of tasks.filter(t => isCode(t) && t.status === 'done')) {
      if (testerTasksFor(db, dev.id).length) continue;
      const tester = db.byRole('tester');
      if (!tester) continue;
      const rf = repoFixOf(dev.input);
      if (rf && dev.branch) {
        const rin = { devTaskId: dev.id.toString(), branch: dev.branch, file: rf.file, repoFix: rf };
        await pause(600);
        await db.r.createTask({ runId: run.id, employeeId: tester.id, taskType: 'review', title: `Review ${dev.branch}`, input: JSON.stringify(rin) });
        await db.log(run.id, tester.id, 'review', `${tester.displayName} picked up ${dev.branch} from ${db.name(dev.employeeId)}`);
        return true;
      }
      const key = fixKeyOf(dev);
      if (!key || !dev.branch) continue;
      const input: TesterTaskInput = { devTaskId: dev.id.toString(), branch: dev.branch, file: KNOWN_ISSUES[key].file, fixKey: key };
      await pause(600);
      await db.r.createTask({ runId: run.id, employeeId: tester.id, taskType: 'review', title: `Review ${dev.branch}`, input: JSON.stringify(input) });
      await db.log(run.id, tester.id, 'review', `${tester.displayName} picked up ${dev.branch} from ${db.name(dev.employeeId)}`);
      return true;
    }

    // 2. A rejected change gets one more try from its Developer.
    for (const tt of tasks.filter(t => t.taskType === 'review' && t.status === 'rejected')) {
      const ti = testerInput(tt);
      const dev = ti ? db.task(BigInt(ti.devTaskId)) : undefined;
      const key = dev ? fixKeyOf(dev) : undefined;
      if (!dev || !key) continue;
      const attempts = tasks.filter(t => isCode(t) && fixKeyOf(t) === key);
      if (attempts.length >= 2 || attempts.some(t => t.id > dev.id)) continue;
      const prev = devInput(dev);
      const issue = KNOWN_ISSUES[key];
      const input: DevTaskInput = {
        fixKey: key,
        file: issue.file,
        instructions: prev?.instructions ?? issue.instructions,
        attempt: 2,
        testerFeedback: tt.output.slice(0, 600),
      };
      await pause(600);
      await db.r.createTask({ runId: run.id, employeeId: dev.employeeId, taskType: 'code', title: `${issue.title} (second try)`, input: JSON.stringify(input) });
      await db.log(run.id, dev.employeeId, 'work', `${db.name(dev.employeeId)} will take another pass after the Tester's notes`);
      return true;
    }

    return false;
  }

  private async finish(run: Run, status: 'done' | 'halted', summary: string, employeeId: bigint) {
    try {
      await this.db.r.finishRun({ runId: run.id, status, summary });
      await this.db.log(run.id, employeeId, status === 'done' ? 'info' : 'budget', status === 'done' ? `Run finished. ${summary}` : `Run stopped. ${summary}`);
    } catch (err) {
      console.error(`[run ${run.id}] finishRun failed:`, (err as Error).message);
    }
  }
}
