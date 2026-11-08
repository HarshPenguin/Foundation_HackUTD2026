import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, GitBranch, Hand, Loader2, Play, ScanSearch, History as HistoryIcon } from 'lucide-react';
import { useDb } from '@/lib/stdb';
import { useCall } from '@/lib/actions';
import { activeEmployees, byRole, currentRun, latestReport, providerFor, ROLE_BLURB, ROLE_ORDER, taskTypeForRole } from '@/lib/domain';
import { ago, cadenceLabel, shortDate, tsDate, usd, whenLabel, sentence } from '@/lib/format';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { EmployeeChip, EmployeeStatus, Markdown, PageHeader, RoleAvatar } from '@/components/shared';
import { CrewEvents, LivePanel } from '@/components/LivePanel';
import { DiffDialog, EmployeeDrawer } from '@/components/EmployeeDrawer';
import { RepoCard } from '@/components/RepoCard';
import type { Employee, Task } from '@/module_bindings/types';
import { cn } from '@/lib/utils';

function ModeToggle() {
  const db = useDb();
  const call = useCall();
  const mode = db.settings?.mode ?? 'autonomous';
  const set = (m: string) => {
    if (m === mode) return;
    void call(r => r.setMode({ mode: m }), m === 'autonomous' ? 'Autonomous: your crew switches models on its own' : 'Manual: your crew will ask before switching');
  };
  return (
    <div className="inline-flex rounded-xl border border-line bg-white p-1" role="radiogroup" aria-label="Mode">
      {[
        { k: 'autonomous', label: 'Autonomous', icon: Bot },
        { k: 'manual', label: 'Manual', icon: Hand },
      ].map(o => (
        <button
          key={o.k}
          role="radio"
          aria-checked={mode === o.k}
          onClick={() => set(o.k)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            mode === o.k ? 'bg-navy-800 text-white shadow-sm' : 'text-muted hover:text-ink'
          )}
        >
          <o.icon className="size-4" /> {o.label}
        </button>
      ))}
    </div>
  );
}

function RunNow() {
  const db = useDb();
  const call = useCall();
  const running = !!currentRun(db);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="accent"
      disabled={running || busy}
      onClick={async () => {
        setBusy(true);
        await call(r => r.startRun({ trigger: 'manual' }), 'Run started. The Manager is planning');
        setBusy(false);
      }}
    >
      {running ? <Loader2 className="animate-spin" /> : <Play />}
      {running ? 'Running' : 'Run now'}
    </Button>
  );
}

function EmployeeCard({ e, onOpen, featured }: { e: Employee; onOpen: () => void; featured?: boolean }) {
  const db = useDb();
  const provider = providerFor(db, taskTypeForRole(e.role));
  const run = currentRun(db);
  const working = run && db.tasks.some(t => t.runId === run.id && t.employeeId === e.id && (t.status === 'running' || t.status === 'reserved'));
  return (
    <button
      onClick={onOpen}
      className={cn(
        'group w-full rounded-2xl border bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-md',
        featured ? 'border-navy-200' : 'border-line',
        e.status === 'on_review' && 'border-amber-300 bg-amber-50/40',
        working && 'ring-2 ring-amber-300'
      )}
    >
      <div className="flex items-start gap-3">
        <RoleAvatar role={e.role} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-ink">{e.displayName}</div>
            {e.generation > 1 && <span className="text-[11px] text-muted">Gen {e.generation}</span>}
          </div>
          <div className="truncate text-xs text-muted" title={ROLE_BLURB[e.role]}>
            {e.displayName.toLowerCase().startsWith(e.role) || e.role === 'translator' ? ROLE_BLURB[e.role] ?? sentence(e.role) : sentence(e.role)}
          </div>
        </div>
        {working ? <Badge tone="warn">Working</Badge> : <EmployeeStatus status={e.status} />}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Model</dt>
        <dd className="truncate text-right font-mono text-[11.5px] text-ink">{provider?.model ?? 'none'}</dd>
        <dt className="text-muted">Cadence</dt>
        <dd className="truncate text-right text-ink">{cadenceLabel(e.cadence, e.runDay, e.runHour)}</dd>
        <dt className="text-muted">Next run</dt>
        <dd className="truncate text-right text-ink">{e.cadence === 'on_demand' ? 'When you ask' : whenLabel(tsDate(e.nextRunAt))}</dd>
        <dt className="text-muted">Last run</dt>
        <dd className="truncate text-right text-ink">{ago(tsDate(e.lastRunAt))}</dd>
      </dl>
    </button>
  );
}

function Connector({ className }: { className?: string }) {
  return <div className={cn('mx-auto h-6 w-px bg-navy-200', className)} />;
}

function OrgChart({ onOpen }: { onOpen: (id: bigint) => void }) {
  const db = useDb();
  const crew = activeEmployees(db);
  const translator = byRole(db, 'translator');
  const manager = byRole(db, 'manager');
  const rest = crew
    .filter(e => e.role !== 'translator' && e.role !== 'manager')
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || Number(a.id - b.id));
  return (
    <div>
      <div className="mx-auto max-w-xs">{translator && <EmployeeCard e={translator} featured onOpen={() => onOpen(translator.id)} />}</div>
      <Connector />
      <div className="mx-auto max-w-xs">{manager && <EmployeeCard e={manager} featured onOpen={() => onOpen(manager.id)} />}</div>
      <Connector />
      <div className="relative rounded-3xl border border-dashed border-navy-200 bg-navy-50/40 p-3 sm:p-4">
        <div className="mb-3 px-1 text-xs font-medium text-muted">The crew · {rest.length} employees</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {rest.map(e => (
            <EmployeeCard key={e.id.toString()} e={e} onOpen={() => onOpen(e.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AuditCard() {
  const db = useDb();
  const [expanded, setExpanded] = useState(false);
  const r = latestReport(db, 'audit');
  if (!r) return null;
  const author = db.employees.find(e => e.id === r.authorEmployeeId);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ScanSearch className="size-4 text-navy-500" /> {r.title}
          </CardTitle>
          <CardDescription>
            The Auditor's latest findings on {db.project?.name ?? 'your app'} · {shortDate(tsDate(r.at))}
          </CardDescription>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <EmployeeChip employee={author} />
          {db.project && (
            <span className={cn('text-xs font-semibold', db.project.healthScore >= 70 ? 'text-emerald-700' : 'text-amber-700')}>
              Health {db.project.healthScore}/100
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className={cn('relative', !expanded && 'max-h-44 overflow-hidden')}>
          <Markdown>{r.bodyMd}</Markdown>
          {!expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />}
        </div>
        <Button variant="link" size="sm" className="mt-1" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show less' : 'Read the full audit'}
        </Button>
      </CardContent>
    </Card>
  );
}

function CodeChanges({ onView }: { onView: (t: Task) => void }) {
  const db = useDb();
  const tasks = [...db.tasks].filter(t => t.branch).reverse().slice(0, 8);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="size-4 text-navy-500" /> Code changes
          </CardTitle>
          <CardDescription>Every fix lands on its own branch for you to review.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {tasks.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted">No branches yet.</div>
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map(t => {
              const e = db.employees.find(x => x.id === t.employeeId);
              return (
                <li key={t.id.toString()} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="font-mono">{t.branch}</span>
                      <span>· {usd(t.costMicros)}</span>
                      <span>· {sentence(t.status)}</span>
                    </div>
                  </div>
                  <EmployeeChip employee={e} />
                  <Button size="xs" variant="outline" onClick={() => onView(t)}>
                    View changes
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function History({ onOpen }: { onOpen: (id: bigint) => void }) {
  const db = useDb();
  const fired = db.employees.filter(e => e.status === 'fired');
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <HistoryIcon className="size-4 text-navy-500" /> Crew history
          </CardTitle>
          <CardDescription>Hires, departures, and budget events.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {fired.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {fired.map(e => (
              <button key={e.id.toString()} onClick={() => onOpen(e.id)} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-0.5 pl-0.5 pr-2.5 text-xs text-muted hover:bg-navy-50">
                <RoleAvatar role={e.role} size="sm" className="rounded-full opacity-60" /> {e.displayName} (former)
              </button>
            ))}
          </div>
        )}
        <CrewEvents />
        {fired.length === 0 && db.activity.every(a => a.runId !== 0n) && <div className="py-4 text-center text-sm text-muted">Nothing yet.</div>}
      </CardContent>
    </Card>
  );
}

export default function DevelopersPage() {
  const db = useDb();
  const [params, setParams] = useSearchParams();
  const [diffTask, setDiffTask] = useState<Task | null>(null);
  const selected = params.get('employee');
  const selectedId = selected && /^\d+$/.test(selected) ? BigInt(selected) : null;
  const open = (id: bigint) => setParams({ employee: id.toString() }, { replace: false });
  const close = () => setParams({}, { replace: true });
  const mode = db.settings?.mode ?? 'autonomous';

  return (
    <div>
      <PageHeader
        title="My Developers"
        description={
          mode === 'manual'
            ? 'Manual: your crew asks you before switching models or spending past a limit.'
            : 'Autonomous: your crew plans, fixes, tests and switches models on its own, inside your budget.'
        }
        actions={
          <>
            <ModeToggle />
            <RunNow />
          </>
        }
      />
      <RepoCard compact />
      <AuditCard />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <OrgChart onOpen={open} />
        <div className="lg:sticky lg:top-20 lg:self-start">
          <LivePanel />
          <p className="mt-2 px-1 text-xs text-muted">
            Model switches are highlighted in amber. Budget rules live in the database, so nobody can skip them. <Link to="/finances" className="text-navy-600 hover:underline">See spending</Link>
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <CodeChanges onView={setDiffTask} />
        <History onOpen={open} />
      </div>
      <EmployeeDrawer employeeId={selectedId} onClose={close} onSelect={open} />
      <DiffDialog task={diffTask} onClose={() => setDiffTask(null)} />
    </div>
  );
}
