import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Terminal, Unplug } from 'lucide-react';
import { useDb } from '@/lib/stdb';
import { useCall, useToast } from '@/lib/actions';
import { ago, tsDate, usd } from '@/lib/format';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Integration } from '@/module_bindings/types';
import { cn } from '@/lib/utils';

export const CLAUDE_CODE_PROVIDER = 'Claude Code';

/** Real Claude Code integration state, read from the `integration` and `external_session` tables. */
export function useClaudeCode() {
  const db = useDb();
  return useMemo(() => {
    const all = db.integrations.filter(i => i.kind === 'claude_code');
    const connected = all.filter(i => i.status === 'connected');
    const ids = new Set(all.map(i => i.id));
    const sessions = db.externalSessions.filter(s => ids.has(s.integrationId));
    return {
      all,
      connected,
      isConnected: connected.length > 0,
      spentMicros: connected.reduce((n, i) => n + i.spentThisWeekMicros, 0n),
      sessionsThisWeek: connected.reduce((n, i) => n + i.sessionsThisWeek, 0),
      blockedPrompts: connected.reduce((n, i) => n + i.blockedPrompts, 0),
      sessions,
    };
  }, [db.integrations, db.externalSessions]);
}

const money = (m: bigint) => usd(m, m > 0n && m < 10_000n ? 4 : 2);

function CodeBlock({ code }: { code: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast('error', 'Could not copy. Select the text and copy it instead');
    }
  };
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-navy-900 bg-navy-950 px-3 py-2.5">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[12.5px] leading-relaxed text-navy-50">{code}</code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-md p-1 text-navy-200 hover:bg-white/10 hover:text-white"
        aria-label={copied ? 'Copied' : 'Copy command'}
        title={copied ? 'Copied' : 'Copy'}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

const STEPS = [
  {
    title: 'Build the Foundation connector',
    body: 'Run this once from the folder where you cloned Foundation.',
    code: 'cd Foundation/integrations/claude-code && npm install && npm run build',
  },
  {
    title: 'Connect this computer',
    body: "Links this computer's Claude Code to Foundation. Use your owner passcode and a name you'll recognize.",
    code: 'node dist/cli.js connect --passcode <owner passcode> --name "My laptop"',
  },
  {
    title: 'Add Foundation to a project',
    body: "Adds Foundation's MCP server and hooks to that project's Claude Code settings.",
    code: 'node dist/cli.js install --project /path/to/your/app',
  },
];

const BENEFITS = [
  'Claude Code spending shows up in My Finances and counts toward your weekly budget.',
  'The $0 hard stop blocks Claude Code prompts when the budget is used up.',
  "Claude Code can ask your crew questions, read the Auditor's findings and hand work to your crew.",
];

const MCP_TOOLS = ['foundation_status', 'foundation_app_audit', 'foundation_ask_chatbot', 'foundation_request_work', 'foundation_recent_changes'];

export function ClaudeCodeSetupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,600px)]">
        <DialogTitle>Connect Claude Code</DialogTitle>
        <DialogDescription>Three commands in a terminal. Once connected, this card updates on its own.</DialogDescription>
        <ol className="mt-5 flex flex-col gap-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{s.title}</div>
                <div className="text-xs text-muted">{s.body}</div>
                <CodeBlock code={s.code} />
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 rounded-xl border border-navy-100 bg-navy-50/60 px-4 py-3">
          <div className="text-sm font-medium text-ink">What you get</div>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-muted">
            {BENEFITS.map(b => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {MCP_TOOLS.map(t => (
              <code key={t} className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11.5px] text-navy-700 ring-1 ring-inset ring-navy-100">
                {t}
              </code>
            ))}
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConnectedRow({ i }: { i: Integration }) {
  const call = useCall();
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 text-sm">
      <Badge tone="ok">
        <Check className="size-3" /> Connected
      </Badge>
      <span className="min-w-0 flex-1 truncate font-medium text-ink">{i.name}</span>
      <span className="text-xs text-muted">Last seen {ago(tsDate(i.lastSeenAt))}</span>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await call(r => r.disconnectIntegration({ integrationId: i.id }), `${i.name} disconnected`);
          setBusy(false);
        }}
      >
        <Unplug /> Disconnect
      </Button>
    </li>
  );
}

/** Settings → Integrations: the real Claude Code card. */
export function ClaudeCodeIntegrationCard({ className }: { className?: string }) {
  const cc = useClaudeCode();
  const [open, setOpen] = useState(false);
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-navy-800 text-white">
          <Terminal className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">Claude Code</span>
            {cc.isConnected ? <Badge tone="ok">Live</Badge> : <Badge tone="outline">Not connected</Badge>}
          </div>
          <div className="text-xs text-muted">Track and cap Claude Code spending, and let it work with your crew</div>
        </div>
        <Button size="sm" variant={cc.isConnected ? 'outline' : 'default'} onClick={() => setOpen(true)}>
          {cc.isConnected ? 'Setup' : 'Connect'}
        </Button>
      </div>
      {cc.isConnected && (
        <>
          <ul className="mt-3 flex flex-col gap-2">
            {cc.connected.map(i => (
              <ConnectedRow key={i.id.toString()} i={i} />
            ))}
          </ul>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-navy-50/60 px-2 py-2">
              <dt className="text-xs text-muted">Sessions this week</dt>
              <dd className="text-base font-semibold tabular-nums text-ink">{cc.sessionsThisWeek}</dd>
            </div>
            <div className="rounded-lg bg-navy-50/60 px-2 py-2">
              <dt className="text-xs text-muted">Spent this week</dt>
              <dd className="text-base font-semibold tabular-nums text-ink">{money(cc.spentMicros)}</dd>
            </div>
            <div className="rounded-lg bg-navy-50/60 px-2 py-2">
              <dt className="text-xs text-muted">Prompts blocked</dt>
              <dd className={cn('text-base font-semibold tabular-nums', cc.blockedPrompts > 0 ? 'text-red-700' : 'text-ink')}>{cc.blockedPrompts}</dd>
            </div>
          </dl>
        </>
      )}
      <ClaudeCodeSetupDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

/** My Finances → Overview: compact Claude Code spending card. */
export function ClaudeCodeFinanceCard() {
  const cc = useClaudeCode();
  const recent = cc.sessions.slice(0, 5);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4 text-navy-700" /> Claude Code
          </CardTitle>
          <CardDescription>Your Claude Code sessions, charged to your weekly budget.</CardDescription>
        </div>
        {cc.isConnected ? <Badge tone="ok">Connected</Badge> : <Badge tone="outline">Not connected</Badge>}
      </CardHeader>
      <CardContent>
        {!cc.isConnected && cc.sessions.length === 0 ? (
          <div className="text-sm text-muted">
            Claude Code isn't connected yet.{' '}
            <Link to="/settings#integrations" className="font-medium text-navy-600 hover:underline">
              Connect it in Settings → Integrations
            </Link>{' '}
            to track and cap its spending here.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-muted">Spent this week</div>
                <div className="text-xl font-semibold tabular-nums text-ink">{money(cc.spentMicros)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Sessions</div>
                <div className="text-xl font-semibold tabular-nums text-ink">{cc.sessionsThisWeek}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Prompts blocked</div>
                <div className={cn('text-xl font-semibold tabular-nums', cc.blockedPrompts > 0 ? 'text-red-700' : 'text-ink')}>{cc.blockedPrompts}</div>
              </div>
            </div>
            {!cc.isConnected && (
              <div className="mt-3 text-xs text-muted">
                Disconnected.{' '}
                <Link to="/settings#integrations" className="font-medium text-navy-600 hover:underline">
                  Reconnect in Settings
                </Link>
              </div>
            )}
            {recent.length === 0 ? (
              <div className="mt-4 text-sm text-muted">No Claude Code sessions yet. Start one in a connected project and it shows up here.</div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted">
                    <tr className="border-b border-line">
                      <th className="py-1.5 pr-3 font-medium">Project</th>
                      <th className="py-1.5 pr-3 font-medium">Model</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Turns</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Cost</th>
                      <th className="py-1.5 text-right font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map(s => (
                      <tr key={s.sessionId} className="border-b border-line/60 last:border-0">
                        <td className="max-w-[160px] truncate py-1.5 pr-3 text-ink" title={s.project}>
                          {s.project || 'Unknown project'}
                        </td>
                        <td className="max-w-[140px] truncate py-1.5 pr-3 font-mono text-muted" title={s.model}>
                          {s.model}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{s.turns}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{money(s.costMicros)}</td>
                        <td className="whitespace-nowrap py-1.5 text-right text-muted">{ago(tsDate(s.updatedAt))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
