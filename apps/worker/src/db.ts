// Read helpers over the subscribed client cache, plus thin wrappers for worker reducers.
import type { Conn } from './stdb';
import type { Employee, Provider, Run, Task } from './module_bindings/types';
import type { ActivityKind } from '@foundation/shared';

export const TERMINAL = new Set(['done', 'rejected', 'failed']);
export const ACTIVE = new Set(['queued', 'reserved', 'running', 'waiting_user']);

export class Db {
  constructor(public conn: Conn) {}

  get r() {
    return this.conn.reducers;
  }

  task(id: bigint): Task | undefined {
    return this.conn.db.task.id.find(id) ?? undefined;
  }
  tasks(): Task[] {
    return [...this.conn.db.task.iter()];
  }
  tasksOfRun(runId: bigint): Task[] {
    return this.tasks()
      .filter(t => t.runId === runId)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  run(id: bigint): Run | undefined {
    return this.conn.db.run.id.find(id) ?? undefined;
  }
  runs(): Run[] {
    return [...this.conn.db.run.iter()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  employee(id: bigint): Employee | undefined {
    return this.conn.db.employee.id.find(id) ?? undefined;
  }
  employees(): Employee[] {
    return [...this.conn.db.employee.iter()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  byRole(role: string): Employee | undefined {
    return this.employees().find(e => e.role === role && e.status !== 'fired');
  }
  developers(): Employee[] {
    return this.employees().filter(e => e.role === 'developer' && e.status !== 'fired');
  }
  /** "Dev-Security" also matches its replacement "Dev-Security #2". */
  developerNamed(name: string): Employee | undefined {
    const base = name.replace(/ #\d+$/, '').toLowerCase();
    return this.developers().find(e => e.displayName.replace(/ #\d+$/, '').toLowerCase() === base);
  }
  provider(id: bigint | undefined): Provider | undefined {
    return id == null ? undefined : (this.conn.db.provider.id.find(id) ?? undefined);
  }
  providers(): Provider[] {
    return [...this.conn.db.provider.iter()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  budget() {
    return this.conn.db.budget.id.find(0) ?? undefined;
  }
  settings() {
    return this.conn.db.settings.id.find(0) ?? undefined;
  }
  latestReport(kind: string) {
    return [...this.conn.db.report.iter()]
      .filter(r => r.kind === kind)
      .sort((a, b) => (a.at.microsSinceUnixEpoch < b.at.microsSinceUnixEpoch ? 1 : -1))[0];
  }
  name(employeeId: bigint): string {
    return this.employee(employeeId)?.displayName ?? 'The crew';
  }

  /** Never throws: the activity feed is best-effort. */
  async log(runId: bigint, employeeId: bigint, kind: ActivityKind, message: string) {
    try {
      await this.r.logActivity({ runId, employeeId, kind, message: message.slice(0, 1000) });
    } catch (err) {
      console.warn('[log] logActivity failed:', (err as Error).message);
    }
    console.log(`  [run ${runId}] ${this.name(employeeId)} (${kind}): ${message}`);
  }
}

export function parseJson<T>(s: string): T | undefined {
  if (!s) return undefined;
  try {
    return JSON.parse(s) as T;
  } catch {
    // Models sometimes wrap JSON in prose or fences: take the outermost object.
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return undefined;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return undefined;
    }
  }
}

export function nowMicros(): bigint {
  return BigInt(Date.now()) * 1000n;
}
