import { useMemo, useState } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, RotateCcw } from 'lucide-react';
import { useDb } from '@/lib/stdb';
import { useCall } from '@/lib/actions';
import { activeEmployees, avgRunCost, ROLE_ORDER, RUNS_PER_WEEK } from '@/lib/domain';
import { CADENCE_LABEL, toDollars, usd } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Meter, NativeSelect } from './ui/primitives';
import { Button } from './ui/button';
import { RoleAvatar } from './shared';
import { cn } from '@/lib/utils';

const CADENCES = ['on_demand', 'daily', 'weekly', 'monthly', 'quarterly'];

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

export function BudgetCalculator({ className }: { className?: string }) {
  const db = useDb();
  const call = useCall();
  const crew = useMemo(
    () => [...activeEmployees(db)].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)),
    [db]
  );
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const rows = crew.map(e => {
    const cadence = draft[e.id.toString()] ?? e.cadence;
    const perRun = avgRunCost(db, e);
    const runs = RUNS_PER_WEEK[cadence] ?? 0;
    return { e, cadence, perRun, runs, weekly: perRun * runs, changed: cadence !== e.cadence };
  });
  const total = rows.reduce((s, r) => s + r.weekly, 0);
  const limit = toDollars(db.budget?.limitMicros ?? 0n);
  const over = total > limit;
  const changed = rows.filter(r => r.changed);

  const apply = async () => {
    setSaving(true);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const off = -new Date().getTimezoneOffset();
    for (const r of changed) {
      let runDay = r.e.runDay;
      if (r.cadence === 'weekly' && runDay > 6) runDay = 3;
      if ((r.cadence === 'monthly' || r.cadence === 'quarterly') && (runDay < 1 || runDay > 28)) runDay = 1;
      await call(x =>
        x.setCadence({ employeeId: r.e.id, cadence: r.cadence, runDay, runHour: r.e.runHour, timezone: tz, utcOffsetMinutes: off })
      );
    }
    setSaving(false);
    setDraft({});
    await call(async () => undefined, 'Schedule saved');
  };

  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="size-4 text-navy-500" /> Budget calculator
          </CardTitle>
          <CardDescription>Weekly cost = runs per week × average cost per run, for every employee.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            'mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
            over ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-navy-100 bg-navy-50 text-navy-800'
          )}
        >
          {over ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-navy-600" />}
          <div>
            At this schedule your crew will spend <strong className="tabular-nums">{fmt(total)}/week</strong>.{' '}
            {over
              ? `That is over your ${usd(db.budget?.limitMicros ?? 0n)} budget. Autonomous runs will stop for the week once your ${usd(db.budget?.limitMicros ?? 0n)} budget is used.`
              : `Autonomous runs will stop for the week once your ${usd(db.budget?.limitMicros ?? 0n)} budget is used.`}
          </div>
        </div>
        <Meter
          max={Math.max(limit, total) * 1.05}
          marker={limit}
          segments={[{ value: total, className: over ? 'bg-amber-400' : 'bg-navy-700', label: 'Projected weekly cost' }]}
        />
        <div className="mt-1.5 flex justify-between text-xs text-muted">
          <span>Projected {fmt(total)}</span>
          <span>Budget {usd(db.budget?.limitMicros ?? 0n)}</span>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted">
          What if
          <button
            className="rounded-full border border-line px-3 py-1 text-navy-700 hover:bg-navy-50"
            onClick={() => setDraft(Object.fromEntries(crew.filter(e => e.role === 'developer' || e.role === 'researcher').map(e => [e.id.toString(), 'daily'])))}
          >
            Developers and Researcher run daily
          </button>
          <button
            className="rounded-full border border-line px-3 py-1 text-navy-700 hover:bg-navy-50"
            onClick={() => setDraft(Object.fromEntries(crew.filter(e => e.role !== 'translator').map(e => [e.id.toString(), 'daily'])))}
          >
            Everyone runs daily
          </button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 font-medium">Employee</th>
                <th className="py-2 font-medium">Cadence</th>
                <th className="py-2 text-right font-medium">Runs/week</th>
                <th className="py-2 text-right font-medium">Avg per run</th>
                <th className="py-2 text-right font-medium">Per week</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.e.id.toString()} className={cn('border-b border-line/70 last:border-0', r.changed && 'bg-amber-50/50')}>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <RoleAvatar role={r.e.role} size="sm" />
                      <span className="font-medium text-ink">{r.e.displayName}</span>
                    </div>
                  </td>
                  <td className="py-2">
                    <NativeSelect
                      className="h-8 text-[13px]"
                      value={r.cadence}
                      aria-label={`Cadence for ${r.e.displayName}`}
                      onChange={ev => setDraft(d => ({ ...d, [r.e.id.toString()]: ev.target.value }))}
                    >
                      {CADENCES.map(c => (
                        <option key={c} value={c}>
                          {CADENCE_LABEL[c]}
                        </option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted">{r.runs ? r.runs.toFixed(r.runs < 1 ? 2 : 0) : '0'}</td>
                  <td className="py-2 text-right tabular-nums text-muted">{fmt(r.perRun)}</td>
                  <td className="py-2 text-right font-medium tabular-nums text-ink">{fmt(r.weekly)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted">Average cost per run comes from each employee's task history or a typical cost for the role, whichever is higher.</div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={!changed.length || saving} onClick={() => setDraft({})}>
              <RotateCcw /> Reset
            </Button>
            <Button size="sm" disabled={!changed.length || saving} onClick={apply}>
              {changed.length ? `Apply ${changed.length} change${changed.length > 1 ? 's' : ''}` : 'Apply schedule'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
