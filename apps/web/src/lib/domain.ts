import type { Db } from './stdb';
import type { Employee, Notification, Provider, Report } from '@/module_bindings/types';
import { tsDate, tsMs } from './format';

export const ROLE_TASK: Record<string, string> = {
  researcher: 'research',
  developer: 'code',
  tester: 'review',
  reviewer: 'review',
  marketer: 'marketing',
  translator: 'chat',
};
export const taskTypeForRole = (role: string) => ROLE_TASK[role] ?? 'general';

export const TASK_TYPES = ['research', 'code', 'review', 'marketing', 'chat', 'general'] as const;
export const TASK_TYPE_LABEL: Record<string, string> = {
  research: 'Research',
  code: 'Code',
  review: 'Review and testing',
  marketing: 'Marketing',
  chat: 'Chatbot chat',
  general: 'Everything else',
};

export const ROLE_BLURB: Record<string, string> = {
  translator: 'Answers your questions in plain English',
  manager: 'Plans the week and assigns work',
  auditor: 'Explains how your app works and what is risky',
  researcher: 'Tracks your stack and what is out of date',
  updater: 'Turns research into an update plan',
  developer: 'Writes the fixes on a branch',
  tester: 'Checks every change before it ships',
  purser: 'Watches every dollar and switches models',
  reviewer: 'Writes performance reviews',
  marketer: 'Drafts marketing strategies',
  communicator: 'Sends your weekly update',
};

export const ROLE_ORDER = [
  'translator',
  'manager',
  'auditor',
  'researcher',
  'updater',
  'developer',
  'tester',
  'purser',
  'reviewer',
  'marketer',
  'communicator',
];

/** Sensible default cost of one run per role, in USD, when there is no spend history yet. */
export const ROLE_DEFAULT_RUN_COST: Record<string, number> = {
  translator: 0.02,
  manager: 0.12,
  auditor: 0.45,
  researcher: 0.38,
  updater: 0.15,
  developer: 0.3,
  tester: 0.12,
  purser: 0.04,
  reviewer: 0.08,
  marketer: 0.22,
  communicator: 0.06,
};

export const RUNS_PER_WEEK: Record<string, number> = {
  on_demand: 0,
  daily: 7,
  weekly: 1,
  monthly: 12 / 52,
  quarterly: 4 / 52,
};

export function providerFor(db: Db, taskType: string): Provider | undefined {
  const chain = db.chains.find(c => c.taskType === taskType) ?? db.chains.find(c => c.taskType === 'general');
  const id = chain?.providerIds[0];
  return id == null ? undefined : db.providers.find(p => p.id === id);
}

export function chainFor(db: Db, taskType: string): Provider[] {
  const chain = db.chains.find(c => c.taskType === taskType);
  if (!chain) return [];
  return chain.providerIds.map(id => db.providers.find(p => p.id === id)).filter((p): p is Provider => !!p);
}

export const activeEmployees = (db: Db) => db.employees.filter(e => e.status !== 'fired');
export const byRole = (db: Db, role: string) => db.employees.find(e => e.role === role && e.status !== 'fired');
export const employeeById = (db: Db, id: bigint) => db.employees.find(e => e.id === id);

/** Average cost of one run for this employee: task history or the typical cost for the role, whichever is higher. */
export function avgRunCost(db: Db, e: Employee): number {
  const typical = ROLE_DEFAULT_RUN_COST[e.role] ?? 0.1;
  const mine = db.tasks.filter(t => t.employeeId === e.id && t.costMicros > 0n);
  if (!mine.length) return typical;
  const runs = new Set(mine.map(t => t.runId.toString())).size || 1;
  const history = mine.reduce((s, t) => s + Number(t.costMicros), 0) / 1e6 / runs;
  // Conservative: a run also pays for planning and retries, so never estimate below the typical cost.
  return Math.max(history, typical);
}

export function available(p: Provider): bigint {
  return p.balanceMicros > p.reservedMicros ? p.balanceMicros - p.reservedMicros : 0n;
}

export function latestReport(db: Db, kind: string): Report | undefined {
  const rs = db.reports.filter(r => r.kind === kind);
  return rs.sort((a, b) => tsMs(b.at) - tsMs(a.at))[0];
}

export function currentRun(db: Db) {
  return [...db.runs].reverse().find(r => r.status === 'running' && r.trigger !== 'chat');
}
export function lastFinishedRun(db: Db) {
  return [...db.runs].reverse().find(r => r.status !== 'running' && r.trigger !== 'chat');
}

export function nextCrewRun(db: Db): Date | null {
  const m = byRole(db, 'manager');
  if (m?.nextRunAt) return tsDate(m.nextRunAt);
  const times = activeEmployees(db)
    .map(e => tsDate(e.nextRunAt))
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());
  return times[0] ?? null;
}

/** Unresolved notifications that offer the owner a switch-or-upgrade choice. */
export function isSwitchNotice(n: Notification): boolean {
  return !n.resolved && (n.kind === 'switch_or_upgrade' || (n.kind === 'info' && n.providerId != null));
}

export function openNotifications(db: Db): Notification[] {
  return db.notifications.filter(n => !n.resolved).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
}

export function weeklyProjection(db: Db): number {
  return activeEmployees(db).reduce((s, e) => s + (RUNS_PER_WEEK[e.cadence] ?? 0) * avgRunCost(db, e), 0);
}
