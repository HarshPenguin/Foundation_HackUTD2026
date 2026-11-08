import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Play, RotateCcw, Radio, Square } from 'lucide-react';
import { useDb } from '@/lib/stdb';
import { useWakingCrew } from '@/lib/wake';
import { currentRun, lastFinishedRun } from '@/lib/domain';
import { clockTime, tsDate, usd, ago } from '@/lib/format';
import { Card, Badge } from './ui/primitives';
import { Button } from './ui/button';
import { RoleAvatar } from './shared';
import type { Activity } from '@/module_bindings/types';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<string, string> = {
  plan: 'Plan',
  work: 'Work',
  review: 'Review',
  switch: 'Switch',
  hire: 'Hire',
  fire: 'Let go',
  budget: 'Budget',
  info: 'Info',
};

function ActivityRow({ a }: { a: Activity }) {
  const db = useDb();
  const e = db.employees.find(x => x.id === a.employeeId);
  const isSwitch = a.kind === 'switch';
  return (
    <li
      className={cn(
        'animate-fade-up flex gap-3 rounded-xl px-3 py-2.5',
        isSwitch ? 'border border-amber-200 bg-amber-50' : a.kind === 'budget' ? 'bg-navy-50/70' : 'bg-white'
      )}
    >
      {isSwitch ? (
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-amber-400 text-navy-950">
          <ArrowLeftRight className="size-3.5" />
        </span>
      ) : (
        <RoleAvatar role={e?.role ?? 'info'} size="sm" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-ink">{e?.displayName ?? 'Foundation'}</span>
          <span className={cn('rounded px-1 text-[10px] font-semibold uppercase tracking-wide', isSwitch ? 'bg-amber-200 text-amber-900' : 'bg-navy-50 text-navy-500')}>
            {KIND_LABEL[a.kind] ?? a.kind}
          </span>
          <span className="ml-auto shrink-0 text-muted">{clockTime(tsDate(a.at))}</span>
        </div>
        <div className={cn('mt-0.5 text-[13px] leading-snug', isSwitch ? 'text-amber-950' : 'text-ink/90')}>{a.message}</div>
      </div>
    </li>
  );
}

export function LivePanel({ className }: { className?: string }) {
  const db = useDb();
  const waking = useWakingCrew();
  const live = currentRun(db);
  const last = lastFinishedRun(db);
  const listRef = useRef<HTMLOListElement>(null);
  const [replayStep, setReplayStep] = useState<number | null>(null);

  const run = live ?? last;
  const rows = useMemo(() => (run ? db.activity.filter(a => a.runId === run.id) : []), [db.activity, run]);

  // Stop any replay when a live run starts.
  useEffect(() => {
    if (live) setReplayStep(null);
  }, [live]);

  useEffect(() => {
    if (replayStep == null || live) return;
    if (replayStep >= rows.length) return;
    const t = setTimeout(() => setReplayStep(s => (s == null ? s : s + 1)), 900);
    return () => clearTimeout(t);
  }, [replayStep, rows.length, live]);

  const visible = live ? rows : replayStep != null ? rows.slice(0, replayStep) : rows;
  const replaying = replayStep != null && replayStep < rows.length;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [visible.length]);

  const tasks = run ? db.tasks.filter(t => t.runId === run.id) : [];
  const cost = tasks.reduce((s, t) => s + t.costMicros, 0n);

  return (
    <Card className={cn('flex flex-col overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          {live ? (
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
            </span>
          ) : (
            <Radio className="size-4 text-navy-400" />
          )}
          <div className="text-sm font-semibold text-ink">{live ? 'Live' : replaying ? 'Replaying last run' : 'Live panel'}</div>
          {run && <Badge tone="outline">Run #{run.id.toString()}</Badge>}
        </div>
        {!live && last && (
          <Button size="xs" variant={replaying ? 'outline' : 'soft'} onClick={() => setReplayStep(replaying ? null : 0)}>
            {replaying ? (
              <>
                <Square /> Stop
              </>
            ) : replayStep != null ? (
              <>
                <RotateCcw /> Replay again
              </>
            ) : (
              <>
                <Play /> Replay last run
              </>
            )}
          </Button>
        )}
      </div>
      {run && (
        <div className="border-b border-line bg-navy-50/50 px-4 py-2 text-xs text-muted">
          {live ? (
            <>Started {ago(tsDate(live.startedAt))} · {tasks.length} tasks · {usd(cost)} so far</>
          ) : (
            <>
              {run.status === 'halted' ? 'Stopped to protect the budget' : 'Finished'} {ago(tsDate(run.endedAt ?? run.startedAt))} · {usd(run.totalMicros || cost)}
              {run.summary ? ` · ${run.summary}` : ''}
            </>
          )}
        </div>
      )}
      <ol ref={listRef} className="flex max-h-[520px] min-h-[260px] flex-1 flex-col gap-1.5 overflow-y-auto p-3">
        {!run && <li className="m-auto text-center text-sm text-muted">No runs yet. Click Run now to start one.</li>}
        {run && visible.length === 0 && (
          <li className="m-auto text-center text-sm text-muted">{live ? 'The Manager is getting started' : 'Press Replay to watch the last run step by step.'}</li>
        )}
        {visible.map(a => (
          <ActivityRow key={a.id.toString()} a={a} />
        ))}
        {live && (
          <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
            <span className="typing-dot size-1.5 rounded-full bg-navy-400" />
            <span className="typing-dot size-1.5 rounded-full bg-navy-400" />
            <span className="typing-dot size-1.5 rounded-full bg-navy-400" />
            {db.settings?.workerOnline ? 'Working' : waking ? 'Waking your crew on Maritime…' : 'Waiting for the crew to come online'}
          </li>
        )}
      </ol>
    </Card>
  );
}

export function CrewEvents() {
  const db = useDb();
  const rows = db.activity.filter(a => a.runId === 0n).slice(-6).reverse();
  if (!rows.length) return null;
  return (
    <ol className="flex flex-col gap-1.5">
      {rows.map(a => (
        <ActivityRow key={a.id.toString()} a={a} />
      ))}
    </ol>
  );
}
