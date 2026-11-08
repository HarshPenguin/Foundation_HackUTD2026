import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUp, Code, Lock, LockOpen, Mail, Sparkles, Wallet, ListChecks } from 'lucide-react';
import { useDb } from '@/lib/stdb';
import { useCall } from '@/lib/actions';
import { activeEmployees, available, byRole, currentRun, latestReport, nextCrewRun, weeklyProjection } from '@/lib/domain';
import { ago, tsDate, usd, whenLabel } from '@/lib/format';
import { Card, Badge, Meter } from '@/components/ui/primitives';
import { EmployeeChip, Markdown, RoleAvatar } from '@/components/shared';
import { cn } from '@/lib/utils';

const SUGGESTIONS = ['Is my app safe?', 'Why did my bill go up?', 'Upgrade my login page'];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function useStatusLine() {
  const db = useDb();
  const b = db.budget;
  const running = currentRun(db);
  const next = nextCrewRun(db);
  const stopped = db.providers.filter(p => p.status === 'stopped');
  const low = db.providers.filter(p => p.status === 'low');
  let money = 'All spending within limits.';
  if (b?.autonomousHalted) money = 'Autonomous work is paused for the week to protect your budget.';
  else if (stopped.length) money = `${stopped.map(p => p.name).join(' and ')} stopped at ${stopped.length > 1 ? 'their limits' : 'its limit'}. Everything else is within limits.`;
  else if (low.length) money = `All spending within limits. ${low.map(p => p.name).join(' and ')} ${low.length > 1 ? 'are' : 'is'} running low.`;
  const crew = running ? 'Your crew is working right now.' : next ? `Your crew runs ${whenLabel(next)}.` : 'No run is scheduled.';
  return `${money} ${crew}`;
}

function stripMd(s: string) {
  return s
    .replace(/[#*_`>|-]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function directiveIntent(json: string): string {
  if (!json) return '';
  try {
    return String((JSON.parse(json) as { intent?: string }).intent ?? '');
  } catch {
    return '';
  }
}

function Chat() {
  const db = useDb();
  const call = useCall();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const translator = byRole(db, 'translator');

  const messages = db.chat;
  const last = messages[messages.length - 1];
  const waiting = last?.role === 'user';
  const hasConversation = messages.some(m => m.role === 'user');

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, waiting]);

  const send = async (value: string) => {
    const v = value.trim();
    if (!v || sending) return;
    setSending(true);
    const ok = await call(r => r.sendChat({ text: v }));
    setSending(false);
    if (ok) setText('');
  };

  return (
    <div className="mx-auto w-full max-w-3xl text-left">
      {hasConversation && (
        <div ref={scrollRef} className="mb-4 max-h-[420px] space-y-4 overflow-y-auto rounded-2xl border border-line bg-white/70 p-4 sm:p-5">
          {messages.map(m =>
            m.role === 'user' ? (
              <div key={m.id.toString()} className="animate-fade-up flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-navy-800 px-4 py-2.5 text-sm text-white">{m.text}</div>
              </div>
            ) : (
              <div key={m.id.toString()} className="animate-fade-up flex items-start gap-3">
                <RoleAvatar role="translator" size="md" />
                <div className="min-w-0 max-w-[85%]">
                  <div className="mb-1 text-xs font-medium text-muted">
                    {translator?.displayName ?? 'Translator'} · {ago(tsDate(m.at))}
                  </div>
                  <div className="rounded-2xl rounded-tl-md border border-line bg-white px-4 py-2.5">
                    <Markdown>{m.text}</Markdown>
                  </div>
                  {directiveIntent(m.directiveJson) === 'start_maintenance' && (
                    <Link to="/developers" className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-navy-600 hover:underline">
                      <ListChecks className="size-3.5" /> Passed to the Manager. Watch it on My Developers
                    </Link>
                  )}
                </div>
              </div>
            )
          )}
          {waiting && (
            <div className="flex items-start gap-3">
              <RoleAvatar role="translator" size="md" />
              <div>
                <div className="inline-flex items-center gap-1 rounded-2xl rounded-tl-md border border-line bg-white px-4 py-3">
                  <span className="typing-dot size-1.5 rounded-full bg-navy-400" />
                  <span className="typing-dot size-1.5 rounded-full bg-navy-400" />
                  <span className="typing-dot size-1.5 rounded-full bg-navy-400" />
                </div>
                {!db.settings?.workerOnline && (
                  <div className="mt-1.5 text-xs text-muted">Your crew is offline. The Translator will answer when it reconnects.</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={e => {
          e.preventDefault();
          void send(text);
        }}
        className="rounded-3xl border border-line bg-white p-2 shadow-[0_8px_30px_rgba(20,33,58,0.08)] focus-within:border-navy-300"
      >
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          rows={2}
          placeholder="Ask the Translator anything about your app, your crew, or your spending"
          className="block w-full resize-none bg-transparent px-4 pt-3 text-[15px] text-ink placeholder:text-muted/70 focus:outline-none"
          aria-label="Message the Translator"
        />
        <div className="flex items-center justify-between px-2 pb-1">
          <div className="flex items-center gap-1.5 pl-2 text-xs text-muted">
            <Sparkles className="size-3.5 text-amber-500" /> Plain English in, plain English out
          </div>
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="inline-flex size-9 items-center justify-center rounded-full bg-navy-800 text-white transition-colors hover:bg-navy-700 disabled:bg-navy-200"
            aria-label="Send"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map(s => (
          <button
            key={s}
            onClick={() => void send(s)}
            disabled={sending}
            className="rounded-full border border-line bg-white px-3.5 py-1.5 text-sm text-navy-700 transition-colors hover:border-navy-200 hover:bg-navy-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function GlanceCard({ to, icon, title, children, cta }: { to: string; icon: React.ReactNode; title: string; children: React.ReactNode; cta: string }) {
  return (
    <Link to={to} className="group">
      <Card className="flex h-full flex-col p-5 transition-all group-hover:-translate-y-0.5 group-hover:border-navy-200 group-hover:shadow-md">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-navy-50 text-navy-700 [&_svg]:size-4">{icon}</span>
          <div className="text-sm font-semibold text-ink">{title}</div>
        </div>
        <div className="flex-1">{children}</div>
        <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-navy-600">
          {cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </div>
      </Card>
    </Link>
  );
}

export default function HomePage() {
  const db = useDb();
  const status = useStatusLine();
  const b = db.budget;
  const spent = Number(b?.spentMicros ?? 0n);
  const reserved = Number(b?.reservedMicros ?? 0n);
  const limit = Number(b?.limitMicros ?? 0n);
  const projection = weeklyProjection(db);
  const totalAvail = db.providers.reduce((s, p) => s + Number(available(p)), 0) / 1e6;
  const runwayWeeks = projection > 0 ? totalAvail / projection : Infinity;
  const onReview = activeEmployees(db).filter(e => e.status === 'on_review');
  const running = currentRun(db);
  const update = latestReport(db, 'weekly_update');
  const author = update ? db.employees.find(e => e.id === update.authorEmployeeId) : undefined;
  const next = nextCrewRun(db);

  const preview = useMemo(() => (update ? stripMd(update.bodyMd).slice(0, 170) : ''), [update]);

  return (
    <div className="pb-10">
      <section className="flex flex-col items-center pb-10 pt-6 text-center sm:pt-12">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {greeting()}, {db.settings?.ownerName ?? 'there'}
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] text-muted">{status}</p>
        <div className="mt-8 w-full">
          <Chat />
        </div>
      </section>

      <section>
        <div className="mb-3 text-sm font-semibold text-ink">At a glance</div>
        <div className="grid gap-4 md:grid-cols-3">
          <GlanceCard to="/finances" icon={<Wallet />} title="My Finances" cta="Open My Finances">
            <div className="flex items-baseline justify-between">
              <div className="text-2xl font-semibold tabular-nums text-ink">{usd(spent)}</div>
              <div className="text-sm text-muted">of {usd(limit)} this week</div>
            </div>
            <Meter
              className="mt-3"
              max={limit}
              segments={[
                { value: spent, className: 'bg-navy-700', label: 'Spent' },
                { value: reserved, className: 'bg-amber-300', label: 'Reserved' },
              ]}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>
                Runway: {Number.isFinite(runwayWeeks) ? `about ${Math.max(0, Math.floor(runwayWeeks))} weeks of credit` : 'plenty of credit'}
              </span>
              {b?.spendLocked ? (
                <Badge tone="neutral">
                  <Lock className="size-3" /> Spending lock on
                </Badge>
              ) : (
                <Badge tone="warn">
                  <LockOpen className="size-3" /> Unlocked this week
                </Badge>
              )}
            </div>
          </GlanceCard>

          <GlanceCard to="/developers" icon={<Code />} title="My Developers" cta="Open My Developers">
            <div className="text-sm text-muted">{running ? 'Working now' : 'Next run'}</div>
            <div className="text-lg font-semibold text-ink first-letter:uppercase">{running ? running.summary || 'A run is in progress' : whenLabel(next)}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="navy">{db.settings?.mode === 'manual' ? 'Manual' : 'Autonomous'}</Badge>
              <Badge tone="outline">{activeEmployees(db).length} employees</Badge>
              {onReview.length > 0 && <Badge tone="warn">{onReview.map(e => e.displayName).join(', ')} on review</Badge>}
            </div>
          </GlanceCard>

          <GlanceCard to="/communications" icon={<Mail />} title="My Communications" cta="Read the update">
            {update ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm font-semibold text-ink">{update.title}</div>
                </div>
                <p className={cn('mt-1 line-clamp-3 text-sm text-muted')}>{preview}</p>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                  {author && <RoleAvatar role={author.role} size="sm" className="rounded-full" />}
                  <span>
                    {author?.displayName ?? 'Communicator'} · {ago(tsDate(update.at))}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">No updates yet. The Communicator writes one after each week.</p>
            )}
          </GlanceCard>
        </div>
      </section>
    </div>
  );
}
