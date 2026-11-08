import { useState } from 'react';
import { CheckCircle2, GitBranch, Loader2, ScanSearch, TriangleAlert, Unplug } from 'lucide-react';
import { useDb } from '@/lib/stdb';
import { useCall } from '@/lib/actions';
import { ago, tsDate } from '@/lib/format';
import { Badge, Card, CardContent, Input, Label } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

const EXAMPLE = 'https://github.com/digininja/DVWA';
const WORKING = new Set(['queued', 'cloning', 'scanning']);

const STATUS_LABEL: Record<string, string> = {
  queued: 'Waiting for the Auditor',
  cloning: 'Cloning',
  scanning: 'Reading the code',
  ready: 'Audited',
  failed: 'Couldn’t clone',
};

/** Connect your own codebase: the Auditor clones it on the crew's machine and scans every file. */
export function RepoCard({ compact = false }: { compact?: boolean }) {
  const { repo } = useDb();
  const call = useCall();
  const [url, setUrl] = useState('');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const working = repo ? WORKING.has(repo.status) : false;

  const connect = async () => {
    setBusy(true);
    // MOCK: shared owner passcode stands in for real login.
    const owner = passcode ? await call(r => r.claimOwner({ passcode })) : true;
    const ok = owner && (await call(r => r.connectRepo({ url: url.trim() }), 'The Auditor is cloning your repo'));
    setBusy(false);
    if (ok) {
      setEditing(false);
      setUrl('');
      setPasscode('');
    }
  };

  const showForm = !repo || editing || repo.status === 'failed';

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-navy-800 text-amber-300">
              <GitBranch className="size-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                {repo ? repo.name : 'Connect your code'}
                {repo && (
                  <Badge tone={repo.status === 'ready' ? 'ok' : repo.status === 'failed' ? 'stop' : 'warn'}>
                    {working && <Loader2 className="size-3 animate-spin" />}
                    {repo.status === 'ready' && <CheckCircle2 className="size-3" />}
                    {repo.status === 'failed' && <TriangleAlert className="size-3" />}
                    {STATUS_LABEL[repo.status] ?? repo.status}
                  </Badge>
                )}
              </div>
              <div className="text-sm text-muted">
                {repo
                  ? repo.message
                  : 'Paste a public GitHub, GitLab or Bitbucket link. Base44 and Lovable apps work too: use their "Export to GitHub" button first.'}
              </div>
            </div>
          </div>
          {repo && !showForm && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Change repo
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void call(r => r.disconnectRepo({}), 'Back on the MediClaim demo')}>
                <Unplug /> Disconnect
              </Button>
            </div>
          )}
        </div>

        {repo && repo.status === 'ready' && !compact && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Files read" value={repo.fileCount.toLocaleString('en-US')} />
            <Fact label="Risks found" value={String(repo.findings)} tone={repo.findings > 0 ? 'text-red-600' : undefined} />
            <Fact label="Health" value={`${repo.healthScore}/100`} />
            <Fact label="Audited" value={repo.scannedAt ? ago(tsDate(repo.scannedAt)) : '—'} />
            <div className="col-span-2 text-xs text-muted sm:col-span-4">
              <ScanSearch className="mr-1 inline size-3.5" />
              {repo.languages} · commit <span className="font-mono">{repo.commitSha.slice(0, 7)}</span> ·{' '}
              <a className="underline underline-offset-2" href={repo.url} target="_blank" rel="noreferrer">
                {repo.url.replace('https://', '')}
              </a>
            </div>
          </div>
        )}

        {showForm && (
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="repo-url">Repository link</Label>
              <Input id="repo-url" value={url} onChange={e => setUrl(e.target.value)} placeholder={EXAMPLE} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repo-pass">Owner passcode</Label>
              <Input id="repo-pass" type="password" value={passcode} onChange={e => setPasscode(e.target.value)} placeholder="If asked" autoComplete="off" />
            </div>
            <Button disabled={busy || !url.trim()} onClick={() => void connect()}>
              {busy ? <Loader2 className="animate-spin" /> : <GitBranch />} Connect and audit
            </Button>
            {!repo && (
              <button type="button" className="text-left text-xs text-muted underline underline-offset-2 sm:col-span-3" onClick={() => setUrl(EXAMPLE)}>
                Try it with DVWA, a well-known legacy PHP app
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-navy-50 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-lg font-semibold text-ink ${tone ?? ''}`}>{value}</div>
    </div>
  );
}
