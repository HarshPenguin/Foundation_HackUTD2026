import { schema, table, t } from 'spacetimedb/server';

// Money is stored as micro-dollars (u64, 1 USD = 1_000_000) everywhere. No floats for money.

// Private: identities and the worker pairing code. Never public.
export const authConfig = table(
  { name: 'auth_config' },
  {
    id: t.u32().primaryKey(),
    adminIdentity: t.identity(),
    workerIdentity: t.option(t.identity()),
    ownerIdentity: t.option(t.identity()),
    pairingCode: t.string(),
    ownerPasscode: t.string().default(''), // set by the admin; empty = owner sign-in disabled
  }
);

// Public mirror of who is connected in which role (no secrets).
export const settings = table(
  { name: 'settings', public: true },
  {
    id: t.u32().primaryKey(),
    ownerName: t.string(),
    mode: t.string(), // autonomous | manual
    commChannel: t.string(), // email | in_app | sms
    commFrequency: t.string(), // daily | weekly | monthly
    managerOptimizesCadence: t.bool(),
    workerOnline: t.bool(),
    workerLastSeenAt: t.option(t.timestamp()),
  }
);

export const project = table(
  { name: 'project', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    repoPath: t.string(),
    stackSummary: t.string(),
    healthScore: t.u32(),
    lastAuditAt: t.option(t.timestamp()),
  }
);

export const employee = table(
  { name: 'employee', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    role: t.string(),
    displayName: t.string(),
    generation: t.u32(),
    status: t.string(), // active | on_review | fired
    cadence: t.string(), // on_demand | daily | weekly | monthly | quarterly
    runDay: t.u32(), // weekly: 0=Sun..6=Sat. monthly/quarterly: day of month 1..28
    runHour: t.u32(), // 0..23 local
    timezone: t.string(), // IANA name, display only
    utcOffsetMinutes: t.i32(), // used for schedule math
    lastRunAt: t.option(t.timestamp()),
    nextRunAt: t.option(t.timestamp()),
    promptVersion: t.u32(),
    handoffNote: t.string(),
    hiredAt: t.timestamp(),
  }
);

export const provider = table(
  { name: 'provider', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    model: t.string(),
    isSimulated: t.bool(),
    balanceMicros: t.u64(),
    reservedMicros: t.u64(),
    thresholdMicros: t.u64(),
    priceInPerMTok: t.u64(), // micros per 1M input tokens
    priceOutPerMTok: t.u64(), // micros per 1M output tokens
    status: t.string(), // healthy | low | stopped
    statusReason: t.string(),
    usesThisWeek: t.u32(),
    lastUsedAt: t.option(t.timestamp()),
  }
);

export const fallbackChain = table(
  { name: 'fallback_chain', public: true },
  {
    taskType: t.string().primaryKey(), // research | code | review | marketing | chat | general
    providerIds: t.array(t.u64()),
  }
);

export const budget = table(
  { name: 'budget', public: true },
  {
    id: t.u32().primaryKey(),
    weekStart: t.timestamp(),
    limitMicros: t.u64(),
    spentMicros: t.u64(),
    reservedMicros: t.u64(),
    spendLocked: t.bool(),
    autonomousHalted: t.bool(),
    savedBySwitchingMicros: t.u64(),
  }
);

export const spendEvent = table(
  { name: 'spend_event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    taskId: t.u64(),
    providerId: t.u64(),
    estMicros: t.u64(),
    actualMicros: t.u64(),
    kind: t.string(), // reserve | commit | release | switch | upgrade
    at: t.timestamp(),
  }
);

export const run = table(
  { name: 'run', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    trigger: t.string(), // schedule | manual | chat
    status: t.string(), // running | done | halted
    summary: t.string(),
    startedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
    totalMicros: t.u64(),
  }
);

export const task = table(
  { name: 'task', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    runId: t.u64().index('btree'),
    employeeId: t.u64(),
    taskType: t.string(),
    // queued | reserved | running | waiting_user | blocked | done | rejected | failed
    status: t.string(),
    title: t.string(),
    input: t.string(),
    output: t.string(),
    branch: t.string(),
    diff: t.string(),
    providerId: t.option(t.u64()),
    inputTokens: t.u64(),
    maxOutputTokens: t.u64(),
    estMicros: t.u64(),
    reservedMicros: t.u64(),
    costMicros: t.u64(),
    excludedProviderIds: t.array(t.u64()),
    blockReason: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

export const activity = table(
  { name: 'activity', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    runId: t.u64().index('btree'),
    employeeId: t.u64(),
    kind: t.string(), // plan | work | review | switch | hire | fire | budget | info
    message: t.string(),
    at: t.timestamp(),
  }
);

export const notification = table(
  { name: 'notification', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string(), // needs_input | switch_or_upgrade | budget_halt | info
    title: t.string(),
    body: t.string(),
    taskId: t.option(t.u64()),
    providerId: t.option(t.u64()),
    resolved: t.bool(),
    createdAt: t.timestamp(),
  }
);

export const chatMessage = table(
  { name: 'chat_message', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    role: t.string(), // user | translator
    text: t.string(),
    directiveJson: t.string(),
    taskId: t.option(t.u64()),
    at: t.timestamp(),
  }
);

export const report = table(
  { name: 'report', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    // weekly_update | performance_review | marketing_strategy | audit | research | insights | update_plan
    kind: t.string(),
    authorEmployeeId: t.u64(),
    title: t.string(),
    bodyMd: t.string(),
    period: t.string(),
    at: t.timestamp(),
  }
);

export const review = table(
  { name: 'review', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    employeeId: t.u64(),
    period: t.string(),
    score: t.u32(),
    tasksDone: t.u32(),
    rejections: t.u32(),
    failures: t.u32(),
    costPerAcceptedMicros: t.u64(),
    recommendation: t.string(), // keep | coach | replace
    summary: t.string(),
    at: t.timestamp(),
  }
);

export const cadenceTimer = table(
  { name: 'cadence_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    employeeId: t.u64(),
  }
);

export const weekRolloverTimer = table(
  { name: 'week_rollover_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

export const reservationTimer = table(
  { name: 'reservation_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    taskId: t.u64(),
  }
);

const spacetimedb = schema({
  authConfig,
  settings,
  project,
  employee,
  provider,
  fallbackChain,
  budget,
  spendEvent,
  run,
  task,
  activity,
  notification,
  chatMessage,
  report,
  review,
  cadenceTimer,
  weekRolloverTimer,
  reservationTimer,
});
export default spacetimedb;
