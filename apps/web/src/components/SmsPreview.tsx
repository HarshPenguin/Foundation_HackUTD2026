// Texts to the owner's phone through Photon (iMessage with SMS fallback).
// SpacetimeDB queues texts (text_message) and receives replies on its /photon webhook route;
// the crew delivers them with Photon's SDK. Before setup, the phone shows a preview built from live data.
import { useMemo, useState } from 'react';
import { Check, CheckCheck, Copy, MessageSquareText, Power, Send, Smartphone, TriangleAlert } from 'lucide-react';
import { STDB_DB, STDB_URI, useDb, type Db } from '@/lib/stdb';
import { useCall } from '@/lib/actions';
import { tsDate as tsDateOrNull, usd } from '@/lib/format';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, MockTag } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

const PHONE_KEY = 'foundation.sms.phone';
const tsDate = (t: Parameters<typeof tsDateOrNull>[0]): Date => tsDateOrNull(t) ?? new Date(0);

interface Text {
  id: string;
  at: Date;
  body: string;
  from: 'foundation' | 'you';
  status?: string;
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

function webhookUrl(secret: string) {
  const base = STDB_URI.replace(/^ws/, 'http').replace(/\/$/, '');
  return `${base}/v1/database/${STDB_DB}/route/photon?secret=${secret}`;
}

export function SmsPreview() {
  const db = useDb();
  const call = useCall();
  const m = db.messaging;
  const live = Boolean(m?.enabled);
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
    const [phone, setPhone] = useState(readPhone);
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const preview = useMemo(() => textsFrom(db), [db]);
  const realTexts: Text[] = db.textMessages.slice(-30).map(t => ({
    id: `x${t.id}`,
    at: tsDate(t.createdAt),
    body: t.body,
    from: t.direction === 'in' ? 'you' : 'foundation',
    status: t.status,
  }));
  const texts = live ? realTexts : preview;
  const validPhone = /^\+?[0-9 ()-]{7,20}$/.test(phone.trim());

  const save = async () => {
    setBusy(true);
    const owner = passcode ? await call(r => r.claimOwner({ passcode })) : true;
    const ok = owner && (await call(r => r.configureMessaging({ address: address.trim(), token: token.trim(), server: '', phone: phone.trim() }), 'Texts are on'));
    setBusy(false);
    if (ok) {
      writePhone(phone.trim());
      setToken('');
      setPasscode('');
      setEditing(false);
    }
  };

  const showForm = !live || editing;
  const failed = [...db.textMessages].reverse().find(t => t.status === 'failed');

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareText className="size-4" /> Text messages
            </CardTitle>
            <CardDescription>Your weekly update and any decisions that need you, as short texts. Reply with one word to act from your phone.</CardDescription>
          </div>
          {live ? <Badge tone="ok">On · Photon · ••{m?.phoneLast4}</Badge> : <MockTag>Not set up yet</MockTag>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {live && !editing && (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void call(r => r.sendTestText({}), 'Test text queued')}>
                <Send /> Send me a test text
              </Button>
              <Button variant="outline" onClick={() => setEditing(true)}>
                Change settings
              </Button>
              <Button variant="ghost" onClick={() => void call(r => r.disableMessaging({}), 'Texts are off')}>
                <Power /> Turn off
              </Button>
              <span className="text-xs text-muted">
                {m?.lastSentAt ? `Last text sent ${tsDate(m.lastSentAt).toLocaleString()}` : 'No texts sent yet'}
              </span>
            </div>
          )}
          {live && (m?.lastError || failed) && (
            <p className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> Last send failed: {m?.lastError || failed?.error}
            </p>
          )}

          {showForm && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="ph-address" label="Photon project ID" value={address} onChange={setAddress} placeholder={m?.address || 'From app.photon.codes'} />
              <Field id="ph-token" label="Project secret" type="password" value={token} onChange={setToken} placeholder={m?.hasToken ? 'Saved. Leave blank to keep it' : 'From app.photon.codes'} />
              <Field id="sms-phone" label="Your phone number" value={phone} onChange={setPhone} placeholder="+1 214 555 0142" inputMode="tel" />
              <Field id="ph-pass" label="Owner passcode" type="password" value={passcode} onChange={setPasscode} placeholder="If asked" />
              <div className="flex items-end gap-2">
                <Button disabled={busy || !validPhone || !(address.trim() || m?.address)} onClick={() => void save()}>
                  {live ? 'Save' : 'Turn on texts'}
                </Button>
                {editing && (
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted sm:col-span-2">The secret and your number go to a private table only your crew can read. They never come back to this browser.</p>
            </div>
          )}

          {live && db.webhookSecret && (
            <div className="rounded-xl bg-navy-50 px-3 py-3 text-sm">
              <div className="mb-1 font-medium text-ink">Let replies reach your crew</div>
              <p className="mb-2 text-xs text-muted">In Photon (app.photon.codes), add this as your project&rsquo;s webhook for incoming messages. Only texts from your number are accepted.</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-[11px]">{webhookUrl(db.webhookSecret)}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(webhookUrl(db.webhookSecret!)).catch(() => undefined);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          )}

          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Weekly update in two lines, plus audit results when you connect a repo.</li>
            <li>Reply 1 to switch models or 2 to add credit when a model runs out.</li>
            <li>Reply UNLOCK to keep going after a budget stop, or FIX to start repairs.</li>
            <li>Text anything else and the Chatbot texts back.</li>
          </ul>
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
              <Smartphone className="size-3" /> {live ? `••${m?.phoneLast4}` : 'Preview'}
            </div>
          </div>
          <div className="flex h-[460px] flex-col gap-2 overflow-y-auto px-3 py-3">
            {texts.length === 0 && <p className="mt-10 text-center text-sm text-muted">Texts with your crew will show up here.</p>}
            {texts.map(t => (
              <div key={t.id} className={t.from === 'you' ? 'self-end text-right' : 'self-start'}>
                <div className="mb-0.5 text-[10px] text-muted">{timeLabel(t.at)}</div>
                <div className={`inline-block max-w-[250px] rounded-2xl px-3 py-2 text-left text-[13px] leading-snug ${t.from === 'you' ? 'rounded-br-md bg-navy-800 text-white' : 'rounded-bl-md bg-navy-50 text-ink'}`}>
                  {t.body}
                </div>
                {t.from === 'foundation' && t.status && t.status !== 'received' && (
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
                    {t.status === 'sent' ? <CheckCheck className="size-3" /> : t.status === 'failed' ? <TriangleAlert className="size-3 text-red-600" /> : null}
                    {t.status === 'sent' ? 'Delivered' : t.status === 'failed' ? 'Not sent' : 'Sending'}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-line px-3 py-2 text-xs text-muted">iMessage</div>
        </div>
      </div>
    </div>
  );
}

function Field(props: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: 'tel' }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input id={props.id} type={props.type} inputMode={props.inputMode} value={props.value} onChange={e => props.onChange(e.target.value)} placeholder={props.placeholder} autoComplete="off" />
    </div>
  );
}
