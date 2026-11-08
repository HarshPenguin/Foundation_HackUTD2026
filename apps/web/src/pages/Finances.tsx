import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeftRight,
  ArrowUpCircle,
  Calculator,
  ChartColumn,
  KeyRound,
  Lightbulb,
  Lock,
  LockOpen,
  Plus,
  ShieldCheck,
  Workflow,
  TrendingDown,
} from 'lucide-react';
import { useDb } from '@/lib/stdb';
import { useCall } from '@/lib/actions';
import { available, latestReport, weeklyProjection } from '@/lib/domain';
import { ago, clockTime, shortDate, toDollars, toMicros, tsDate, usd } from '@/lib/format';
import { useProviderActions } from '@/lib/providerActions';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Meter,
  MockTag,
  Stat,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { EmployeeChip, Markdown, PageHeader, ProviderStatus } from '@/components/shared';
import { BudgetCalculator } from '@/components/BudgetCalculator';
import { FallbackChains } from '@/components/FallbackChains';
import { CLAUDE_CODE_PROVIDER, ClaudeCodeFinanceCard } from '@/components/ClaudeCode';
import type { Provider } from '@/module_bindings/types';
import { cn } from '@/lib/utils';

const TABS = ['overview', 'wallets', 'limits', 'chains', 'calculator', 'insights'] as const;

function BudgetMeterCard() {
  const db = useDb();
  const b = db.budget;
  if (!b) return null;
  const spent = Number(b.spentMicros);
  const reserved = Number(b.reservedMicros);
  const limit = Number(b.limitMicros);
  const left = Math.max(0, limit - spent - reserved);
  const pct = limit ? Math.round(((spent + reserved) / limit) * 100) : 0;
  const projection = weeklyProjection(db);
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div>
          <CardTitle>Weekly budget</CardTitle>
          <CardDescription>Week of {shortDate(tsDate(b.weekStart))}. Resets every 7 days.</CardDescription>
        </div>
        {b.autonomousHalted ? (
          <Badge tone="stop">Autonomous work stopped</Badge>
        ) : b.spendLocked ? (
          <Badge tone="neutral">
            <Lock className="size-3" /> Spending lock on
          </Badge>
        ) : (
          <Badge tone="warn">
            <LockOpen className="size-3" /> Unlocked this week
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tracking-tight tabular-nums text-ink">{usd(spent + reserved)}</span>
          <span className="text-muted">of {usd(limit)}</span>
          <span className="ml-auto text-sm font-medium tabular-nums text-muted">{pct}%</span>
        </div>
        <Meter
          className="mt-4 h-4"
          max={limit}
          segments={[
            { value: spent, className: 'bg-navy-700', label: `Spent ${usd(spent)}` },
            { value: reserved, className: 'bg-amber-400', label: `Reserved ${usd(reserved)}` },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-navy-700" /> Spent {usd(spent)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-400" /> Reserved for running tasks {usd(reserved)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-navy-100" /> Left {usd(left)}
          </span>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-3">
          <Stat label="Projected next week" value={`$${projection.toFixed(2)}`} hint="From your crew's schedule" />
          <Stat label="Saved by switching" value={usd(b.savedBySwitchingMicros)} hint="Cheaper models, same work" />
          <Stat label="Left this week" value={usd(left)} hint={b.spendLocked ? 'Hard stop at the limit' : 'Lock is off'} />
        </div>
      </CardContent>
    </Card>
  );
}

function SpendFeed() {
  const db = useDb();
  const events = [...db.spendEvents].reverse().slice(0, 8);
  const label: Record<string, string> = { reserve: 'Reserved', commit: 'Charged', release: 'Released', switch: 'Switched to', upgrade: 'Upgraded' };
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Live spending</CardTitle>
          <CardDescription>Every reservation and charge, as it happens.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted">No spending yet this week. Click Run now on My Developers to watch this move.</div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {events.map(e => {
              const p = db.providers.find(x => x.id === e.providerId);
              const amount = e.kind === 'commit' || e.kind === 'upgrade' ? e.actualMicros : e.estMicros;
              return (
                <li key={e.id.toString()} className="animate-fade-up flex items-center gap-3 text-sm">
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      e.kind === 'commit' ? 'bg-navy-700' : e.kind === 'switch' ? 'bg-amber-500' : e.kind === 'upgrade' ? 'bg-emerald-500' : 'bg-amber-300'
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {label[e.kind] ?? e.kind} {p?.name ?? 'provider'}
                  </span>
                  <span className="tabular-nums text-muted">{usd(amount, amount < 10_000n ? 4 : 2)}</span>
                  <span className="w-20 text-right text-xs text-muted">{clockTime(tsDate(e.at))}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function UsageCard() {
  const db = useDb();
  const max = Math.max(1, ...db.providers.map(p => p.usesThisWeek));
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Calls this week</CardTitle>
          <CardDescription>How often each provider did work.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {db.providers.map(p => (
          <div key={p.id.toString()}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-ink">{p.name}</span>
              <span className="tabular-nums text-muted">{p.usesThisWeek}</span>
            </div>
            <Meter className="h-2" max={max} segments={[{ value: p.usesThisWeek, className: p.status === 'stopped' ? 'bg-red-400' : 'bg-navy-500' }]} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProviderCard({ p }: { p: Provider }) {
  const { switchAway, upgrade, noticesFor } = useProviderActions();
  const [busy, setBusy] = useState(false);
  const avail = available(p);
  const ref = Math.max(Number(p.balanceMicros), Number(p.thresholdMicros) + 5_000_000);
  const pending = noticesFor(p.id).length > 0;
  const wrap = (f: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  const gaugeTone = p.status === 'stopped' ? 'bg-red-500' : p.status === 'low' ? 'bg-amber-400' : 'bg-navy-700';
  return (
    <Card className={cn('flex flex-col', pending && 'ring-2 ring-amber-300', p.status === 'stopped' && 'border-red-200')}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="truncate">{p.name}</CardTitle>
          {p.name === CLAUDE_CODE_PROVIDER && !p.isSimulated ? (
            <div className="mt-0.5 text-xs text-muted">Your Claude Code sessions</div>
          ) : (
            <div className="mt-0.5 font-mono text-xs text-muted">{p.model}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <ProviderStatus provider={p} />
          {p.isSimulated ? (
            <Badge tone="outline">Simulated</Badge>
          ) : p.name === CLAUDE_CODE_PROVIDER ? (
            <Badge tone="navy">Claude Code</Badge>
          ) : (
            <Badge tone="navy">Real API</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums text-ink">{usd(avail)}</span>
          <span className="text-xs text-muted">available</span>
        </div>
        <Meter
          className="mt-2"
          max={ref}
          marker={Number(p.thresholdMicros)}
          segments={[
            { value: Number(avail), className: gaugeTone, label: 'Available' },
            { value: Number(p.reservedMicros), className: 'bg-amber-300', label: 'Reserved' },
          ]}
        />
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-muted">Balance</dt>
          <dd className="text-right tabular-nums text-ink">{usd(p.balanceMicros)}</dd>
          <dt className="text-muted">Reserved</dt>
          <dd className="text-right tabular-nums text-ink">{usd(p.reservedMicros)}</dd>
          <dt className="text-muted">Stop at (threshold)</dt>
          <dd className="text-right tabular-nums text-ink">{usd(p.thresholdMicros)}</dd>
          <dt className="text-muted">Price per 1M tokens</dt>
          <dd className="text-right tabular-nums text-ink">
            {usd(p.priceInPerMTok)} in · {usd(p.priceOutPerMTok)} out
          </dd>
          <dt className="text-muted">Last used</dt>
          <dd className="text-right text-ink">{ago(tsDate(p.lastUsedAt))}</dd>
        </dl>
        {p.statusReason && <div className={cn('mt-3 rounded-lg px-2.5 py-1.5 text-xs', p.status === 'stopped' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800')}>{p.statusReason.replace(/^external:/, '')}</div>}
        <div className="mt-auto pt-4">
          {pending && <div className="mb-2 text-xs font-medium text-amber-700">Your crew is waiting on this choice</div>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={wrap(() => switchAway(p.id))} title="Use the next model in your fallback chains instead">
              <ArrowLeftRight /> Switch
            </Button>
            <Button variant="accent" size="sm" disabled={busy} onClick={wrap(() => upgrade(p.id))} title="Add $20 of credit">
              <ArrowUpCircle /> Upgrade
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AddKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const call = useCall();
  const [name, setName] = useState('Anthropic');
  const [model, setModel] = useState('claude-sonnet-4.5');
  const [key, setKey] = useState('');
  const [balance, setBalance] = useState('10');
  const [pin, setPin] = useState('3');
  const [pout, setPout] = useState('15');
  const submit = async () => {
    // MOCK: the key never leaves this form; only a simulated wallet is registered. Real: send to an encrypted key vault and read balance from the provider's usage API.
    const ok = await call(
      r =>
        r.addProvider({
          name: name.trim(),
          model: model.trim(),
          balanceMicros: toMicros(parseFloat(balance)),
          priceInPerMTok: toMicros(parseFloat(pin)),
          priceOutPerMTok: toMicros(parseFloat(pout)),
        }),
      `${name.trim()} added. Drag it into a fallback chain to use it`
    );
    if (ok) {
      setKey('');
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Add API key</DialogTitle>
        <DialogDescription>Connect another provider so your crew has somewhere to switch to.</DialogDescription>
        <div className="mt-5 grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pv-name">Provider</Label>
              <Input id="pv-name" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pv-model">Model</Label>
              <Input id="pv-model" value={model} onChange={e => setModel(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pv-key">API key</Label>
            <Input id="pv-key" type="password" autoComplete="off" placeholder="sk-..." value={key} onChange={e => setKey(e.target.value)} />
            <div className="flex items-center gap-2 text-xs text-muted">
              <MockTag>Demo</MockTag> The key stays in your browser. This demo registers a simulated wallet.
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pv-bal">Balance ($)</Label>
              <Input id="pv-bal" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pv-in">$ per 1M in</Label>
              <Input id="pv-in" inputMode="decimal" value={pin} onChange={e => setPin(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pv-out">$ per 1M out</Label>
              <Input id="pv-out" inputMode="decimal" value={pout} onChange={e => setPout(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || !model.trim()}>
            Add provider
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Wallets() {
  const db = useDb();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Available = balance − reserved. A provider stops before it would go below its threshold.
        </p>
        <Button onClick={() => setOpen(true)}>
          <Plus /> Add API key
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {db.providers.map(p => (
          <ProviderCard key={p.id.toString()} p={p} />
        ))}
      </div>
      <AddKeyDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function MoneyInput({ id, value, onChange, className }: { id: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
      <Input id={id} inputMode="decimal" className="pl-6 tabular-nums" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function ThresholdRow({ p }: { p: Provider }) {
  const call = useCall();
  const [v, setV] = useState(toDollars(p.thresholdMicros).toFixed(2));
  useEffect(() => setV(toDollars(p.thresholdMicros).toFixed(2)), [p.thresholdMicros]);
  const dirty = toMicros(parseFloat(v)) !== p.thresholdMicros;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{p.name}</div>
        <div className="text-xs text-muted">Available {usd(available(p))}</div>
      </div>
      <ProviderStatus provider={p} />
      <MoneyInput id={`th-${p.id}`} className="w-28" value={v} onChange={setV} />
      <Button
        size="sm"
        variant={dirty ? 'default' : 'outline'}
        disabled={!dirty}
        onClick={() => void call(r => r.setThreshold({ providerId: p.id, thresholdMicros: toMicros(parseFloat(v)) }), `${p.name} threshold saved`)}
      >
        Save
      </Button>
    </div>
  );
}

export function SpendingLockCard() {
  const db = useDb();
  const call = useCall();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const b = db.budget;
  if (!b) return null;
  const doUnlock = async () => {
    const ok = await call(r => r.unlockSpending({ confirmPhrase: phrase }), 'Spending unlocked until the end of the week');
    if (ok) {
      setOpen(false);
      setPhrase('');
    }
  };
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            {b.spendLocked ? <Lock className="size-4 text-navy-600" /> : <LockOpen className="size-4 text-amber-600" />} Spending lock
          </CardTitle>
          <CardDescription>
            {b.spendLocked
              ? `On. Your crew can never spend more than ${usd(b.limitMicros)} in a week. When the budget is used, autonomous work stops until the weekly reset.`
              : 'Off for the rest of this week. Your crew can go past the weekly budget. It locks again at the weekly reset.'}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {b.autonomousHalted && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">Autonomous work is stopped for the week. Raise the budget or unlock to continue.</div>
        )}
        {b.spendLocked ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            <LockOpen /> Unlock spending
          </Button>
        ) : (
          <Button onClick={() => void call(r => r.lockSpending({}), 'Spending locked')}>
            <Lock /> Lock spending
          </Button>
        )}
        <Dialog
          open={open}
          onOpenChange={v => {
            setOpen(v);
            if (!v) setPhrase('');
          }}
        >
          <DialogContent>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              Unlocking lets your crew spend past your {usd(b.limitMicros)} weekly budget until the weekly reset. Provider thresholds still apply.
            </DialogDescription>
            <div className="mt-5 grid gap-1.5">
              <Label htmlFor="unlock-phrase">
                Type <span className="font-mono font-semibold">UNLOCK</span> to confirm
              </Label>
              <Input
                id="unlock-phrase"
                autoFocus
                autoComplete="off"
                value={phrase}
                onChange={e => setPhrase(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && phrase === 'UNLOCK' && void doUnlock()}
                placeholder="UNLOCK"
                className="font-mono"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Keep it locked
              </Button>
              <Button variant="accent" disabled={phrase !== 'UNLOCK'} onClick={doUnlock}>
                Unlock for this week
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export function WeeklyBudgetCard() {
  const db = useDb();
  const call = useCall();
  const limit = db.budget?.limitMicros ?? 0n;
  const [v, setV] = useState(toDollars(limit).toFixed(2));
  useEffect(() => setV(toDollars(limit).toFixed(2)), [limit]);
  const dirty = toMicros(parseFloat(v)) !== limit;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Weekly budget</CardTitle>
          <CardDescription>The most your whole crew may spend in one week.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <MoneyInput id="weekly-budget" className="w-36" value={v} onChange={setV} />
          <Button disabled={!dirty || !(parseFloat(v) > 0)} onClick={() => void call(r => r.setWeeklyBudget({ limitMicros: toMicros(parseFloat(v)) }), 'Weekly budget saved')}>
            Save
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[5, 10, 25, 50].map(n => (
            <button key={n} onClick={() => setV(n.toFixed(2))} className="rounded-full border border-line px-3 py-1 text-xs text-navy-700 hover:bg-navy-50">
              ${n}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Limits() {
  const db = useDb();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <SpendingLockCard />
        <WeeklyBudgetCard />
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Thresholds</CardTitle>
            <CardDescription>A provider stops before its balance would drop below this. The default is $0.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          {db.providers.map(p => (
            <ThresholdRow key={p.id.toString()} p={p} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Insights() {
  const db = useDb();
  const r = latestReport(db, 'insights');
  if (!r) return <EmptyState icon={<Lightbulb />} title="No insights yet" body="The Purser writes spending insights after each week." />;
  const author = db.employees.find(e => e.id === r.authorEmployeeId);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{r.title}</CardTitle>
          <CardDescription>
            {shortDate(tsDate(r.at))} · {r.period}
          </CardDescription>
        </div>
        <EmployeeChip employee={author} />
      </CardHeader>
      <CardContent>
        <Markdown>{r.bodyMd}</Markdown>
      </CardContent>
    </Card>
  );
}

export default function FinancesPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as string) : 'overview';
  return (
    <div>
      <PageHeader title="My Finances" description="Every API key, every dollar, and the rules that keep your crew inside its budget." />
      <Tabs value={tab} onValueChange={v => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="overview">
            <ChartColumn /> Overview
          </TabsTrigger>
          <TabsTrigger value="wallets">
            <KeyRound /> API keys and wallets
          </TabsTrigger>
          <TabsTrigger value="limits">
            <ShieldCheck /> Limits and lock
          </TabsTrigger>
          <TabsTrigger value="chains">
            <Workflow /> Fallback chains
          </TabsTrigger>
          <TabsTrigger value="calculator">
            <Calculator /> Budget calculator
          </TabsTrigger>
          <TabsTrigger value="insights">
            <TrendingDown /> Insights
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <BudgetMeterCard />
            <UsageCard />
          </div>
          <div className="mt-4">
            <ClaudeCodeFinanceCard />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <SpendFeed />
            <Insights />
          </div>
        </TabsContent>
        <TabsContent value="wallets">
          <Wallets />
        </TabsContent>
        <TabsContent value="limits">
          <Limits />
        </TabsContent>
        <TabsContent value="chains">
          <p className="mb-4 text-sm text-muted">
            Drag to reorder. When a provider hits its threshold, the Purser moves to the next one in the list.
          </p>
          <FallbackChains />
        </TabsContent>
        <TabsContent value="calculator">
          <BudgetCalculator />
        </TabsContent>
        <TabsContent value="insights">
          <Insights />
        </TabsContent>
      </Tabs>
    </div>
  );
}
