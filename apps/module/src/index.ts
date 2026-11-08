import { Router, SenderError, SyncResponse, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';
import spacetimedb, { ChainChoice, cadenceTimer, reservationTimer, wakeTimer, weekRolloverTimer } from './schema';
import { seed, wipe } from './seed';
import { applyChains, applyProviderConfig, providerByName, reapplyOwnerSetup, SEEDED_PROVIDERS } from './config';

export { default } from './schema';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const MINUTE = 60_000_000n;
const HOUR = 60n * MINUTE;
const DAY = 24n * HOUR;
const WEEK = 7n * DAY;
const RESERVATION_TIMEOUT = 10n * MINUTE;
const LOW_HEADROOM = 1_000_000n; // under $1 above threshold => "low"
const UPGRADE_MICROS = 20_000_000n; // MOCK: "Upgrade" adds $20. Real: provider billing API / checkout link.

// ---------------------------------------------------------------- helpers

function now(ctx: Ctx): bigint {
  return ctx.timestamp.microsSinceUnixEpoch;
}
function ts(micros: bigint): Timestamp {
  return new Timestamp(micros);
}
function usd(m: bigint): string {
  const cents = (m + 5_000n) / 10_000n;
  const neg = cents < 0n;
  const c = neg ? -cents : cents;
  return `${neg ? '-' : ''}$${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
}
function auth(ctx: Ctx) {
  const a = ctx.db.authConfig.id.find(0);
  if (!a) throw new SenderError('module not initialized');
  return a;
}
function isAdmin(ctx: Ctx) {
  return auth(ctx).adminIdentity.isEqual(ctx.sender);
}
function isWorker(ctx: Ctx) {
  const w = auth(ctx).workerIdentity;
  return w != null && w.isEqual(ctx.sender);
}
function isOwner(ctx: Ctx) {
  const o = auth(ctx).ownerIdentity;
  return o != null && o.isEqual(ctx.sender);
}
function requireWorker(ctx: Ctx) {
  if (!isWorker(ctx) && !isAdmin(ctx)) throw new SenderError('only the registered worker can do this');
}
function getBudget(ctx: Ctx) {
  const b = ctx.db.budget.id.find(0);
  if (!b) throw new SenderError('budget missing');
  return b;
}
function getSettings(ctx: Ctx) {
  const s = ctx.db.settings.id.find(0);
  if (!s) throw new SenderError('settings missing');
  return s;
}
function getTask(ctx: Ctx, id: bigint) {
  const tk = ctx.db.task.id.find(id);
  if (!tk) throw new SenderError(`task ${id} not found`);
  return tk;
}
function log(ctx: Ctx, runId: bigint, employeeId: bigint, kind: string, message: string) {
  ctx.db.activity.insert({ id: 0n, runId, employeeId, kind, message, at: ctx.timestamp });
}
function notify(
  ctx: Ctx,
  kind: string,
  title: string,
  body: string,
  taskId?: bigint,
  providerId?: bigint
) {
  textForNotification(ctx, kind, title, body);
  ctx.db.notification.insert({
    id: 0n,
    kind,
    title,
    body,
    taskId: taskId ?? undefined,
    providerId: providerId ?? undefined,
    resolved: false,
    createdAt: ctx.timestamp,
  });
}
function costFor(p: { priceInPerMTok: bigint; priceOutPerMTok: bigint }, inTok: bigint, outTok: bigint) {
  // Round up to the next micro-dollar so estimates never under-reserve.
  const raw = inTok * p.priceInPerMTok + outTok * p.priceOutPerMTok;
  return (raw + 999_999n) / 1_000_000n;
}
function refreshProviderStatus(ctx: Ctx, providerId: bigint) {
  const p = ctx.db.provider.id.find(providerId);
  if (!p) return;
  if (p.status === 'stopped' && p.statusReason.startsWith('external:')) return; // stays stopped until upgraded
  const avail = p.balanceMicros > p.reservedMicros ? p.balanceMicros - p.reservedMicros : 0n;
  let status = 'healthy';
  let reason = '';
  if (avail <= p.thresholdMicros) {
    status = 'stopped';
    reason = `Reached its ${usd(p.thresholdMicros)} limit`;
  } else if (avail - p.thresholdMicros < LOW_HEADROOM) {
    status = 'low';
    reason = `${usd(avail - p.thresholdMicros)} left before its limit`;
  }
  if (status !== p.status || reason !== p.statusReason) {
    ctx.db.provider.id.update({ ...p, status, statusReason: reason });
  }
}
function releaseReservation(ctx: Ctx, taskId: bigint, why: string) {
  const tk = ctx.db.task.id.find(taskId);
  if (!tk || tk.reservedMicros === 0n) return;
  const amt = tk.reservedMicros;
  if (tk.providerId != null) {
    const p = ctx.db.provider.id.find(tk.providerId);
    if (p) {
      ctx.db.provider.id.update({ ...p, reservedMicros: p.reservedMicros > amt ? p.reservedMicros - amt : 0n });
      refreshProviderStatus(ctx, p.id);
    }
  }
  const b = getBudget(ctx);
  ctx.db.budget.id.update({ ...b, reservedMicros: b.reservedMicros > amt ? b.reservedMicros - amt : 0n });
  ctx.db.task.id.update({ ...tk, reservedMicros: 0n, updatedAt: ctx.timestamp });
  ctx.db.spendEvent.insert({
    id: 0n,
    taskId,
    providerId: tk.providerId ?? 0n,
    estMicros: amt,
    actualMicros: 0n,
    kind: 'release',
    at: ctx.timestamp,
  });
  if (why !== 'timeout') {
    for (const r of [...ctx.db.reservationTimer.iter()]) {
      if (r.taskId === taskId) ctx.db.reservationTimer.scheduledId.delete(r.scheduledId);
    }
  }
}

// ------------------------------------------------------------- schedules

function nextRunMicros(
  e: { cadence: string; runDay: number; runHour: number; utcOffsetMinutes: number },
  fromMicros: bigint
): bigint | null {
  if (e.cadence === 'on_demand') return null;
  const offset = BigInt(e.utcOffsetMinutes) * MINUTE;
  const local = fromMicros + offset; // "local wall clock" as micros since epoch
  const dayStart = local - (((local % DAY) + DAY) % DAY);
  const hour = BigInt(e.runHour) * HOUR;
  if (e.cadence === 'daily') {
    let c = dayStart + hour;
    if (c <= local) c += DAY;
    return c - offset;
  }
  if (e.cadence === 'weekly') {
    const dow = Number(((dayStart / DAY) + 4n) % 7n); // 1970-01-01 was a Thursday
    let delta = (e.runDay - dow + 7) % 7;
    let c = dayStart + BigInt(delta) * DAY + hour;
    if (c <= local) c += WEEK;
    return c - offset;
  }
  // monthly / quarterly: approximate months as 30 / 91 days from the chosen day-of-month.
  const period = e.cadence === 'monthly' ? 30n * DAY : 91n * DAY;
  let c = dayStart + hour;
  while (c <= local) c += period;
  return c - offset;
}

function rescheduleEmployee(ctx: Ctx, employeeId: bigint, firingTimerId?: bigint) {
  for (const r of [...ctx.db.cadenceTimer.iter()]) {
    // The timer that is firing right now is deleted by SpacetimeDB itself.
    if (r.employeeId === employeeId && r.scheduledId !== firingTimerId) ctx.db.cadenceTimer.scheduledId.delete(r.scheduledId);
  }
  const e = ctx.db.employee.id.find(employeeId);
  if (!e || e.status === 'fired') return;
  const next = nextRunMicros(e, now(ctx));
  ctx.db.employee.id.update({ ...e, nextRunAt: next == null ? undefined : ts(next) });
  if (next != null) {
    ctx.db.cadenceTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(next), employeeId });
  }
}
function rescheduleAll(ctx: Ctx) {
  for (const e of [...ctx.db.employee.iter()]) rescheduleEmployee(ctx, e.id);
}

const TASK_TYPE_BY_ROLE: Record<string, string> = {
  researcher: 'research',
  developer: 'code',
  tester: 'review',
  reviewer: 'review',
  marketer: 'marketing',
  translator: 'chat',
};

function createRun(ctx: Ctx, trigger: string, firstEmployeeId: bigint, title: string, input: string) {
  const r = ctx.db.run.insert({
    id: 0n,
    trigger,
    status: 'running',
    summary: '',
    startedAt: ctx.timestamp,
    endedAt: undefined,
    totalMicros: 0n,
  });
  const e = ctx.db.employee.id.find(firstEmployeeId);
  insertTask(ctx, r.id, firstEmployeeId, TASK_TYPE_BY_ROLE[e?.role ?? ''] ?? 'general', title, input);
  return r;
}

function insertTask(ctx: Ctx, runId: bigint, employeeId: bigint, taskType: string, title: string, input: string) {
  maybeWakeCrew(ctx, title);
  return ctx.db.task.insert({
    id: 0n,
    runId,
    employeeId,
    taskType,
    status: 'queued',
    title,
    input,
    output: '',
    branch: '',
    diff: '',
    providerId: undefined,
    inputTokens: 0n,
    maxOutputTokens: 0n,
    estMicros: 0n,
    reservedMicros: 0n,
    costMicros: 0n,
    excludedProviderIds: [],
    blockReason: '',
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
}

function activeByRole(ctx: Ctx, role: string) {
  return [...ctx.db.employee.iter()].find(e => e.role === role && e.status !== 'fired');
}

export const onCadence = spacetimedb.reducer({ onSchedule: cadenceTimer }, { timer: cadenceTimer.rowType }, (ctx, { timer }) => {
  const e = ctx.db.employee.id.find(timer.employeeId);
  if (!e || e.status === 'fired') return;
  const b = getBudget(ctx);
  if (b.autonomousHalted && getSettings(ctx).mode === 'autonomous') {
    log(ctx, 0n, e.id, 'budget', `${e.displayName} skipped a scheduled run: autonomous work is paused until the weekly budget resets`);
  } else {
    const r = createRun(ctx, 'schedule', e.id, `Scheduled ${e.cadence} work for ${e.displayName}`, '');
    log(ctx, r.id, e.id, 'plan', `Scheduled ${e.cadence} run started for ${e.displayName}`);
  }
  ctx.db.employee.id.update({ ...e, lastRunAt: ctx.timestamp });
  rescheduleEmployee(ctx, e.id, timer.scheduledId);
});

export const onWeekRollover = spacetimedb.reducer(
  { onSchedule: weekRolloverTimer },
  { timer: weekRolloverTimer.rowType },
  (ctx, { timer: _timer }) => {
    const b = getBudget(ctx);
    ctx.db.budget.id.update({
      ...b,
      weekStart: ctx.timestamp,
      spentMicros: 0n,
      spendLocked: true, // re-locks automatically each week
      autonomousHalted: false,
    });
    for (const p of [...ctx.db.provider.iter()]) ctx.db.provider.id.update({ ...p, usesThisWeek: 0 });
    for (const i of [...ctx.db.integration.iter()]) ctx.db.integration.id.update({ ...i, sessionsThisWeek: 0, spentThisWeekMicros: 0n });
    log(ctx, 0n, 0n, 'budget', 'New week: budget reset, spending lock back on');
  }
);

export const onReservationTimeout = spacetimedb.reducer(
  { onSchedule: reservationTimer },
  { timer: reservationTimer.rowType },
  (ctx, { timer }) => {
    const tk = ctx.db.task.id.find(timer.taskId);
    if (!tk || tk.reservedMicros === 0n) return;
    if (tk.status !== 'reserved' && tk.status !== 'running') return;
    releaseReservation(ctx, tk.id, 'timeout');
    ctx.db.task.id.update({ ...getTask(ctx, tk.id), status: 'failed', blockReason: 'Timed out after 10 minutes' });
    log(ctx, tk.runId, tk.employeeId, 'budget', `Released ${usd(tk.reservedMicros)} held for "${tk.title}" after a 10 minute timeout`);
  }
);

// ------------------------------------------------------------- lifecycle

export const init = spacetimedb.init(ctx => {
  ctx.db.authConfig.insert({
    id: 0,
    adminIdentity: ctx.sender,
    workerIdentity: undefined,
    ownerIdentity: undefined,
    pairingCode: '',
    ownerPasscode: '',
  });
  seed(ctx);
  rescheduleAll(ctx);
  ctx.db.weekRolloverTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(WEEK) });
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  if (isWorker(ctx)) {
    const s = getSettings(ctx);
    ctx.db.settings.id.update({ ...s, workerOnline: false });
  }
});

// ------------------------------------------------------------- identity

export const setWorkerPairingCode = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  if (!isAdmin(ctx)) throw new SenderError('admin only');
  if (code.length < 16) throw new SenderError('pairing code must be at least 16 characters');
  ctx.db.authConfig.id.update({ ...auth(ctx), pairingCode: code });
});

export const registerWorker = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  const a = auth(ctx);
  if (a.pairingCode.length < 16 || code !== a.pairingCode) throw new SenderError('bad pairing code');
  ctx.db.authConfig.id.update({ ...a, workerIdentity: ctx.sender });
  const s = getSettings(ctx);
  ctx.db.settings.id.update({ ...s, workerOnline: true, workerLastSeenAt: ctx.timestamp });
});

export const workerHeartbeat = spacetimedb.reducer(ctx => {
  requireWorker(ctx);
  const s = getSettings(ctx);
  ctx.db.settings.id.update({ ...s, workerOnline: true, workerLastSeenAt: ctx.timestamp });
});

// MOCK: a shared owner passcode stands in for real login. Real: Supabase/SpacetimeAuth.
// The right passcode always takes ownership, even from another browser.
export const claimOwner = spacetimedb.reducer({ passcode: t.string() }, (ctx, { passcode }) => {
  const a = auth(ctx);
  if (a.ownerPasscode.length === 0 || passcode !== a.ownerPasscode) throw new SenderError('Wrong owner passcode');
  ctx.db.authConfig.id.update({ ...a, ownerIdentity: ctx.sender });
});

export const setOwnerPasscode = spacetimedb.reducer({ passcode: t.string() }, (ctx, { passcode }) => {
  if (!isAdmin(ctx)) throw new SenderError('admin only');
  ctx.db.authConfig.id.update({ ...auth(ctx), ownerPasscode: passcode, ownerIdentity: undefined });
});

export const releaseOwner = spacetimedb.reducer(ctx => {
  if (!isAdmin(ctx) && !isOwner(ctx)) throw new SenderError('owner or admin only');
  ctx.db.authConfig.id.update({ ...auth(ctx), ownerIdentity: undefined });
});

export const resetDemo = spacetimedb.reducer(ctx => {
  if (!isOwner(ctx) && !isWorker(ctx) && !isAdmin(ctx)) throw new SenderError('owner or worker only');
  const keepWorker = getSettings(ctx).workerOnline;
  wipe(ctx);
  seed(ctx);
  reapplyOwnerSetup(ctx);
  const s = getSettings(ctx);
  ctx.db.settings.id.update({ ...s, workerOnline: keepWorker });
  rescheduleAll(ctx);
});

// ------------------------------------------------------------- budget (the Purser's gatekeeper)

/**
 * Core rule. For each provider in the task type's fallback chain (skipping excluded ones):
 *   cost = inputTokens * priceIn + maxOutputTokens * priceOut   (worst case)
 *   ok if balance - reserved - cost >= threshold
 *     and (spendUnlocked or weekSpent + weekReserved + cost <= weekLimit)
 * Autonomous: first ok provider wins (a skipped first choice is logged as a switch).
 * Manual: if the first choice fails, the task waits for the owner to switch or upgrade.
 * Nothing ok: autonomous halts for the week; chat tasks become "blocked" so the worker
 * can answer from the database without an LLM call.
 */
export const reserveBudget = spacetimedb.reducer(
  { taskId: t.u64(), inputTokens: t.u64(), maxOutputTokens: t.u64() },
  (ctx, { taskId, inputTokens, maxOutputTokens }) => {
    requireWorker(ctx);
    const tk = getTask(ctx, taskId);
    if (tk.status !== 'queued') throw new SenderError(`task is ${tk.status}, not queued`);
    const s = getSettings(ctx);
    const b = getBudget(ctx);
    const autonomous = s.mode === 'autonomous';
    const chain = ctx.db.fallbackChain.taskType.find(tk.taskType) ?? ctx.db.fallbackChain.taskType.find('general');
    const ids = (chain?.providerIds ?? []).filter(id => !tk.excludedProviderIds.includes(id));

    const block = (status: string, reason: string) => {
      ctx.db.task.id.update({ ...tk, status, blockReason: reason, inputTokens, maxOutputTokens, updatedAt: ctx.timestamp });
    };

    if (autonomous && b.autonomousHalted && tk.taskType !== 'chat') {
      block('blocked', 'Autonomous work is paused for the rest of the week');
      return;
    }

    let firstFailure: { id: bigint; name: string; why: string } | null = null;
    for (const pid of ids) {
      const p = ctx.db.provider.id.find(pid);
      if (!p) continue;
      const cost = costFor(p, inputTokens, maxOutputTokens);
      let why = '';
      if (p.status === 'stopped' && p.statusReason.startsWith('external:')) why = p.statusReason.slice(9);
      else if (p.balanceMicros < p.reservedMicros + cost || p.balanceMicros - p.reservedMicros - cost < p.thresholdMicros)
        why = `would go below its ${usd(p.thresholdMicros)} limit`;
      if (!why && b.spendLocked && b.spentMicros + b.reservedMicros + cost > b.limitMicros) {
        // weekly limit is global: no provider can pass it
        firstFailure = firstFailure ?? { id: p.id, name: p.name, why: 'weekly budget reached' };
        break;
      }
      if (why) {
        firstFailure = firstFailure ?? { id: p.id, name: p.name, why };
        if (!autonomous) break; // manual: ask before switching
        continue;
      }
      // ---- success
      if (firstFailure) {
        log(ctx, tk.runId, tk.employeeId, 'switch', `${firstFailure.name} ${firstFailure.why}. Switched to ${p.name} (${p.model})`);
        ctx.db.spendEvent.insert({ id: 0n, taskId, providerId: p.id, estMicros: cost, actualMicros: 0n, kind: 'switch', at: ctx.timestamp });
        notify(ctx, 'info', `Switched from ${firstFailure.name} to ${p.name}`, `${firstFailure.name} ${firstFailure.why}. Your crew kept working on ${p.name}. Switch or upgrade anytime on My Finances.`, taskId, firstFailure.id);
      }
      ctx.db.provider.id.update({ ...p, reservedMicros: p.reservedMicros + cost, usesThisWeek: p.usesThisWeek + 1, lastUsedAt: ctx.timestamp });
      ctx.db.budget.id.update({ ...b, reservedMicros: b.reservedMicros + cost });
      ctx.db.task.id.update({
        ...tk,
        status: 'reserved',
        providerId: p.id,
        inputTokens,
        maxOutputTokens,
        estMicros: cost,
        reservedMicros: cost,
        blockReason: '',
        updatedAt: ctx.timestamp,
      });
      ctx.db.spendEvent.insert({ id: 0n, taskId, providerId: p.id, estMicros: cost, actualMicros: 0n, kind: 'reserve', at: ctx.timestamp });
      ctx.db.reservationTimer.insert({
        scheduledId: 0n,
        scheduledAt: ScheduleAt.time(now(ctx) + RESERVATION_TIMEOUT),
        taskId,
      });
      refreshProviderStatus(ctx, p.id);
      return;
    }

    // ---- nothing passed
    const weekly = firstFailure?.why === 'weekly budget reached';
    if (!autonomous && firstFailure && !weekly) {
      block('waiting_user', `${firstFailure.name} ${firstFailure.why}`);
      notify(
        ctx,
        'switch_or_upgrade',
        `${firstFailure.name} is out of budget`,
        `"${tk.title}" is waiting. ${firstFailure.name} ${firstFailure.why}. Switch to the next model in your list, or upgrade ${firstFailure.name}.`,
        taskId,
        firstFailure.id
      );
      return;
    }
    const reason = weekly ? 'Weekly budget reached' : 'No provider has budget left';
    block('blocked', reason);
    if (autonomous && !b.autonomousHalted && tk.taskType !== 'chat') {
      ctx.db.budget.id.update({ ...getBudget(ctx), autonomousHalted: true });
      notify(ctx, 'budget_halt', 'Autonomous work paused for the week', `${reason}. Your crew stopped instead of spending more. Raise the budget or unlock spending on My Finances to continue.`, taskId);
      log(ctx, tk.runId, tk.employeeId, 'budget', `${reason}. Autonomous work paused until the weekly reset`);
    } else if (!autonomous) {
      notify(ctx, 'needs_input', reason, `"${tk.title}" can't start. ${reason}.`, taskId);
    }
  }
);

export const commitSpend = spacetimedb.reducer(
  { taskId: t.u64(), inputTokens: t.u64(), outputTokens: t.u64() },
  (ctx, { taskId, inputTokens, outputTokens }) => {
    requireWorker(ctx);
    const tk = getTask(ctx, taskId);
    if (tk.providerId == null) throw new SenderError('task has no provider');
    const p = ctx.db.provider.id.find(tk.providerId);
    if (!p) throw new SenderError('provider missing');
    const actual = costFor(p, inputTokens, outputTokens);
    releaseReservation(ctx, taskId, 'commit');
    const p2 = ctx.db.provider.id.find(p.id)!;
    ctx.db.provider.id.update({ ...p2, balanceMicros: p2.balanceMicros > actual ? p2.balanceMicros - actual : 0n });
    const b = getBudget(ctx);
    ctx.db.budget.id.update({ ...b, spentMicros: b.spentMicros + actual });
    const tk2 = getTask(ctx, taskId);
    ctx.db.task.id.update({ ...tk2, costMicros: tk2.costMicros + actual, updatedAt: ctx.timestamp });
    const r = ctx.db.run.id.find(tk.runId);
    if (r) ctx.db.run.id.update({ ...r, totalMicros: r.totalMicros + actual });
    ctx.db.spendEvent.insert({ id: 0n, taskId, providerId: p.id, estMicros: tk.estMicros, actualMicros: actual, kind: 'commit', at: ctx.timestamp });
    refreshProviderStatus(ctx, p.id);
  }
);

export const markProviderStopped = spacetimedb.reducer(
  { providerId: t.u64(), reason: t.string() },
  (ctx, { providerId, reason }) => {
    requireWorker(ctx);
    const p = ctx.db.provider.id.find(providerId);
    if (!p) throw new SenderError('provider missing');
    ctx.db.provider.id.update({ ...p, status: 'stopped', statusReason: `external:${reason}` });
    log(ctx, 0n, 0n, 'budget', `${p.name} stopped: ${reason}`);
  }
);

export const resolveSwitchOrUpgrade = spacetimedb.reducer(
  { notificationId: t.u64(), choice: t.string() },
  (ctx, { notificationId, choice }) => {
    const n = ctx.db.notification.id.find(notificationId);
    if (!n) throw new SenderError('notification missing');
    if (choice !== 'switch' && choice !== 'upgrade') throw new SenderError('choice must be switch or upgrade');
    if (choice === 'upgrade' && n.providerId != null) upgrade(ctx, n.providerId);
    if (n.taskId != null) {
      const tk = ctx.db.task.id.find(n.taskId);
      if (tk && tk.status === 'waiting_user') {
        const excluded = choice === 'switch' && n.providerId != null ? [...tk.excludedProviderIds, n.providerId] : tk.excludedProviderIds;
        ctx.db.task.id.update({ ...tk, status: 'queued', excludedProviderIds: excluded, blockReason: '', updatedAt: ctx.timestamp });
        log(ctx, tk.runId, tk.employeeId, 'switch', choice === 'switch' ? `You chose to switch models for "${tk.title}"` : `You upgraded. "${tk.title}" is back in the queue`);
      }
    }
    ctx.db.notification.id.update({ ...n, resolved: true });
  }
);

function upgrade(ctx: Ctx, providerId: bigint) {
  const p = ctx.db.provider.id.find(providerId);
  if (!p) return;
  ctx.db.provider.id.update({ ...p, balanceMicros: p.balanceMicros + UPGRADE_MICROS, status: 'healthy', statusReason: '' });
  ctx.db.spendEvent.insert({ id: 0n, taskId: 0n, providerId, estMicros: 0n, actualMicros: UPGRADE_MICROS, kind: 'upgrade', at: ctx.timestamp });
  refreshProviderStatus(ctx, providerId);
  log(ctx, 0n, 0n, 'budget', `Added ${usd(UPGRADE_MICROS)} credit to ${p.name}`);
}

export const upgradeProvider = spacetimedb.reducer({ providerId: t.u64() }, (ctx, { providerId }) => upgrade(ctx, providerId));

export const unlockSpending = spacetimedb.reducer({ confirmPhrase: t.string() }, (ctx, { confirmPhrase }) => {
  if (confirmPhrase !== 'UNLOCK') throw new SenderError('Type UNLOCK to confirm');
  const b = getBudget(ctx);
  ctx.db.budget.id.update({ ...b, spendLocked: false, autonomousHalted: false });
  log(ctx, 0n, 0n, 'budget', 'Spending unlocked until the end of the week');
});

export const lockSpending = spacetimedb.reducer(ctx => {
  ctx.db.budget.id.update({ ...getBudget(ctx), spendLocked: true });
  log(ctx, 0n, 0n, 'budget', 'Spending locked');
});

export const setWeeklyBudget = spacetimedb.reducer({ limitMicros: t.u64() }, (ctx, { limitMicros }) => {
  const b = getBudget(ctx);
  ctx.db.budget.id.update({
    ...b,
    limitMicros,
    autonomousHalted: b.autonomousHalted && b.spentMicros + b.reservedMicros >= limitMicros,
  });
});

export const setThreshold = spacetimedb.reducer({ providerId: t.u64(), thresholdMicros: t.u64() }, (ctx, { providerId, thresholdMicros }) => {
  const p = ctx.db.provider.id.find(providerId);
  if (!p) throw new SenderError('provider missing');
  ctx.db.provider.id.update({ ...p, thresholdMicros });
  refreshProviderStatus(ctx, providerId);
});

export const setFallbackChain = spacetimedb.reducer(
  { taskType: t.string(), providerIds: t.array(t.u64()) },
  (ctx, { taskType, providerIds }) => {
    for (const id of providerIds) if (!ctx.db.provider.id.find(id)) throw new SenderError(`unknown provider ${id}`);
    if (new Set(providerIds.map(String)).size !== providerIds.length) throw new SenderError('duplicate provider');
    const row = { taskType, providerIds };
    if (ctx.db.fallbackChain.taskType.find(taskType)) ctx.db.fallbackChain.taskType.update(row);
    else ctx.db.fallbackChain.insert(row);
  }
);

// MOCK: keys are never stored; this only registers a simulated wallet. Real: encrypted key vault + provider usage API.
export const addProvider = spacetimedb.reducer(
  { name: t.string(), model: t.string(), balanceMicros: t.u64(), priceInPerMTok: t.u64(), priceOutPerMTok: t.u64() },
  (ctx, a) => {
    const p = ctx.db.provider.insert({
      id: 0n,
      name: a.name,
      model: a.model,
      isSimulated: true,
      balanceMicros: a.balanceMicros,
      reservedMicros: 0n,
      thresholdMicros: 0n,
      priceInPerMTok: a.priceInPerMTok,
      priceOutPerMTok: a.priceOutPerMTok,
      status: 'healthy',
      statusReason: '',
      usesThisWeek: 0,
      lastUsedAt: undefined,
    });
    refreshProviderStatus(ctx, p.id);
  }
);

// ------------------------------------------------------------- settings

export const setMode = spacetimedb.reducer({ mode: t.string() }, (ctx, { mode }) => {
  if (mode !== 'autonomous' && mode !== 'manual') throw new SenderError('mode must be autonomous or manual');
  ctx.db.settings.id.update({ ...getSettings(ctx), mode });
  if (mode === 'autonomous') {
    // Resolve every waiting task by switching, the same choice autonomous mode makes on its own.
    for (const n of [...ctx.db.notification.iter()]) {
      if (n.resolved || n.kind !== 'switch_or_upgrade') continue;
      if (n.taskId != null) {
        const tk = ctx.db.task.id.find(n.taskId);
        if (tk && tk.status === 'waiting_user') {
          const excluded = n.providerId != null ? [...tk.excludedProviderIds, n.providerId] : tk.excludedProviderIds;
          ctx.db.task.id.update({ ...tk, status: 'queued', excludedProviderIds: excluded, blockReason: '', updatedAt: ctx.timestamp });
          log(ctx, tk.runId, tk.employeeId, 'switch', `Autonomous mode on: switched models for "${tk.title}"`);
        }
      }
      ctx.db.notification.id.update({ ...n, resolved: true });
    }
    for (const tk of [...ctx.db.task.iter()]) {
      if (tk.status === 'waiting_user') ctx.db.task.id.update({ ...tk, status: 'queued', blockReason: '', updatedAt: ctx.timestamp });
    }
  }
});

export const setCommPrefs = spacetimedb.reducer({ channel: t.string(), frequency: t.string() }, (ctx, { channel, frequency }) => {
  ctx.db.settings.id.update({ ...getSettings(ctx), commChannel: channel, commFrequency: frequency });
});

export const setManagerOptimizes = spacetimedb.reducer({ on: t.bool() }, (ctx, { on }) => {
  ctx.db.settings.id.update({ ...getSettings(ctx), managerOptimizesCadence: on });
});

export const setCadence = spacetimedb.reducer(
  { employeeId: t.u64(), cadence: t.string(), runDay: t.u32(), runHour: t.u32(), timezone: t.string(), utcOffsetMinutes: t.i32() },
  (ctx, a) => {
    const valid = ['on_demand', 'daily', 'weekly', 'monthly', 'quarterly'];
    if (!valid.includes(a.cadence)) throw new SenderError('bad cadence');
    if (a.runHour > 23) throw new SenderError('runHour must be 0-23');
    if (a.cadence === 'weekly' && a.runDay > 6) throw new SenderError('runDay must be 0-6 for weekly');
    if ((a.cadence === 'monthly' || a.cadence === 'quarterly') && (a.runDay < 1 || a.runDay > 28)) throw new SenderError('runDay must be 1-28');
    const e = ctx.db.employee.id.find(a.employeeId);
    if (!e) throw new SenderError('employee missing');
    ctx.db.employee.id.update({ ...e, cadence: a.cadence, runDay: a.runDay, runHour: a.runHour, timezone: a.timezone, utcOffsetMinutes: a.utcOffsetMinutes });
    rescheduleEmployee(ctx, a.employeeId);
  }
);

// ------------------------------------------------------------- work

export const startRun = spacetimedb.reducer({ trigger: t.string() }, (ctx, { trigger }) => {
  const m = activeByRole(ctx, 'manager');
  if (!m) throw new SenderError('no manager');
  if ([...ctx.db.run.iter()].some(r => r.status === 'running' && r.trigger !== 'chat')) throw new SenderError('a run is already in progress');
  const r = createRun(ctx, trigger, m.id, 'Plan this week\'s work on MediClaim', 'Plan the maintenance cycle from the latest audit and research.');
  log(ctx, r.id, m.id, 'plan', `${m.displayName} started a ${trigger === 'manual' ? 'run you requested' : trigger + ' run'}`);
});

export const sendChat = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  const trimmed = text.trim();
  if (!trimmed) throw new SenderError('empty message');
  const tr = activeByRole(ctx, 'translator');
  if (!tr) throw new SenderError('no translator');
  let r = [...ctx.db.run.iter()].find(x => x.trigger === 'chat' && x.status === 'running');
  if (!r) r = ctx.db.run.insert({ id: 0n, trigger: 'chat', status: 'running', summary: 'Chat with the Chatbot', startedAt: ctx.timestamp, endedAt: undefined, totalMicros: 0n });
  const tk = insertTask(ctx, r.id, tr.id, 'chat', 'Answer the owner', trimmed.slice(0, 2000));
  ctx.db.chatMessage.insert({ id: 0n, role: 'user', text: trimmed.slice(0, 2000), directiveJson: '', taskId: tk.id, at: ctx.timestamp });
});

export const createTask = spacetimedb.reducer(
  { runId: t.u64(), employeeId: t.u64(), taskType: t.string(), title: t.string(), input: t.string() },
  (ctx, a) => {
    requireWorker(ctx);
    insertTask(ctx, a.runId, a.employeeId, a.taskType, a.title, a.input);
  }
);

export const claimTask = spacetimedb.reducer({ taskId: t.u64() }, (ctx, { taskId }) => {
  requireWorker(ctx);
  const tk = getTask(ctx, taskId);
  // Only tasks that passed reserveBudget can be worked; blocked chat tasks may be answered from the database.
  const blockedChat = tk.status === 'blocked' && tk.taskType === 'chat';
  if (tk.status !== 'reserved' && !blockedChat) throw new SenderError(`task is ${tk.status}; reserve budget first`);
  ctx.db.task.id.update({ ...tk, status: 'running', updatedAt: ctx.timestamp });
  const e = ctx.db.employee.id.find(tk.employeeId);
  if (e) ctx.db.employee.id.update({ ...e, lastRunAt: ctx.timestamp });
});

export const completeTask = spacetimedb.reducer(
  { taskId: t.u64(), status: t.string(), output: t.string(), branch: t.string(), diff: t.string(), directiveJson: t.string() },
  (ctx, a) => {
    requireWorker(ctx);
    if (!['done', 'rejected', 'failed'].includes(a.status)) throw new SenderError('status must be done, rejected or failed');
    const tk = getTask(ctx, a.taskId);
    if (tk.reservedMicros > 0n) releaseReservation(ctx, tk.id, a.status);
    ctx.db.task.id.update({
      ...getTask(ctx, a.taskId),
      status: a.status,
      output: a.output.slice(0, 20000),
      branch: a.branch,
      diff: a.diff.slice(0, 40000),
      updatedAt: ctx.timestamp,
    });
    if (tk.taskType === 'chat' && tk.title === TEXT_REPLY_TITLE && a.status === 'done') {
      queueText(ctx, 'chat', `Foundation: ${plainText(a.output)}`);
    }
    if (tk.taskType === 'chat') {
      ctx.db.chatMessage.insert({ id: 0n, role: 'translator', text: a.output.slice(0, 4000), directiveJson: a.directiveJson, taskId: tk.id, at: ctx.timestamp });
    }
  }
);

export const logActivity = spacetimedb.reducer(
  { runId: t.u64(), employeeId: t.u64(), kind: t.string(), message: t.string() },
  (ctx, a) => {
    requireWorker(ctx);
    log(ctx, a.runId, a.employeeId, a.kind, a.message.slice(0, 1000));
  }
);

export const finishRun = spacetimedb.reducer({ runId: t.u64(), status: t.string(), summary: t.string() }, (ctx, a) => {
  requireWorker(ctx);
  const r = ctx.db.run.id.find(a.runId);
  if (!r) throw new SenderError('run missing');
  ctx.db.run.id.update({ ...r, status: a.status, summary: a.summary, endedAt: ctx.timestamp });
});

export const writeReport = spacetimedb.reducer(
  { kind: t.string(), authorEmployeeId: t.u64(), title: t.string(), bodyMd: t.string(), period: t.string() },
  (ctx, a) => {
    requireWorker(ctx);
    ctx.db.report.insert({ id: 0n, ...a, bodyMd: a.bodyMd.slice(0, 20000), at: ctx.timestamp });
    if (a.kind === 'weekly_update') {
      const b = getBudget(ctx);
      queueText(ctx, 'update', `Foundation weekly update: ${firstSentences(a.bodyMd.replace(/^Hi [^.]+\.\s*/, ''), 2)} ${usd(b.spentMicros)} of ${usd(b.limitMicros)} used this week.`);
    }
  }
);

export const writeReview = spacetimedb.reducer(
  {
    employeeId: t.u64(),
    period: t.string(),
    score: t.u32(),
    tasksDone: t.u32(),
    rejections: t.u32(),
    failures: t.u32(),
    costPerAcceptedMicros: t.u64(),
    recommendation: t.string(),
    summary: t.string(),
  },
  (ctx, a) => {
    requireWorker(ctx);
    ctx.db.review.insert({ id: 0n, ...a, at: ctx.timestamp });
    const e = ctx.db.employee.id.find(a.employeeId);
    if (e && e.status !== 'fired' && e.role !== 'translator') {
      ctx.db.employee.id.update({ ...e, status: a.recommendation === 'keep' ? 'active' : 'on_review' });
    }
  }
);

export const fireAndReplace = spacetimedb.reducer({ employeeId: t.u64(), reason: t.string() }, (ctx, { employeeId, reason }) => {
  const e = ctx.db.employee.id.find(employeeId);
  if (!e) throw new SenderError('employee missing');
  if (e.role === 'translator') throw new SenderError("The Chatbot can't be fired");
  if (e.status === 'fired') throw new SenderError('already fired');
  ctx.db.employee.id.update({ ...e, status: 'fired', nextRunAt: undefined });
  for (const r of [...ctx.db.cadenceTimer.iter()]) if (r.employeeId === e.id) ctx.db.cadenceTimer.scheduledId.delete(r.scheduledId);
  const base = e.displayName.replace(/ #\d+$/, '');
  const fresh = ctx.db.employee.insert({
    ...e,
    id: 0n,
    displayName: `${base} #${e.generation + 1}`,
    generation: e.generation + 1,
    status: 'active',
    lastRunAt: undefined,
    nextRunAt: undefined,
    promptVersion: e.promptVersion + 1,
    handoffNote: `Replaced ${e.displayName}: ${reason}`.slice(0, 500),
    hiredAt: ctx.timestamp,
  });
  rescheduleEmployee(ctx, fresh.id);
  const m = activeByRole(ctx, 'manager');
  log(ctx, 0n, m?.id ?? 0n, 'fire', `${e.displayName} let go: ${reason}`);
  log(ctx, 0n, fresh.id, 'hire', `${fresh.displayName} hired with a fresh start and a revised brief`);
});

export const dismissNotification = spacetimedb.reducer({ notificationId: t.u64() }, (ctx, { notificationId }) => {
  const n = ctx.db.notification.id.find(notificationId);
  if (!n) throw new SenderError('notification missing');
  if (n.kind === 'switch_or_upgrade' && n.taskId != null) {
    const tk = ctx.db.task.id.find(n.taskId);
    if (tk && tk.status === 'waiting_user') throw new SenderError('Choose Switch or Upgrade first');
  }
  ctx.db.notification.id.update({ ...n, resolved: true });
});

// ------------------------------------------------------------- integrations: Claude Code

// Claude list prices, micro-dollars per 1M tokens: [input, output, cache write (1.25x input), cache read].
// Source: Claude API reference (models table, cached 2026-10-06). Unknown models price as Opus 5.5.
const CLAUDE_PRICES: Array<[prefix: string, p: [bigint, bigint, bigint, bigint]]> = [
  ['claude-fable-5-1', [10_000_000n, 50_000_000n, 12_500_000n, 250_000n]],
  ['claude-mythos-5-1', [10_000_000n, 50_000_000n, 12_500_000n, 250_000n]],
  ['claude-fable-5', [10_000_000n, 50_000_000n, 12_500_000n, 1_000_000n]],
  ['claude-opus-5-5', [4_000_000n, 20_000_000n, 5_000_000n, 200_000n]],
  ['claude-opus-5', [5_000_000n, 25_000_000n, 6_250_000n, 500_000n]],
  ['claude-opus-4', [5_000_000n, 25_000_000n, 6_250_000n, 500_000n]],
  ['claude-sonnet-5-5', [2_000_000n, 10_000_000n, 2_500_000n, 200_000n]],
  ['claude-sonnet-5', [2_000_000n, 10_000_000n, 2_500_000n, 200_000n]],
  ['claude-sonnet-4', [3_000_000n, 15_000_000n, 3_750_000n, 300_000n]],
  ['claude-haiku-5-5', [100_000n, 500_000n, 125_000n, 10_000n]],
  ['claude-haiku-4', [1_000_000n, 5_000_000n, 1_250_000n, 100_000n]],
];
const CLAUDE_CODE = 'Claude Code';
const PREFLIGHT_MIN_MICROS = 50_000n; // a prompt must leave at least $0.05 of room

function claudePrice(model: string) {
  const m = model.toLowerCase();
  for (const [prefix, p] of CLAUDE_PRICES) if (m.startsWith(prefix)) return p;
  return CLAUDE_PRICES[3][1];
}
function claudeCost(model: string, inTok: bigint, outTok: bigint, cwTok: bigint, crTok: bigint) {
  const [pi, po, pw, pr] = claudePrice(model);
  return (inTok * pi + outTok * po + cwTok * pw + crTok * pr + 999_999n) / 1_000_000n;
}
function claudeCodeProvider(ctx: Ctx) {
  const existing = [...ctx.db.provider.iter()].find(p => p.name === CLAUDE_CODE);
  if (existing) return existing;
  // MOCK: the wallet balance is a budget you set for Claude Code. Real: Anthropic Admin API cost report.
  return ctx.db.provider.insert({
    id: 0n, name: CLAUDE_CODE, model: 'claude-opus-5-5', isSimulated: false,
    balanceMicros: 15_000_000n, reservedMicros: 0n, thresholdMicros: 0n,
    priceInPerMTok: 4_000_000n, priceOutPerMTok: 20_000_000n,
    status: 'healthy', statusReason: '', usesThisWeek: 0, lastUsedAt: undefined,
  });
}
function requireIntegration(ctx: Ctx) {
  const a = ctx.db.integrationAuth.identity.find(ctx.sender);
  const i = a ? ctx.db.integration.id.find(a.integrationId) : undefined;
  if (!i) throw new SenderError('This Claude Code is not connected to Foundation. Run the connect command first.');
  return i;
}
/** Same rule as reserveBudget, for a prompt of estimated cost `est` on the Claude Code wallet. */
function claudeCodeGate(ctx: Ctx, est: bigint): string {
  const b = getBudget(ctx);
  const p = claudeCodeProvider(ctx);
  if (p.status === 'stopped' && p.statusReason.startsWith('external:')) return `Claude Code is stopped: ${p.statusReason.slice(9)}`;
  if (p.balanceMicros < p.reservedMicros + est || p.balanceMicros - p.reservedMicros - est < p.thresholdMicros)
    return `the Claude Code wallet would go below its ${usd(p.thresholdMicros)} limit (${usd(p.balanceMicros)} left)`;
  if (b.spendLocked && b.spentMicros + b.reservedMicros + est > b.limitMicros)
    return `the weekly budget is used up (${usd(b.spentMicros)} of ${usd(b.limitMicros)})`;
  return '';
}

/** Claude Code connects with the owner passcode. Re-running is safe. */
export const connectIntegration = spacetimedb.reducer(
  { passcode: t.string(), kind: t.string(), name: t.string() },
  (ctx, { passcode, kind, name }) => {
    const a = auth(ctx);
    if (a.ownerPasscode.length === 0 || passcode !== a.ownerPasscode) throw new SenderError('Wrong owner passcode');
    if (kind !== 'claude_code') throw new SenderError('Only claude_code is supported');
    const label = name.trim().slice(0, 60) || 'Claude Code';
    const link = ctx.db.integrationAuth.identity.find(ctx.sender);
    const prev = link ? ctx.db.integration.id.find(link.integrationId) : undefined;
    if (prev) {
      ctx.db.integration.id.update({ ...prev, name: label, status: 'connected', lastSeenAt: ctx.timestamp });
    } else {
      const i = ctx.db.integration.insert({
        id: 0n, kind, name: label, status: 'connected', connectedAt: ctx.timestamp, lastSeenAt: ctx.timestamp,
        sessionsThisWeek: 0, spentThisWeekMicros: 0n, blockedPrompts: 0,
      });
      if (link) ctx.db.integrationAuth.identity.update({ identity: ctx.sender, integrationId: i.id });
      else ctx.db.integrationAuth.insert({ identity: ctx.sender, integrationId: i.id });
    }
    claudeCodeProvider(ctx);
    log(ctx, 0n, activeByRole(ctx, 'purser')?.id ?? 0n, 'info', `Claude Code connected (${label}). The Purser now tracks and caps its spending`);
  }
);

export const disconnectIntegration = spacetimedb.reducer({ integrationId: t.u64() }, (ctx, { integrationId }) => {
  const i = ctx.db.integration.id.find(integrationId);
  if (!i) throw new SenderError('integration missing');
  ctx.db.integration.id.update({ ...i, status: 'disconnected' });
  for (const a of [...ctx.db.integrationAuth.iter()]) if (a.integrationId === integrationId) ctx.db.integrationAuth.identity.delete(a.identity);
  log(ctx, 0n, 0n, 'info', `${i.name} disconnected from Foundation`);
});

/** Called before every Claude Code prompt. Throws (blocking the prompt) when the budget says stop. */
export const claudeCodePreflight = spacetimedb.reducer({ estMicros: t.u64() }, (ctx, { estMicros }) => {
  const i = requireIntegration(ctx);
  if (i.status !== 'connected') throw new SenderError('Claude Code was disconnected from Foundation');
  const est = estMicros > PREFLIGHT_MIN_MICROS ? estMicros : PREFLIGHT_MIN_MICROS;
  const why = claudeCodeGate(ctx, est);
  if (why) throw new SenderError(`Foundation paused Claude Code: ${why}. Raise the budget or unlock spending in My Finances.`);
  ctx.db.integration.id.update({ ...i, lastSeenAt: ctx.timestamp });
});

/** Records that a prompt was blocked (preflight rolled back, so this is a separate call). */
export const recordBlockedPrompt = spacetimedb.reducer({ reason: t.string() }, (ctx, { reason }) => {
  const i = requireIntegration(ctx);
  ctx.db.integration.id.update({ ...i, blockedPrompts: i.blockedPrompts + 1, lastSeenAt: ctx.timestamp });
  log(ctx, 0n, activeByRole(ctx, 'purser')?.id ?? 0n, 'budget', `Blocked a Claude Code prompt: ${reason.slice(0, 200)}`);
});

/** Claude Code reports cumulative token totals per session; only the increase is charged. */
export const reportExternalUsage = spacetimedb.reducer(
  {
    sessionId: t.string(),
    model: t.string(),
    project: t.string(),
    inputTokens: t.u64(),
    outputTokens: t.u64(),
    cacheWriteTokens: t.u64(),
    cacheReadTokens: t.u64(),
    turns: t.u32(),
  },
  (ctx, a) => {
    const i = requireIntegration(ctx);
    if (a.sessionId.length === 0 || a.sessionId.length > 100) throw new SenderError('bad session id');
    const cost = claudeCost(a.model, a.inputTokens, a.outputTokens, a.cacheWriteTokens, a.cacheReadTokens);
    const prev = ctx.db.externalSession.sessionId.find(a.sessionId);
    if (prev && prev.integrationId !== i.id) throw new SenderError('session belongs to another integration');
    const delta = prev && cost > prev.costMicros ? cost - prev.costMicros : prev ? 0n : cost;
    const row = {
      sessionId: a.sessionId, integrationId: i.id, model: a.model.slice(0, 60), project: a.project.slice(0, 80),
      inputTokens: a.inputTokens, outputTokens: a.outputTokens, cacheWriteTokens: a.cacheWriteTokens,
      cacheReadTokens: a.cacheReadTokens, costMicros: prev && prev.costMicros > cost ? prev.costMicros : cost,
      turns: a.turns, startedAt: prev?.startedAt ?? ctx.timestamp, updatedAt: ctx.timestamp,
    };
    if (prev) ctx.db.externalSession.sessionId.update(row);
    else ctx.db.externalSession.insert(row);

    ctx.db.integration.id.update({
      ...i,
      lastSeenAt: ctx.timestamp,
      sessionsThisWeek: i.sessionsThisWeek + (prev ? 0 : 1),
      spentThisWeekMicros: i.spentThisWeekMicros + delta,
    });
    const purser = activeByRole(ctx, 'purser')?.id ?? 0n;
    if (!prev) log(ctx, 0n, purser, 'info', `Claude Code session started in ${row.project || 'a project'} (${row.model})`);
    if (delta === 0n) return;

    const p = claudeCodeProvider(ctx);
    ctx.db.provider.id.update({
      ...p,
      balanceMicros: p.balanceMicros > delta ? p.balanceMicros - delta : 0n,
      usesThisWeek: p.usesThisWeek + 1,
      lastUsedAt: ctx.timestamp,
    });
    refreshProviderStatus(ctx, p.id);
    const b = getBudget(ctx);
    ctx.db.budget.id.update({ ...b, spentMicros: b.spentMicros + delta });
    ctx.db.spendEvent.insert({ id: 0n, taskId: 0n, providerId: p.id, estMicros: 0n, actualMicros: delta, kind: 'commit', at: ctx.timestamp });
    log(ctx, 0n, purser, 'budget', `Claude Code spent ${usd(delta)} in ${row.project || 'a session'} (session total ${usd(row.costMicros)})`);

    const after = getBudget(ctx);
    if (after.spendLocked && after.spentMicros + after.reservedMicros >= after.limitMicros && !after.autonomousHalted) {
      ctx.db.budget.id.update({ ...after, autonomousHalted: true });
      notify(ctx, 'budget_halt', 'Weekly budget reached', `Claude Code usage brought this week to ${usd(after.spentMicros)} of ${usd(after.limitMicros)}. New Claude Code prompts and autonomous work are paused until you raise the budget or unlock spending.`);
    }
  }
);

// ------------------------------------------------------------- real providers + onboarding

const PROVIDER_KINDS = ['maritime', 'openai_compatible', 'anthropic'];
const WAKE_AFTER_SILENT = 70_000_000n; // the worker heartbeats every 30 s; silent for 70 s means asleep

function requireOwner(ctx: Ctx) {
  if (!isOwner(ctx) && !isAdmin(ctx)) throw new SenderError('Only the owner can do this. Enter the owner passcode first.');
}

function maybeWakeCrew(ctx: Ctx, reason: string) {
  const w = ctx.db.wakeConfig.id.find(0);
  if (!w || !w.url) return;
  if ([...ctx.db.wakeTimer.iter()].length > 0) return; // a wake check is already scheduled
  // Check once the crew would count as silent; the procedure only calls Maritime if work is still waiting.
  const seen = getSettings(ctx).workerLastSeenAt?.microsSinceUnixEpoch ?? 0n;
  const due = seen + WAKE_AFTER_SILENT > now(ctx) ? seen + WAKE_AFTER_SILENT : now(ctx);
  ctx.db.wakeTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(due), reason: reason.slice(0, 120) });
}

/** Scheduled procedure: SpacetimeDB itself wakes the crew's Maritime machine over HTTP. */
export const wakeCrew = spacetimedb.procedure(
  { onSchedule: wakeTimer },
  { timer: wakeTimer.rowType },
  t.unit(),
  (ctx, { timer }) => {
    const check = ctx.withTx(tx => {
      const cfg = tx.db.wakeConfig.id.find(0);
      const seen = tx.db.settings.id.find(0)?.workerLastSeenAt?.microsSinceUnixEpoch ?? 0n;
      const awake = tx.timestamp.microsSinceUnixEpoch - seen < WAKE_AFTER_SILENT - 10_000_000n;
      const waiting = [...tx.db.task.iter()].some(t => t.status === 'queued' || t.status === 'reserved') || [...tx.db.textMessage.iter()].some(m => m.status === 'queued');
      return { cfg, awake, waiting };
    });
    const cfg = check.cfg;
    if (!cfg || !cfg.url || check.awake || !check.waiting) return {}; // crew is up, or nothing to do
    let status = 0;
    try {
      const res = ctx.http.fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Maritime-Webhook-Token': cfg.token },
        body: JSON.stringify({ message: 'foundation:wake', source: 'foundation', reason: timer.reason }),
      });
      status = res.status;
    } catch {
      status = 0;
    }
    // Maritime answers 503 ("could not be woken yet") or 502/504 transiently: retry every 30 s, 4 tries in all.
    const m = /^\[try (\d)\] /.exec(timer.reason);
    const attempt = m ? Number(m[1]) : 1;
    const base = m ? timer.reason.slice(m[0].length) : timer.reason;
    const retry = (status === 0 || status === 429 || status >= 500) && attempt < 4;
    ctx.withTx(tx => {
      tx.db.wakeEvent.insert({ id: 0n, reason: timer.reason, status, at: tx.timestamp });
      if (retry) {
        tx.db.wakeTimer.insert({
          scheduledId: 0n,
          scheduledAt: ScheduleAt.time(tx.timestamp.microsSinceUnixEpoch + 30_000_000n),
          reason: `[try ${attempt + 1}] ${base}`.slice(0, 140),
        });
      }
    });
    return {};
  }
);

export const setWakeHook = spacetimedb.reducer({ url: t.string(), token: t.string() }, (ctx, { url, token }) => {
  if (!isAdmin(ctx)) throw new SenderError('admin only');
  if (url && !url.startsWith('https://')) throw new SenderError('wake URL must be https');
  const row = { id: 0, url, token, lastWakeAt: undefined };
  if (ctx.db.wakeConfig.id.find(0)) ctx.db.wakeConfig.id.update(row);
  else ctx.db.wakeConfig.insert(row);
});

/** Owner adds or updates a real model provider. An empty apiKey keeps the saved key. */
export const configureProvider = spacetimedb.reducer(
  {
    name: t.string(),
    kind: t.string(),
    baseUrl: t.string(),
    model: t.string(),
    apiKey: t.string(),
    creditMicros: t.u64(),
    priceInPerMTok: t.u64(),
    priceOutPerMTok: t.u64(),
  },
  (ctx, a) => {
    requireOwner(ctx);
    const name = a.name.trim().slice(0, 40);
    if (!name) throw new SenderError('Name the provider');
    if (name === 'Claude Code') throw new SenderError('Claude Code is connected from Settings → Integrations');
    if (!PROVIDER_KINDS.includes(a.kind)) throw new SenderError('Unknown provider kind');
    const model = a.model.trim().slice(0, 100);
    if (!model) throw new SenderError('Pick a model');
    const baseUrl = a.baseUrl.trim();
    if (a.kind === 'openai_compatible' && !baseUrl.startsWith('https://')) throw new SenderError('Base URL must start with https://');
    const key = a.apiKey.trim();
    const prevSecret = ctx.db.providerSecret.name.find(name);
    if (a.kind !== 'maritime' && !key && !prevSecret) throw new SenderError(`Paste the API key for ${name}`);
    if (key) {
      if (key.length > 400) throw new SenderError('That key is too long');
      if (prevSecret) ctx.db.providerSecret.name.update({ name, apiKey: key });
      else ctx.db.providerSecret.insert({ name, apiKey: key });
    }
    const prev = ctx.db.providerConfig.name.find(name);
    const row = {
      name,
      kind: a.kind,
      baseUrl,
      model,
      creditMicros: a.creditMicros,
      priceInPerMTok: a.priceInPerMTok,
      priceOutPerMTok: a.priceOutPerMTok,
      hasKey: Boolean(key || prevSecret),
      keyLast4: key ? key.slice(-4) : prev?.keyLast4 ?? '',
      updatedAt: ctx.timestamp,
    };
    if (prev) ctx.db.providerConfig.name.update(row);
    else ctx.db.providerConfig.insert(row);
    applyProviderConfig(ctx, name);
    log(ctx, 0n, activeByRole(ctx, 'purser')?.id ?? 0n, 'budget', `${name} is now a real provider (${model}) with a ${usd(a.creditMicros)} allowance`);
  }
);

export const removeProviderKey = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  requireOwner(ctx);
  if (ctx.db.providerSecret.name.find(name)) ctx.db.providerSecret.name.delete(name);
  if (ctx.db.providerConfig.name.find(name)) ctx.db.providerConfig.name.delete(name);
  const p = providerByName(ctx, name);
  if (!p) return;
  if (SEEDED_PROVIDERS.includes(name)) {
    // MOCK: back to a simulated wallet. Real: the provider simply has no key.
    ctx.db.provider.id.update({ ...p, isSimulated: name !== 'Maritime' && name !== 'Claude Code' });
  } else {
    for (const c of [...ctx.db.fallbackChain.iter()]) {
      if (c.providerIds.includes(p.id)) ctx.db.fallbackChain.taskType.update({ ...c, providerIds: c.providerIds.filter(id => id !== p.id) });
    }
    ctx.db.provider.id.delete(p.id);
  }
  log(ctx, 0n, 0n, 'budget', `Removed the ${name} key`);
});

export const completeOnboarding = spacetimedb.reducer(
  {
    appName: t.string(),
    appDescription: t.string(),
    stack: t.string(),
    repoUrl: t.string(),
    priorities: t.array(t.string()),
    mode: t.string(),
    weeklyBudgetMicros: t.u64(),
    crewDay: t.u32(),
    crewHour: t.u32(),
    timezone: t.string(),
    utcOffsetMinutes: t.i32(),
    chains: t.array(ChainChoice),
    startFirstRun: t.bool(),
  },
  (ctx, a) => {
    requireOwner(ctx);
    if (a.mode !== 'autonomous' && a.mode !== 'manual') throw new SenderError('mode must be autonomous or manual');
    if (a.crewDay > 6 || a.crewHour > 23) throw new SenderError('Pick a valid day and hour');
    const row = {
      id: 0,
      completed: true,
      completedAt: ctx.timestamp,
      appName: a.appName.trim().slice(0, 60) || 'My app',
      appDescription: a.appDescription.trim().slice(0, 500),
      stack: a.stack.trim().slice(0, 300),
      repoUrl: a.repoUrl.trim().slice(0, 300),
      priorities: a.priorities.slice(0, 10).map(p => p.slice(0, 60)),
      chains: a.chains,
    };
    if (ctx.db.onboarding.id.find(0)) ctx.db.onboarding.id.update(row);
    else ctx.db.onboarding.insert(row);
    const repoNow = ctx.db.repo.id.find(0);
    const connectNow = row.repoUrl && REPO_URL.test(row.repoUrl.replace(/\/$/, '')) && (!repoNow || repoNow.url !== row.repoUrl.replace(/\/$/, ''));

    const proj = [...ctx.db.project.iter()][0];
    if (proj) ctx.db.project.id.update({ ...proj, name: row.appName, repoPath: row.repoUrl || proj.repoPath, stackSummary: row.stack || proj.stackSummary });
    ctx.db.settings.id.update({ ...getSettings(ctx), mode: a.mode });
    if (a.weeklyBudgetMicros > 0n) ctx.db.budget.id.update({ ...getBudget(ctx), limitMicros: a.weeklyBudgetMicros });
    for (const e of [...ctx.db.employee.iter()]) {
      if (e.status === 'fired' || e.cadence !== 'weekly') continue;
      ctx.db.employee.id.update({ ...e, runDay: a.crewDay, runHour: a.crewHour, timezone: a.timezone, utcOffsetMinutes: a.utcOffsetMinutes });
      rescheduleEmployee(ctx, e.id);
    }
    applyChains(ctx, a.chains);
    const m = activeByRole(ctx, 'manager');
    log(ctx, 0n, m?.id ?? 0n, 'plan', `Onboarding complete. The crew is set up for ${row.appName}`);
    if (connectNow) connectRepoInner(ctx, row.repoUrl);
    if (a.startFirstRun && m && ![...ctx.db.run.iter()].some(r => r.status === 'running' && r.trigger !== 'chat')) {
      const r = createRun(ctx, 'manual', m.id, `First maintenance run on ${row.appName}`, `Priorities: ${row.priorities.join(', ')}`);
      log(ctx, r.id, m.id, 'plan', `${m.displayName} started the first run on ${row.appName}`);
    }
  }
);

const WorkerSecretRow = t.object('WorkerSecretRow', { name: t.string(), apiKey: t.string() });

/** Only the registered worker sees API keys; every other caller gets an empty list. */
export const workerSecret = spacetimedb.view({ name: 'worker_secret', public: true }, t.array(WorkerSecretRow), ctx => {
  const a = ctx.db.authConfig.id.find(0);
  if (!a || !a.workerIdentity || !a.workerIdentity.isEqual(ctx.sender)) return [];
  return [...ctx.db.providerSecret.iter()].map(s => ({ name: s.name, apiKey: s.apiKey }));
});

// ------------------------------------------------------------- the owner's codebase

const REPO_URL = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?(\.git)?\/?$/;

function connectRepoInner(ctx: Ctx, rawUrl: string) {
  const url = rawUrl.trim().replace(/\/$/, '');
  if (!REPO_URL.test(url)) throw new SenderError('Paste a public GitHub, GitLab or Bitbucket URL, like https://github.com/you/app');
  const name = url.replace(/\.git$/, '').split('/').pop() ?? 'app';
  const row = {
    id: 0, url, name, status: 'queued', message: 'Waiting for the Auditor', commitSha: '', fileCount: 0,
    languages: '', findings: 0, healthScore: 0, auditMd: '', scannedAt: undefined, updatedAt: ctx.timestamp,
  };
  if (ctx.db.repo.id.find(0)) ctx.db.repo.id.update(row);
  else ctx.db.repo.insert(row);
  const proj = [...ctx.db.project.iter()][0];
  if (proj) ctx.db.project.id.update({ ...proj, name, repoPath: url, stackSummary: 'The Auditor is reading your code' });
  const auditor = activeByRole(ctx, 'auditor');
  if (!auditor) throw new SenderError('No Auditor on the crew');
  const r = createRun(ctx, 'manual', auditor.id, `Clone and audit ${name}`, JSON.stringify({ repoUrl: url }));
  log(ctx, r.id, auditor.id, 'plan', `${auditor.displayName} is cloning ${name} to map how it works`);
}

export const connectRepo = spacetimedb.reducer({ url: t.string() }, (ctx, { url }) => {
  requireOwner(ctx);
  connectRepoInner(ctx, url);
});

export const disconnectRepo = spacetimedb.reducer(ctx => {
  requireOwner(ctx);
  if (ctx.db.repo.id.find(0)) ctx.db.repo.id.delete(0);
  log(ctx, 0n, 0n, 'info', 'Disconnected your repo. The crew is back on the MediClaim demo');
});

export const updateRepo = spacetimedb.reducer(
  {
    status: t.string(),
    message: t.string(),
    commitSha: t.string(),
    fileCount: t.u32(),
    languages: t.string(),
    findings: t.u32(),
    healthScore: t.u32(),
    auditMd: t.string(),
  },
  (ctx, a) => {
    requireWorker(ctx);
    const r = ctx.db.repo.id.find(0);
    if (!r) throw new SenderError('no repo connected');
    const ready = a.status === 'ready';
    ctx.db.repo.id.update({
      ...r,
      status: a.status,
      message: a.message.slice(0, 300),
      commitSha: a.commitSha || r.commitSha,
      fileCount: a.fileCount || r.fileCount,
      languages: a.languages || r.languages,
      findings: ready ? a.findings : r.findings,
      healthScore: ready ? a.healthScore : r.healthScore,
      auditMd: a.auditMd ? a.auditMd.slice(0, 20000) : r.auditMd,
      scannedAt: ready ? ctx.timestamp : r.scannedAt,
      updatedAt: ctx.timestamp,
    });
    if (ready) {
      queueText(ctx, 'audit', `Foundation: the Auditor finished reading ${r.name}. ${a.findings} risks found, health ${a.healthScore}/100. Reply FIX to have your crew start on the top two.`);
      const proj = [...ctx.db.project.iter()][0];
      if (proj) ctx.db.project.id.update({ ...proj, name: r.name, repoPath: r.url, stackSummary: a.languages || proj.stackSummary, healthScore: a.healthScore, lastAuditAt: ctx.timestamp });
    }
  }
);

// ------------------------------------------------------------- texts to the owner's phone (Photon)

const TEXT_MAX = 600;

function plainText(md: string): string {
  return md
    .replace(/[*_`#>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentences(s: string, n: number): string {
  return plainText(s).split(/(?<=[.!?])\s/).slice(0, n).join(' ');
}

/** Queues a text for the crew to send through Photon. No-op unless texting is set up. */
function queueText(ctx: Ctx, kind: string, body: string) {
  const m = ctx.db.messaging.id.find(0);
  if (!m || !m.enabled) return;
  ctx.db.textMessage.insert({
    id: 0n, direction: 'out', kind, body: body.slice(0, TEXT_MAX), status: 'queued', error: '', createdAt: ctx.timestamp, sentAt: undefined,
  });
  maybeWakeCrew(ctx, 'Send a text');
}

function textForNotification(ctx: Ctx, kind: string, title: string, body: string) {
  if (kind === 'switch_or_upgrade') queueText(ctx, 'switch', `Foundation: ${title}. ${firstSentences(body, 1)} Reply 1 to switch models, 2 to add $20.`);
  else if (kind === 'budget_halt') queueText(ctx, 'halt', `Foundation: ${title}. Your crew stopped instead of spending more. Reply UNLOCK to keep going this week.`);
  else if (kind === 'info' && title.startsWith('Switched from')) queueText(ctx, 'switch', `Foundation: ${title}. Your crew kept working. No action needed.`);
}

export const configureMessaging = spacetimedb.reducer(
  { address: t.string(), token: t.string(), server: t.string(), phone: t.string() },
  (ctx, a) => {
    requireOwner(ctx);
    const address = a.address.trim();
    const phone = a.phone.replace(/[^0-9+]/g, '');
    if (!address) throw new SenderError('Paste your Photon project ID');
    if (!/^\+?[0-9]{7,15}$/.test(phone)) throw new SenderError('Enter your phone number with country code, like +1 214 555 0142');
    const prev = ctx.db.messagingSecret.id.find(0);
    const token = a.token.trim() || prev?.token || '';
    if (!token) throw new SenderError('Paste your Photon project secret');
    // A random webhook secret, made with the reducer's deterministic RNG.
    const secret = prev?.webhookSecret || [...ctx.random.fill(new Uint8Array(18))].map(b => b.toString(16).padStart(2, '0')).join('');
    const secretRow = { id: 0, token, phone: phone.startsWith('+') ? phone : `+${phone}`, webhookSecret: secret };
    if (prev) ctx.db.messagingSecret.id.update(secretRow);
    else ctx.db.messagingSecret.insert(secretRow);
    const row = {
      id: 0, provider: 'photon', address, server: a.server.trim(), hasToken: true, phoneLast4: phone.slice(-4), enabled: true,
      lastSentAt: ctx.db.messaging.id.find(0)?.lastSentAt, lastInboundAt: ctx.db.messaging.id.find(0)?.lastInboundAt, lastError: '', updatedAt: ctx.timestamp,
    };
    if (ctx.db.messaging.id.find(0)) ctx.db.messaging.id.update(row);
    else ctx.db.messaging.insert(row);
    ctx.db.settings.id.update({ ...getSettings(ctx), commChannel: 'sms' });
    log(ctx, 0n, activeByRole(ctx, 'communicator')?.id ?? 0n, 'info', `Texts are on. The Communicator will text the number ending ${phone.slice(-4)}`);
  }
);

export const disableMessaging = spacetimedb.reducer(ctx => {
  requireOwner(ctx);
  const m = ctx.db.messaging.id.find(0);
  if (m) ctx.db.messaging.id.update({ ...m, enabled: false, updatedAt: ctx.timestamp });
});

export const sendTestText = spacetimedb.reducer(ctx => {
  requireOwner(ctx);
  const m = ctx.db.messaging.id.find(0);
  if (!m || !m.enabled) throw new SenderError('Set up texts first');
  queueText(ctx, 'test', "Foundation: this is a test. You'll get your crew's updates here. Reply 1 or 2 to answer switch-or-upgrade questions, UNLOCK to keep going after a budget stop, FIX to start repairs, or ask anything.");
});

export const markTextSent = spacetimedb.reducer({ id: t.u64(), ok: t.bool(), error: t.string() }, (ctx, { id, ok, error }) => {
  requireWorker(ctx);
  const msg = ctx.db.textMessage.id.find(id);
  if (!msg) return;
  ctx.db.textMessage.id.update({ ...msg, status: ok ? 'sent' : 'failed', error: error.slice(0, 300), sentAt: ok ? ctx.timestamp : undefined });
  const m = ctx.db.messaging.id.find(0);
  if (m) ctx.db.messaging.id.update({ ...m, lastSentAt: ok ? ctx.timestamp : m.lastSentAt, lastError: ok ? '' : error.slice(0, 300) });
});

const WorkerTextRow = t.object('WorkerTextRow', { token: t.string(), phone: t.string() });
/** Only the registered worker gets the Photon token and phone number. */
export const workerMessaging = spacetimedb.view({ name: 'worker_messaging', public: true }, t.array(WorkerTextRow), ctx => {
  const a = ctx.db.authConfig.id.find(0);
  if (!a || !a.workerIdentity || !a.workerIdentity.isEqual(ctx.sender)) return [];
  const s = ctx.db.messagingSecret.id.find(0);
  return s ? [{ token: s.token, phone: s.phone }] : [];
});

const OwnerWebhookRow = t.object('OwnerWebhookRow', { secret: t.string() });
/** Only the owner (or admin) sees the webhook secret, to paste the URL into Photon. */
export const ownerWebhook = spacetimedb.view({ name: 'owner_webhook', public: true }, t.array(OwnerWebhookRow), ctx => {
  const a = ctx.db.authConfig.id.find(0);
  const allowed = a && (a.adminIdentity.isEqual(ctx.sender) || (a.ownerIdentity != null && a.ownerIdentity.isEqual(ctx.sender)));
  const s = ctx.db.messagingSecret.id.find(0);
  return allowed && s ? [{ secret: s.webhookSecret }] : [];
});

const digits = (s: string) => s.replace(/[^0-9]/g, '');

/** A text from the owner: 1 / 2 / UNLOCK / FIX act right away; anything else goes to the Chatbot. */
function handleInboundText(ctx: Ctx, text: string): string {
  const body = text.trim();
  ctx.db.textMessage.insert({ id: 0n, direction: 'in', kind: 'command', body: body.slice(0, TEXT_MAX), status: 'received', error: '', createdAt: ctx.timestamp, sentAt: undefined });
  const m = ctx.db.messaging.id.find(0);
  if (m) ctx.db.messaging.id.update({ ...m, lastInboundAt: ctx.timestamp });
  const word = body.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pending = [...ctx.db.notification.iter()].filter(n => !n.resolved && n.kind === 'switch_or_upgrade').sort((x, y) => (x.id < y.id ? 1 : -1))[0];
  try {
    if ((word === '1' || word === '2') && pending) {
      const choice = word === '1' ? 'switch' : 'upgrade';
      if (choice === 'upgrade' && pending.providerId != null) upgrade(ctx, pending.providerId);
      if (pending.taskId != null) {
        const tk = ctx.db.task.id.find(pending.taskId);
        if (tk && tk.status === 'waiting_user') {
          const excluded = choice === 'switch' && pending.providerId != null ? [...tk.excludedProviderIds, pending.providerId] : tk.excludedProviderIds;
          ctx.db.task.id.update({ ...tk, status: 'queued', excludedProviderIds: excluded, blockReason: '', updatedAt: ctx.timestamp });
        }
      }
      ctx.db.notification.id.update({ ...pending, resolved: true });
      queueText(ctx, 'reply', choice === 'switch' ? 'Foundation: switched. Your crew is back to work.' : 'Foundation: added $20 of credit. Your crew is back to work.');
      return 'ok';
    }
    if (word === 'UNLOCK') {
      const b = getBudget(ctx);
      ctx.db.budget.id.update({ ...b, spendLocked: false, autonomousHalted: false });
      log(ctx, 0n, 0n, 'budget', 'Spending unlocked by text until the end of the week');
      queueText(ctx, 'reply', 'Foundation: spending unlocked until the end of the week. Your crew will keep going.');
      return 'ok';
    }
    if (word === 'FIX' || word === 'RUN') {
      const mgr = activeByRole(ctx, 'manager');
      if (mgr && ![...ctx.db.run.iter()].some(r => r.status === 'running' && r.trigger !== 'chat')) {
        const r = createRun(ctx, 'manual', mgr.id, 'Plan fixes requested by text', 'The owner texted FIX.');
        log(ctx, r.id, mgr.id, 'plan', `${mgr.displayName} started a run you requested by text`);
        queueText(ctx, 'reply', 'Foundation: on it. Your crew is planning fixes now. I will text you when it is done.');
      } else {
        queueText(ctx, 'reply', 'Foundation: your crew is already working. I will text you when it is done.');
      }
      return 'ok';
    }
  } catch (e) {
    queueText(ctx, 'reply', `Foundation: I couldn't do that: ${String((e as Error).message ?? e).slice(0, 160)}`);
    return 'ok';
  }
  // Anything else: ask the Chatbot, which texts the answer back.
  const tr = activeByRole(ctx, 'translator');
  if (!tr) return 'ok';
  let r = [...ctx.db.run.iter()].find(x => x.trigger === 'chat' && x.status === 'running');
  if (!r) r = ctx.db.run.insert({ id: 0n, trigger: 'chat', status: 'running', summary: 'Chat with the Chatbot', startedAt: ctx.timestamp, endedAt: undefined, totalMicros: 0n });
  const tk = insertTask(ctx, r.id, tr.id, 'chat', TEXT_REPLY_TITLE, body.slice(0, 2000));
  ctx.db.chatMessage.insert({ id: 0n, role: 'user', text: `(by text) ${body.slice(0, 2000)}`, directiveJson: '', taskId: tk.id, at: ctx.timestamp });
  return 'ok';
}

const TEXT_REPLY_TITLE = 'Answer the owner by text';

/** Photon webhook: POST https://<maincloud>/.../photon?secret=... with a message.received event. */
export const photonWebhook = spacetimedb.httpHandler((ctx, req) => {
  let secret = '';
  try {
    secret = new URL(req.url).searchParams.get('secret') ?? '';
  } catch {
    secret = /[?&]secret=([^&]+)/.exec(req.url)?.[1] ?? '';
  }
  let ev: any;
  try {
    ev = req.json();
  } catch {
    return new SyncResponse('bad json', { status: 400 });
  }
  const result = ctx.withTx(tx => {
    const s = tx.db.messagingSecret.id.find(0);
    if (!s || !secret || secret !== s.webhookSecret) return 'unauthorized';
    const events: any[] = Array.isArray(ev?.events) ? ev.events : [ev];
    for (const e of events) {
      // Spectrum's native webhook sends { message: { sender, space, content, direction } };
      // the lower-level iMessage events send { type: 'message.received', message: {...} }.
      if (e?.type && e.type !== 'message.received' && !String(e.type).startsWith('message')) continue;
      const msg = e.message ?? {};
      if (msg.isFromMe || e.isFromMe || msg.direction === 'outbound' || msg.direction === 'out') continue;
      if (msg.content?.type && msg.content.type !== 'text') continue;
      const from = String(msg.sender?.address ?? msg.sender?.id ?? e.actor?.address ?? e.from ?? '');
      const text = String(msg.content?.text ?? msg.content?.value ?? msg.text ?? e.text ?? '');
      if (!text.trim()) continue;
      // Only the owner's own phone can control the crew.
      if (digits(from).slice(-10) !== digits(s.phone).slice(-10)) continue;
      handleInboundText(tx, text);
    }
    return 'ok';
  });
  return new SyncResponse(result, { status: result === 'unauthorized' ? 401 : 200 });
});

export const httpHealth = spacetimedb.httpHandler(() => new SyncResponse('ok', { status: 200 }));
export const routes = spacetimedb.httpRouter(new Router().post('/photon', photonWebhook).get('/health', httpHealth));
