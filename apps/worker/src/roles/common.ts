import { isFixKey, KNOWN_ISSUES, type DevTaskInput, type FixKey, type TesterTaskInput } from '@foundation/shared';
import type { Employee, Run, Task } from '../module_bindings/types';
import { parseJson, type Db } from '../db';

export interface RoleCtx {
  db: Db;
  task: Task;
  employee: Employee;
  run: Run | undefined;
}

export interface RoleResult {
  status: 'done' | 'rejected' | 'failed';
  output: string;
  branch?: string;
  diff?: string;
  directiveJson?: string;
}

/** Output of a task failed because the worker restarted mid-task. The coordinator redoes these once. */
export const INTERRUPTED = 'Interrupted by a worker restart.';

export function devInput(t: Task): DevTaskInput | undefined {
  const j = parseJson<DevTaskInput>(t.input);
  return j && isFixKey(j.fixKey) ? j : undefined;
}

export function testerInput(t: Task): TesterTaskInput | undefined {
  const j = parseJson<TesterTaskInput>(t.input);
  return j && j.devTaskId && j.branch ? j : undefined;
}

/** Which known issue a code task is about (from its input, or its title for seeded rows). */
export function fixKeyOf(t: Task): FixKey | undefined {
  const j = devInput(t);
  if (j) return j.fixKey;
  const title = t.title.toLowerCase();
  for (const issue of Object.values(KNOWN_ISSUES)) if (issue.title.toLowerCase() === title) return issue.key;
  if (/jquery/.test(title)) return 'jquery';
  if (/sql/.test(title)) return 'sqli';
  if (/round|cent|total/.test(title)) return 'rounding';
  if (/password|secret|config/.test(title)) return 'config_secret';
  return undefined;
}

export function isCode(t: Task) {
  return t.taskType === 'code';
}

/** Tester tasks that review a given developer task. */
export function testerTasksFor(db: Db, devTaskId: bigint): Task[] {
  return db.tasks().filter(t => t.taskType === 'review' && testerInput(t)?.devTaskId === devTaskId.toString());
}

export function isApproved(db: Db, dev: Task): boolean {
  if (dev.status !== 'done') return false;
  if (dev.input === '') return true; // seeded history rows have no tester task
  return testerTasksFor(db, dev.id).some(t => t.status === 'done');
}

/** Issues with an approved fix anywhere in history. */
export function fixedKeys(db: Db): Set<FixKey> {
  const s = new Set<FixKey>();
  for (const t of db.tasks()) {
    if (!isCode(t)) continue;
    const k = fixKeyOf(t);
    if (k && isApproved(db, t)) s.add(k);
  }
  return s;
}

export function stripFences(text: string): string {
  const m = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return (m ? m[1] : text).replace(/^\s+/, '');
}

export function weekAgoMicros(): bigint {
  return BigInt(Date.now() - 7 * 24 * 3600 * 1000) * 1000n;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
