import type { InferSchema, ReducerCtx } from 'spacetimedb/server';
import type spacetimedb from './schema';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

export const SEEDED_PROVIDERS = ['Maritime', 'Gemini', 'OpenAI', 'NVIDIA Nemotron', 'Claude Code'];

export function providerByName(ctx: Ctx, name: string) {
  return [...ctx.db.provider.iter()].find(p => p.name === name);
}

/** Makes the provider row match its saved config: real (not simulated), model, prices, allowance. */
export function applyProviderConfig(ctx: Ctx, name: string) {
  const cfg = ctx.db.providerConfig.name.find(name);
  if (!cfg) return;
  const existing = providerByName(ctx, name);
  const fields = {
    name,
    model: cfg.model,
    isSimulated: false,
    balanceMicros: cfg.creditMicros,
    thresholdMicros: existing?.thresholdMicros ?? 0n,
    priceInPerMTok: cfg.priceInPerMTok,
    priceOutPerMTok: cfg.priceOutPerMTok,
    status: cfg.creditMicros > 0n ? 'healthy' : 'stopped',
    statusReason: cfg.creditMicros > 0n ? '' : 'No credit assigned',
  };
  if (existing) {
    ctx.db.provider.id.update({ ...existing, ...fields });
  } else {
    ctx.db.provider.insert({ id: 0n, ...fields, reservedMicros: 0n, usesThisWeek: 0, lastUsedAt: undefined });
  }
}

export function applyChains(ctx: Ctx, chains: Array<{ taskType: string; providerNames: string[] }>) {
  for (const c of chains) {
    const ids: bigint[] = [];
    for (const n of c.providerNames) {
      const p = providerByName(ctx, n);
      if (p && !ids.includes(p.id)) ids.push(p.id);
    }
    if (ids.length === 0) continue;
    const row = { taskType: c.taskType, providerIds: ids };
    if (ctx.db.fallbackChain.taskType.find(c.taskType)) ctx.db.fallbackChain.taskType.update(row);
    else ctx.db.fallbackChain.insert(row);
  }
}

/** After a demo reset: re-apply the owner's real providers, chains and app details. */
export function reapplyOwnerSetup(ctx: Ctx) {
  for (const cfg of [...ctx.db.providerConfig.iter()]) applyProviderConfig(ctx, cfg.name);
  const r = ctx.db.repo.id.find(0);
  const proj0 = [...ctx.db.project.iter()][0];
  if (r && r.status === 'ready' && proj0) {
    ctx.db.project.id.update({ ...proj0, name: r.name, repoPath: r.url, stackSummary: r.languages, healthScore: r.healthScore });
    if (r.auditMd) {
      const auditor = [...ctx.db.employee.iter()].find(e => e.role === 'auditor' && e.status !== 'fired');
      ctx.db.report.insert({ id: 0n, kind: 'audit', authorEmployeeId: auditor?.id ?? 0n, title: `How ${r.name} works`, bodyMd: r.auditMd, period: 'on connect', at: ctx.timestamp });
    }
  }
  const ob = ctx.db.onboarding.id.find(0);
  if (!ob || !ob.completed) return;
  applyChains(ctx, ob.chains);
  const proj = [...ctx.db.project.iter()][0];
  if (proj && ob.appName && !(r && r.status === 'ready')) {
    ctx.db.project.id.update({ ...proj, name: ob.appName, stackSummary: ob.stack || proj.stackSummary });
  }
}
