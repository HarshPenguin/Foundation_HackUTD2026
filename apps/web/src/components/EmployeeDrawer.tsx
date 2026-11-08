import { useEffect, useState } from 'react';
import { CalendarClock, FileDiff, GitBranch, UserMinus } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useDb } from '@/lib/stdb';
import { useCall } from '@/lib/actions';
import { chainFor, providerFor, ROLE_BLURB, taskTypeForRole, TASK_TYPE_LABEL } from '@/lib/domain';
import { ago, cadenceLabel, CADENCE_LABEL, hourLabel, shortDate, tsDate, usd, whenLabel, WEEKDAY_NAMES, sentence } from '@/lib/format';
import { Badge, Card, Input, Label, NativeSelect } from './ui/primitives';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, SheetContent } from './ui/dialog';
import { DiffViewer, EmployeeStatus, RoleAvatar } from './shared';
import type { Employee, Task } from '@/module_bindings/types';
import { cn } from '@/lib/utils';

export function DiffDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  return (
    <Dialog open={!!task} onOpenChange={v => !v && onClose()}>
      <DialogContent className="w-[min(96vw,900px)]">
        {task && (
          <>
            <DialogTitle className="flex items-center gap-2">
              <FileDiff className="size-5 text-navy-500" /> {task.title}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              <GitBranch className="size-3.5" /> <span className="font-mono">{task.branch}</span>
            </DialogDescription>
            <div className="mt-4">
              {task.diff ? <DiffViewer diff={task.diff} /> : <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted">No diff was recorded for this change.</div>}
            </div>
            {task.output && <p className="mt-3 text-sm text-muted">{task.output.slice(0, 400)}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const TASK_STATUS_TONE: Record<string, 'ok' | 'warn' | 'stop' | 'neutral' | 'outline'> = {
  done: 'ok',
  rejected: 'warn',
  failed: 'warn',
  blocked: 'warn',
  waiting_user: 'warn',
  running: 'neutral',
  reserved: 'neutral',
  queued: 'outline',
};

function CadenceForm({ e }: { e: Employee }) {
  const call = useCall();
  const [cadence, setCadence] = useState(e.cadence);
  const [day, setDay] = useState(e.runDay);
  const [hour, setHour] = useState(e.runHour);
  useEffect(() => {
    setCadence(e.cadence);
    setDay(e.runDay);
    setHour(e.runHour);
  }, [e.id, e.cadence, e.runDay, e.runHour]);

  const monthly = cadence === 'monthly' || cadence === 'quarterly';
  const save = () => {
    let runDay = day;
    if (cadence === 'weekly' && runDay > 6) runDay = 3;
    if (monthly && (runDay < 1 || runDay > 28)) runDay = 1;
    void call(
      r =>
        r.setCadence({
          employeeId: e.id,
          cadence,
          runDay,
          runHour: hour,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          utcOffsetMinutes: -new Date().getTimezoneOffset(),
        }),
      `${e.displayName} now runs ${cadenceLabel(cadence, runDay, hour).toLowerCase()}`
    );
  };
  const dirty = cadence !== e.cadence || day !== e.runDay || hour !== e.runHour;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="grid gap-1">
          <Label className="text-xs text-muted">How often</Label>
          <NativeSelect value={cadence} onChange={ev => setCadence(ev.target.value)}>
            {Object.entries(CADENCE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted">Day</Label>
          <NativeSelect value={day} disabled={cadence === 'daily' || cadence === 'on_demand'} onChange={ev => setDay(Number(ev.target.value))}>
            {monthly
              ? Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>
                    Day {d}
                  </option>
                ))
              : WEEKDAY_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted">Time</Label>
          <NativeSelect value={hour} disabled={cadence === 'on_demand'} onChange={ev => setHour(Number(ev.target.value))}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">Times are in {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
        <Button size="sm" disabled={!dirty} onClick={save}>
          Save cadence
        </Button>
      </div>
    </div>
  );
}

function FireDialog({ e, open, onOpenChange, onDone }: { e: Employee; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const db = useDb();
  const call = useCall();
  const review = [...db.reviews].reverse().find(r => r.employeeId === e.id);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason(review?.recommendation === 'replace' ? review.summary : '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = e.displayName.replace(/ #\d+$/, '');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Fire and replace {e.displayName}?</DialogTitle>
        <DialogDescription>
          {e.displayName} will be let go and {base} #{e.generation + 1} hired with a fresh start, a revised brief and the same schedule. Past work and reviews stay in the history.
        </DialogDescription>
        <div className="mt-5 grid gap-1.5">
          <Label htmlFor="fire-reason">Reason (shared with the replacement as a handoff note)</Label>
          <textarea
            id="fire-reason"
            value={reason}
            onChange={ev => setReason(ev.target.value)}
            rows={3}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-navy-300 focus:outline-none focus:ring-2 focus:ring-navy-100"
            placeholder="Late research that repeated last month"
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim()}
            onClick={async () => {
              const ok = await call(r => r.fireAndReplace({ employeeId: e.id, reason: reason.trim() }), `${base} #${e.generation + 1} hired`);
              if (ok) {
                onOpenChange(false);
                onDone();
              }
            }}
          >
            Fire and replace
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EmployeeDrawer({ employeeId, onClose, onSelect }: { employeeId: bigint | null; onClose: () => void; onSelect: (id: bigint) => void }) {
  const db = useDb();
  const e = employeeId != null ? db.employees.find(x => x.id === employeeId) : undefined;
  const [diffTask, setDiffTask] = useState<Task | null>(null);
  const [fireOpen, setFireOpen] = useState(false);

  const tasks = e ? [...db.tasks].filter(t => t.employeeId === e.id).reverse().slice(0, 8) : [];
  const review = e ? [...db.reviews].reverse().find(r => r.employeeId === e.id) : undefined;
  const taskType = e ? taskTypeForRole(e.role) : 'general';
  const provider = e ? providerFor(db, taskType) : undefined;
  const chain = e ? chainFor(db, taskType) : [];
  const totalCost = e ? db.tasks.filter(t => t.employeeId === e.id).reduce((s, t) => s + t.costMicros, 0n) : 0n;
  const successor = e?.status === 'fired' ? db.employees.find(x => x.role === e.role && x.generation === e.generation + 1) : undefined;

  return (
    <>
      <DialogPrimitive.Root open={!!e} onOpenChange={v => !v && onClose()}>
        <SheetContent aria-describedby={undefined}>
          {e && (
            <div className="flex flex-col gap-5 p-6">
              <div className="flex items-start gap-3 pr-8">
                <RoleAvatar role={e.role} size="lg" />
                <div className="min-w-0">
                  <DialogPrimitive.Title className="text-xl font-semibold text-ink">{e.displayName}</DialogPrimitive.Title>
                  <div className="text-sm text-muted">
                    {sentence(e.role)} · {ROLE_BLURB[e.role] ?? ''}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <EmployeeStatus status={e.status} />
                    <Badge tone="outline">Generation {e.generation}</Badge>
                    <Badge tone="outline">Brief v{e.promptVersion}</Badge>
                  </div>
                </div>
              </div>

              {e.handoffNote && (
                <div className="rounded-xl border border-navy-100 bg-white px-3 py-2 text-[13px] text-navy-800">
                  <span className="font-medium">Handoff note:</span> {e.handoffNote}
                </div>
              )}
              {successor && (
                <button onClick={() => onSelect(successor.id)} className="rounded-xl border border-line bg-white px-3 py-2 text-left text-[13px] text-ink hover:bg-navy-50">
                  Replaced by <span className="font-semibold">{successor.displayName}</span>. Open their profile
                </button>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Card className="p-3">
                  <div className="text-xs text-muted">Model</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-ink">{provider?.model ?? 'None'}</div>
                  <div className="truncate text-xs text-muted">
                    {provider?.name} · {TASK_TYPE_LABEL[taskType]} chain
                  </div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-muted">Total cost</div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{usd(totalCost)}</div>
                  <div className="text-xs text-muted">Last run {ago(tsDate(e.lastRunAt))}</div>
                </Card>
              </div>
              {chain.length > 1 && (
                <div className="-mt-2 text-xs text-muted">
                  Falls back to {chain.slice(1).map(p => p.name).join(', then ')}. Change the order on My Finances.
                </div>
              )}

              {review && (
                <section>
                  <h4 className="mb-2 text-sm font-semibold text-ink">Latest review</h4>
                  <Card className={cn('p-4', review.recommendation === 'replace' && 'border-amber-300 bg-amber-50/60')}>
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex size-12 items-center justify-center rounded-xl text-lg font-semibold tabular-nums',
                          review.score >= 80 ? 'bg-emerald-50 text-emerald-700' : review.score >= 60 ? 'bg-navy-50 text-navy-700' : 'bg-amber-100 text-amber-800'
                        )}
                      >
                        {review.score}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink">
                          Recommendation: {review.recommendation === 'replace' ? 'Replace' : review.recommendation === 'coach' ? 'Coach' : 'Keep'}
                        </div>
                        <div className="text-xs text-muted">
                          {review.period} · {review.tasksDone} done · {review.rejections} rejected · {review.failures} failed
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-[13px] text-ink/90">{review.summary}</p>
                  </Card>
                </section>
              )}

              <section>
                <h4 className="mb-2 text-sm font-semibold text-ink">Recent tasks</h4>
                {tasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted">No tasks yet.</div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {tasks.map(t => (
                      <li key={t.id.toString()} className="rounded-xl border border-line bg-white px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 text-sm font-medium text-ink">{t.title}</div>
                          <span className="shrink-0 text-sm tabular-nums text-ink">{usd(t.costMicros)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <Badge tone={TASK_STATUS_TONE[t.status] ?? 'outline'}>{sentence(t.status)}</Badge>
                          <span>{shortDate(tsDate(t.createdAt))}</span>
                          {t.providerId != null && <span>· {db.providers.find(p => p.id === t.providerId)?.name}</span>}
                          {t.branch && (
                            <button onClick={() => setDiffTask(t)} className="ml-auto inline-flex items-center gap-1 font-medium text-navy-600 hover:underline">
                              <GitBranch className="size-3.5" /> View changes
                            </button>
                          )}
                        </div>
                        {t.blockReason && <div className="mt-1 text-xs text-amber-700">{t.blockReason}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {e.status !== 'fired' && (
                <section>
                  <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
                    <CalendarClock className="size-4 text-navy-500" /> Schedule
                  </h4>
                  <div className="mb-3 text-xs text-muted">
                    {cadenceLabel(e.cadence, e.runDay, e.runHour)} · next run {whenLabel(tsDate(e.nextRunAt))}
                  </div>
                  <Card className="p-4">
                    <CadenceForm e={e} />
                  </Card>
                </section>
              )}

              {e.status !== 'fired' && (
                <section className="border-t border-line pt-5">
                  {e.role === 'translator' ? (
                    <div className="text-xs text-muted">The Translator is your point of contact and can't be fired.</div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Not working out? Hire a replacement with a revised brief.</div>
                      <Button variant={review?.recommendation === 'replace' ? 'accent' : 'outline'} onClick={() => setFireOpen(true)}>
                        <UserMinus /> Fire and replace
                      </Button>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </SheetContent>
      </DialogPrimitive.Root>
      {e && (
        <FireDialog
          e={e}
          open={fireOpen}
          onOpenChange={setFireOpen}
          onDone={() => undefined}
        />
      )}
      <DiffDialog task={diffTask} onClose={() => setDiffTask(null)} />
    </>
  );
}
