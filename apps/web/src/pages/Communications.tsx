import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, ClipboardCheck, Inbox, Mail, Megaphone, Newspaper, RefreshCw, ScanSearch, Star, Archive, Send } from 'lucide-react';
import { useDb } from '@/lib/stdb';
import { useCall } from '@/lib/actions';
import { tsDate, tsMs, shortDate, usd, ago } from '@/lib/format';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  MockTag,
  NativeSelect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { EmployeeChip, Markdown, PageHeader, RoleAvatar } from '@/components/shared';
import type { Report } from '@/module_bindings/types';
import { cn } from '@/lib/utils';

const FEEDS = [
  { k: 'weekly_update', label: 'Weekly updates', icon: Newspaper },
  { k: 'performance_review', label: 'Performance reviews', icon: ClipboardCheck },
  { k: 'marketing_strategy', label: 'Marketing strategies', icon: Megaphone },
  { k: 'audit', label: 'Audit', icon: ScanSearch },
  { k: 'research', label: 'Research', icon: BookOpen },
  { k: 'update_plan', label: 'Update plans', icon: RefreshCw },
] as const;

function ReportCard({ r }: { r: Report }) {
  const db = useDb();
  const author = db.employees.find(e => e.id === r.authorEmployeeId);
  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="text-base">{r.title}</CardTitle>
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

function Reviews() {
  const db = useDb();
  const latest = new Map<string, (typeof db.reviews)[number]>();
  for (const r of [...db.reviews].sort((a, b) => tsMs(a.at) - tsMs(b.at))) latest.set(r.employeeId.toString(), r);
  const reviews = [...latest.values()].sort((a, b) => a.score - b.score);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {reviews.map(r => {
        const e = db.employees.find(x => x.id === r.employeeId);
        const successor = e?.status === 'fired' ? db.employees.find(x => x.role === e.role && x.generation === e.generation + 1) : undefined;
        const replace = r.recommendation === 'replace';
        return (
          <Card key={r.id.toString()} className={cn('p-4', replace && !successor && 'border-amber-300 bg-amber-50/50')}>
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  'flex size-11 shrink-0 items-center justify-center rounded-xl text-base font-semibold tabular-nums',
                  r.score >= 80 ? 'bg-emerald-50 text-emerald-700' : r.score >= 60 ? 'bg-navy-50 text-navy-700' : 'bg-amber-100 text-amber-800'
                )}
              >
                {r.score}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <EmployeeChip employee={e} />
                  <Badge tone={replace ? 'warn' : r.recommendation === 'coach' ? 'neutral' : 'ok'}>
                    {replace ? 'Recommend replacing' : r.recommendation === 'coach' ? 'Coach' : 'Keep'}
                  </Badge>
                </div>
                <p className="mt-2 text-[13px] leading-snug text-ink/90">
                  {replace && e && !successor && <strong>{e.displayName} placed on review. </strong>}
                  {r.summary}
                </p>
                <div className="mt-2 text-xs text-muted">
                  {r.period} · {r.tasksDone} done · {r.rejections} rejected · {r.failures} failed
                  {r.costPerAcceptedMicros > 0n && ` · ${usd(r.costPerAcceptedMicros)} per accepted task`}
                </div>
                {replace && e && (
                  <div className="mt-3">
                    {successor ? (
                      <Link to={`/developers?employee=${successor.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-700 hover:underline">
                        <RoleAvatar role={successor.role} size="sm" /> {successor.displayName} hired
                      </Link>
                    ) : (
                      <Button size="sm" variant="accent" asChild>
                        <Link to={`/developers?employee=${e.id}`}>Review {e.displayName}</Link>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Feed({ kind }: { kind: string }) {
  const db = useDb();
  const items = db.reports.filter(r => r.kind === kind).sort((a, b) => tsMs(b.at) - tsMs(a.at));
  const feed = FEEDS.find(f => f.k === kind);
  return (
    <div className="flex flex-col gap-4">
      {kind === 'performance_review' && <Reviews />}
      {items.length === 0 && (
        <EmptyState icon={feed ? <feed.icon /> : undefined} title={`No ${feed?.label.toLowerCase() ?? 'reports'} yet`} body="They appear here as soon as an employee writes one." />
      )}
      {items.map(r => (
        <ReportCard key={r.id.toString()} r={r} />
      ))}
    </div>
  );
}

function EmailPreview() {
  // MOCK: a mock inbox showing what the Communicator sends. Real: deliver via Resend and show the sent message log.
  const db = useDb();
  const emails = db.reports
    .filter(r => r.kind === 'weekly_update' || r.kind === 'performance_review' || r.kind === 'marketing_strategy')
    .sort((a, b) => tsMs(b.at) - tsMs(a.at));
  const [sel, setSel] = useState<string | null>(null);
  const current = emails.find(e => e.id.toString() === sel) ?? emails.find(e => e.kind === 'weekly_update') ?? emails[0];
  const owner = db.settings?.ownerName ?? 'You';
  if (!current) return <EmptyState icon={<Inbox />} title="Inbox is empty" />;
  const author = db.employees.find(e => e.id === current.authorEmployeeId);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line bg-navy-50/60 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <Inbox className="size-4 text-navy-500" /> Inbox
        </div>
        <MockTag>Email preview · demo inbox</MockTag>
      </div>
      <div className="grid md:grid-cols-[280px_minmax(0,1fr)]">
        <ul className="max-h-[560px] overflow-y-auto border-b border-line md:border-b-0 md:border-r">
          {emails.map(e => {
            const a = db.employees.find(x => x.id === e.authorEmployeeId);
            const active = e.id === current.id;
            return (
              <li key={e.id.toString()}>
                <button
                  onClick={() => setSel(e.id.toString())}
                  className={cn('w-full border-b border-line px-4 py-3 text-left transition-colors', active ? 'bg-navy-50' : 'hover:bg-navy-50/50')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('truncate text-sm', active ? 'font-semibold text-ink' : 'font-medium text-ink')}>Foundation {a?.displayName ?? ''}</span>
                    <span className="shrink-0 text-[11px] text-muted">{shortDate(tsDate(e.at))}</span>
                  </div>
                  <div className="truncate text-[13px] text-ink/90">{e.title}</div>
                  <div className="truncate text-xs text-muted">{e.bodyMd.replace(/[#*_`>]/g, '').slice(0, 80)}</div>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="min-w-0 bg-white">
          <div className="border-b border-line px-6 py-4">
            <div className="text-lg font-semibold text-ink">{current.title}</div>
            <div className="mt-2 flex items-center gap-3">
              <RoleAvatar role={author?.role ?? 'communicator'} />
              <div className="min-w-0 text-[13px] leading-tight">
                <div className="font-medium text-ink">
                  Foundation {author?.displayName ?? 'Communicator'} <span className="font-normal text-muted">&lt;updates@foundation.dev&gt;</span>
                </div>
                <div className="text-muted">to {owner.toLowerCase()}@mediclaim.example</div>
              </div>
              <div className="ml-auto flex items-center gap-1 text-muted">
                <span className="hidden text-xs sm:inline">{ago(tsDate(current.at))}</span>
                <Star className="size-4" />
                <Archive className="size-4" />
              </div>
            </div>
          </div>
          <div className="px-6 py-5">
            <p className="mb-3 text-sm text-ink">Hi {owner},</p>
            <Markdown>{current.bodyMd}</Markdown>
            <p className="mt-4 text-sm text-ink">
              Your crew
              <br />
              <span className="text-muted">Reply to this email to talk to the Chatbot.</span>
            </p>
            <div className="mt-6 border-t border-line pt-3 text-[11px] text-muted">
              You get these {db.settings?.commFrequency ?? 'weekly'} by {db.settings?.commChannel === 'sms' ? 'SMS' : db.settings?.commChannel === 'in_app' ? 'in-app message' : 'email'}. Change this in delivery preferences.
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function DeliveryPrefs({ compact }: { compact?: boolean }) {
  const db = useDb();
  const call = useCall();
  const [channel, setChannel] = useState(db.settings?.commChannel ?? 'email');
  const [freq, setFreq] = useState(db.settings?.commFrequency ?? 'weekly');
  useEffect(() => {
    setChannel(db.settings?.commChannel ?? 'email');
    setFreq(db.settings?.commFrequency ?? 'weekly');
  }, [db.settings?.commChannel, db.settings?.commFrequency]);
  const save = (c: string, f: string) => {
    setChannel(c);
    setFreq(f);
    void call(r => r.setCommPrefs({ channel: c, frequency: f }), 'Delivery preferences saved');
  };
  return (
    <div className={cn('flex flex-wrap items-center gap-2', compact && 'text-sm')}>
      <Send className="size-4 text-navy-500" />
      <span className="text-sm text-muted">Send updates by</span>
      <NativeSelect className="h-8 text-[13px]" value={channel} onChange={e => save(e.target.value, freq)} aria-label="Channel">
        <option value="email">Email</option>
        <option value="in_app">In-app</option>
        <option value="sms">SMS (demo)</option>
      </NativeSelect>
      <NativeSelect className="h-8 text-[13px]" value={freq} onChange={e => save(channel, e.target.value)} aria-label="Frequency">
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </NativeSelect>
    </div>
  );
}

export default function CommunicationsPage() {
  const [params, setParams] = useSearchParams();
  const valid = [...FEEDS.map(f => f.k as string), 'email'];
  const tab = valid.includes(params.get('tab') ?? '') ? (params.get('tab') as string) : 'weekly_update';
  return (
    <div>
      <PageHeader
        title="My Communications"
        description="Everything your crew writes for you, in plain English."
        actions={
          <Card className="px-3 py-2">
            <DeliveryPrefs compact />
          </Card>
        }
      />
      <Tabs value={tab} onValueChange={v => setParams(v === 'weekly_update' ? {} : { tab: v }, { replace: true })}>
        <TabsList>
          {FEEDS.map(f => (
            <TabsTrigger key={f.k} value={f.k}>
              <f.icon /> {f.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="email">
            <Mail /> Email preview
          </TabsTrigger>
        </TabsList>
        {FEEDS.map(f => (
          <TabsContent key={f.k} value={f.k}>
            <Feed kind={f.k} />
          </TabsContent>
        ))}
        <TabsContent value="email">
          <EmailPreview />
        </TabsContent>
      </Tabs>
    </div>
  );
}
