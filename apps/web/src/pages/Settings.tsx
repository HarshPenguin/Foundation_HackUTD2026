import { useState } from 'react';
import { GitPullRequest as Github, Cloud, Database, Boxes, Terminal, ShieldCheck, RotateCcw, Check, Sparkles } from 'lucide-react';
import { useDb } from '@/lib/stdb';
import { useCall, useToast } from '@/lib/actions';
import { activeEmployees, ROLE_ORDER } from '@/lib/domain';
import { CADENCE_LABEL, cadenceLabel, toMicros, whenLabel, tsDate } from '@/lib/format';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, MockTag, NativeSelect, Switch } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PageHeader, RoleAvatar } from '@/components/shared';
import { BudgetCalculator } from '@/components/BudgetCalculator';
import { SpendingLockCard, WeeklyBudgetCard } from './Finances';
import { DeliveryPrefs } from './Communications';
import type { Employee } from '@/module_bindings/types';

const SECTIONS = [
  ['account', 'Account'],
  ['defaults', 'Defaults'],
  ['cadences', 'Cadences'],
  ['calculator', 'Budget calculator'],
  ['communications', 'Communications'],
  ['integrations', 'Integrations'],
  ['demo', 'Demo data'],
] as const;

function Section({ id, title, description, children, badge }: { id: string; title: string; description?: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {badge}
      </div>
      {description && <p className="-mt-2 mb-3 text-sm text-muted">{description}</p>}
      {children}
    </section>
  );
}

function Account() {
  // MOCK: fake login form. Real: Supabase Auth (email/password or OAuth) mapped to the SpacetimeDB owner identity.
  const db = useDb();
  const toast = useToast();
  const [user, setUser] = useState((db.settings?.ownerName ?? 'owner').toLowerCase());
  const [pw, setPw] = useState('');
  return (
    <Card>
      <CardContent className="grid gap-6 pt-5 md:grid-cols-[1fr_260px]">
        <form
          className="grid gap-3"
          onSubmit={e => {
            e.preventDefault();
            setPw('');
            toast('ok', `Signed in as ${user} (demo)`);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="acct-user">Username</Label>
            <Input id="acct-user" autoComplete="username" value={user} onChange={e => setUser(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="acct-pw">Password</Label>
            <Input id="acct-pw" type="password" autoComplete="current-password" placeholder="••••••••" value={pw} onChange={e => setPw(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit">Sign in</Button>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <ShieldCheck className="size-4 text-emerald-600" /> Secured with Supabase Auth
            </span>
          </div>
        </form>
        <div className="rounded-xl border border-line bg-navy-50/50 p-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-full bg-amber-100 font-semibold text-amber-700">{(db.settings?.ownerName ?? 'Y').charAt(0)}</div>
            <div>
              <div className="font-medium text-ink">{db.settings?.ownerName}</div>
              <div className="text-xs text-muted">Owner of {db.project?.name ?? 'this project'}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted">In this demo, the first browser to connect becomes the owner.</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Defaults() {
  const db = useDb();
  const call = useCall();
  const [threshold, setThreshold] = useState('0.00');
  const mode = db.settings?.mode ?? 'autonomous';
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Mode</CardTitle>
            <CardDescription>What your crew does when a provider runs out.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2">
          {[
            { k: 'autonomous', t: 'Autonomous (recommended)', d: 'Switches to the next model in the chain and keeps working.' },
            { k: 'manual', t: 'Manual', d: 'Pauses and asks you to switch or upgrade.' },
          ].map(o => (
            <label key={o.k} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:bg-navy-50/50 has-[:checked]:border-navy-300 has-[:checked]:bg-navy-50">
              <input
                type="radio"
                name="mode"
                className="mt-1 accent-[#1c2b47]"
                checked={mode === o.k}
                onChange={() => void call(r => r.setMode({ mode: o.k }), `Mode set to ${o.k}`)}
              />
              <div>
                <div className="text-sm font-medium text-ink">{o.t}</div>
                <div className="text-xs text-muted">{o.d}</div>
              </div>
            </label>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Default threshold</CardTitle>
            <CardDescription>Apply one stop-at amount to every provider. The default is $0.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className="relative w-32">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <Input className="pl-6" inputMode="decimal" value={threshold} onChange={e => setThreshold(e.target.value)} aria-label="Default threshold" />
            </div>
            <Button
              variant="outline"
              onClick={async () => {
                const m = toMicros(parseFloat(threshold));
                for (const p of db.providers) await call(r => r.setThreshold({ providerId: p.id, thresholdMicros: m }));
                await call(async () => undefined, `Threshold applied to ${db.providers.length} providers`);
              }}
            >
              Apply to all providers
            </Button>
          </div>
        </CardContent>
      </Card>
      <WeeklyBudgetCard />
      <SpendingLockCard />
    </div>
  );
}

function CadenceRow({ e }: { e: Employee }) {
  const call = useCall();
  const change = (cadence: string) => {
    let runDay = e.runDay;
    if (cadence === 'weekly' && runDay > 6) runDay = 3;
    if ((cadence === 'monthly' || cadence === 'quarterly') && (runDay < 1 || runDay > 28)) runDay = 1;
    void call(
      r =>
        r.setCadence({
          employeeId: e.id,
          cadence,
          runDay,
          runHour: e.runHour,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          utcOffsetMinutes: -new Date().getTimezoneOffset(),
        }),
      `${e.displayName}: ${CADENCE_LABEL[cadence].toLowerCase()}`
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line py-2.5 last:border-0">
      <RoleAvatar role={e.role} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{e.displayName}</div>
        <div className="text-xs text-muted">
          {cadenceLabel(e.cadence, e.runDay, e.runHour)}
          {e.cadence !== 'on_demand' && ` · next ${whenLabel(tsDate(e.nextRunAt))}`}
        </div>
      </div>
      <NativeSelect className="h-8 text-[13px]" value={e.cadence} onChange={ev => change(ev.target.value)} aria-label={`Cadence for ${e.displayName}`}>
        {Object.entries(CADENCE_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function Cadences() {
  const db = useDb();
  const call = useCall();
  const crew = [...activeEmployees(db)].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const on = db.settings?.managerOptimizesCadence ?? true;
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-navy-100 bg-navy-50/60 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <Sparkles className="mt-0.5 size-4 text-amber-500" />
            <div>
              <div className="text-sm font-medium text-ink">Let the Manager optimize</div>
              <div className="text-xs text-muted">The Manager tunes each schedule to fit your weekly budget.</div>
            </div>
          </div>
          <Switch checked={on} onCheckedChange={v => void call(r => r.setManagerOptimizes({ on: v }), v ? 'The Manager will optimize cadences' : 'Cadences are fully manual')} aria-label="Let the Manager optimize" />
        </div>
        {crew.map(e => (
          <CadenceRow key={e.id.toString()} e={e} />
        ))}
      </CardContent>
    </Card>
  );
}

const INTEGRATIONS = [
  { k: 'github', name: 'GitHub', d: 'Open real branches and pull requests', icon: Github },
  { k: 'base44', name: 'Base44', d: 'Maintain apps you built on Base44', icon: Boxes },
  { k: 'claude', name: 'Claude Code', d: 'Hand large refactors to Claude Code', icon: Terminal },
  { k: 'aws', name: 'AWS Budgets', d: 'Mirror your cloud budget alerts', icon: Cloud },
  { k: 'supabase', name: 'Supabase', d: 'Sign-in and your app database', icon: Database },
];

function Integrations() {
  // MOCK: Connect buttons only flip local state. Real: OAuth per integration (GitHub App, Supabase, AWS IAM role).
  const toast = useToast();
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {INTEGRATIONS.map(i => (
        <Card key={i.k} className="flex items-center gap-3 p-4">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy-700">
            <i.icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">{i.name}</div>
            <div className="truncate text-xs text-muted">{i.d}</div>
          </div>
          {connected[i.k] ? (
            <Badge tone="ok">
              <Check className="size-3" /> Connected
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setConnected(c => ({ ...c, [i.k]: true }));
                toast('ok', `${i.name} connected (demo)`);
              }}
            >
              Connect
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}

function ResetDemo() {
  const call = useCall();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
        <div>
          <div className="text-sm font-medium text-ink">Reset demo data</div>
          <div className="text-xs text-muted">Restores the seeded crew, wallets, reports and budget. Takes a second.</div>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <RotateCcw /> Reset demo data
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Reset the demo?</DialogTitle>
            <DialogDescription>Every run, chat, hire and setting goes back to the starting point.</DialogDescription>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const ok = await call(r => r.resetDemo({}), 'Demo data restored');
                  setBusy(false);
                  if (ok) setOpen(false);
                }}
              >
                Reset
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Account, defaults, schedules and integrations." />
      <div className="grid gap-8 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <ul className="sticky top-20 flex flex-col gap-0.5">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-navy-50 hover:text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-10">
          <Section id="account" title="Account" badge={<MockTag>Demo sign-in</MockTag>}>
            <Account />
          </Section>
          <Section id="defaults" title="Defaults">
            <Defaults />
          </Section>
          <Section id="cadences" title="Cadences" description="How often each employee works. Changes take effect right away.">
            <Cadences />
          </Section>
          <Section id="calculator" title="Budget calculator">
            <BudgetCalculator />
          </Section>
          <Section id="communications" title="Communications" description="How the Communicator reaches you.">
            <Card className="p-4">
              <DeliveryPrefs />
            </Card>
          </Section>
          <Section id="integrations" title="Integrations" badge={<MockTag>Demo</MockTag>}>
            <Integrations />
          </Section>
          <Section id="demo" title="Demo data">
            <ResetDemo />
          </Section>
        </div>
      </div>
    </div>
  );
}
