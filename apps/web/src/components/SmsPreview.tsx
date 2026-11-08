// MOCK: SMS delivery. The Communicator's texts are shown in a phone preview instead of being sent.
// Real: call an SMS API (e.g. Photon) from the worker when the Communicator writes an update or a
// switch_or_upgrade / budget_halt notification is created, using the owner's saved phone number.
import { useMemo, useState } from 'react';
import { MessageSquareText, Send, Smartphone } from 'lucide-react';
import { useDb, type Db } from '@/lib/stdb';
import { tsDate as tsDateOrNull, usd } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, MockTag } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

const PHONE_KEY = 'foundation.sms.phone';
const tsDate = (t: Parameters<typeof tsDateOrNull>[0]): Date => tsDateOrNull(t) ?? new Date(0);

interface Text {
  id: string;
  at: Date;
  body: string;
  from: 'foundation' | 'you';
}

function readPhone(): string {
  try {
    return localStorage.getItem(PHONE_KEY) ?? '';
  } catch {
    return '';
  }
}
function writePhone(v: string) {
  try {
    localStorage.setItem(PHONE_KEY, v);
  } catch {
    /* private mode: keep it in memory only */
  }
}

function firstSentences(md: string, n: number): string {
  const plain = md
    .replace(/[*_`#>|]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.split(/(?<=[.!?])\s/).slice(0, n).join(' ');
}

/** The texts the Communicator would send, built from live data. */
function textsFrom(db: Db): Text[] {
  const out: Text[] = [];
  const b = db.budget;
  const money = b ? `${usd(b.spentMicros)} of your ${usd(b.limitMicros)} weekly budget used.` : '';

  const update = [...db.reports].filter(r => r.kind === 'weekly_update').sort((a, z) => Number(z.at.microsSinceUnixEpoch - a.at.microsSinceUnixEpoch))[0];
  if (update) {
    out.push({
      id: `u${update.id}`,
      at: tsDate(update.at),
      from: 'foundation',
      body: `Foundation weekly update: ${firstSentences(update.bodyMd.replace(/^Hi [^.]+\.\s*/, ''), 2)} ${money} Full update: foundation-hackutd.vercel.app/communications`,
    });
  }
  const repo = db.repo;
  if (repo && repo.status === 'ready' && repo.scannedAt) {
    out.push({
      id: `r${repo.updatedAt.microsSinceUnixEpoch}`,
      at: tsDate(repo.scannedAt),
      from: 'foundation',
      body: `Foundation: the Auditor finished reading ${repo.name}. ${repo.findings} risks found, health ${repo.healthScore}/100. Reply FIX to have your crew start on the top two.`,
    });
  }
  for (const n of db.notifications.slice(0, 40)) {
    if (n.kind === 'switch_or_upgrade') {
      out.push({ id: `n${n.id}`, at: tsDate(n.createdAt), from: 'foundation', body: `Foundation: ${n.title}. ${firstSentences(n.body, 1)} Reply 1 to switch models, 2 to add $20.` });
    } else if (n.kind === 'budget_halt') {
      out.push({ id: `n${n.id}`, at: tsDate(n.createdAt), from: 'foundation', body: `Foundation: ${n.title}. Your crew stopped instead of spending more. Reply UNLOCK to keep going this week.` });
    } else if (n.kind === 'info' && /^Switched from/.test(n.title)) {
      out.push({ id: `n${n.id}`, at: tsDate(n.createdAt), from: 'foundation', body: `Foundation: ${n.title}. Your crew kept working. No action needed.` });
    }
  }
  const seen = new Set<string>();
  const unique = out.filter(t => (seen.has(t.body) ? false : (seen.add(t.body), true)));
  return unique.sort((a, z) => a.at.getTime() - z.at.getTime()).slice(-8);
}

function timeLabel(d: Date) {
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function SmsPreview() {
  const db = useDb();
  const [phone, setPhone] = useState(readPhone);
  const [saved, setSaved] = useState(Boolean(readPhone()));
  const [extra, setExtra] = useState<Text[]>([]);
  const texts = useMemo(() => [...textsFrom(db), ...extra], [db, extra]);
  const valid = /^\+?[0-9 ()-]{7,20}$/.test(phone.trim());

  const sendTest = () => {
    const now = new Date();
    setExtra(x => [
      ...x,
      { id: `t${now.getTime()}`, at: now, from: 'foundation', body: `Foundation: this is a test. You'll get your crew's updates and any "switch or upgrade" questions at ${phone.trim()}.` },
    ]);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareText className="size-4" /> Text messages
            </CardTitle>
            <CardDescription>Your weekly update and any decisions that need you, as short texts. Reply to answer from your phone.</CardDescription>
          </div>
          <MockTag>Preview: texts aren&rsquo;t sent yet</MockTag>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="sms-phone">Your phone number</Label>
              <Input id="sms-phone" inputMode="tel" placeholder="+1 214 555 0142" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <Button
              variant="outline"
              disabled={!valid}
              onClick={() => {
                writePhone(phone.trim());
                setSaved(true);
              }}
            >
              Save number
            </Button>
            <Button disabled={!valid} onClick={sendTest}>
              <Send /> Text me a test
            </Button>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Weekly update in two lines, with a link to the full report.</li>
            <li>&ldquo;Switch or upgrade&rdquo; questions in Manual mode: reply 1 or 2.</li>
            <li>Budget stops: reply UNLOCK to keep going this week.</li>
            <li>Audit results when you connect a repo: reply FIX to start.</li>
          </ul>
          {saved && <p className="text-xs text-muted">Saved on this device. Turn on SMS in your delivery preferences to use it as your update channel.</p>}
        </CardContent>
      </Card>

      {/* Phone frame */}
      <div className="mx-auto w-full max-w-[340px] rounded-[44px] border-[10px] border-navy-900 bg-navy-900 shadow-xl">
        <div className="overflow-hidden rounded-[34px] bg-white">
          <div className="flex flex-col items-center gap-1 border-b border-line bg-navy-50/60 px-4 pb-3 pt-4">
            <div className="mb-2 h-1.5 w-20 rounded-full bg-navy-900/80" />
            <div className="grid size-9 place-items-center rounded-full bg-navy-800 text-sm font-semibold text-amber-300">F</div>
            <div className="text-sm font-semibold text-ink">Foundation</div>
            <div className="flex items-center gap-1 text-[11px] text-muted">
              <Smartphone className="size-3" /> {saved && phone ? phone : 'Your phone'}
            </div>
          </div>
          <div className="flex h-[460px] flex-col gap-2 overflow-y-auto px-3 py-3">
            {texts.length === 0 && <p className="mt-10 text-center text-sm text-muted">Texts from your crew will show up here.</p>}
            {texts.map(t => (
              <div key={t.id} className={t.from === 'you' ? 'self-end' : 'self-start'}>
                <div className="mb-0.5 text-[10px] text-muted">{timeLabel(t.at)}</div>
                <div className={`max-w-[250px] rounded-2xl px-3 py-2 text-[13px] leading-snug ${t.from === 'you' ? 'rounded-br-md bg-navy-800 text-white' : 'rounded-bl-md bg-navy-50 text-ink'}`}>
                  {t.body}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-line px-3 py-2 text-xs text-muted">Text message</div>
        </div>
      </div>
    </div>
  );
}
