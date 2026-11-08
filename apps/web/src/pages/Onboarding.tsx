import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  KeyRound,
  Loader2,
  Plus,
  ScanSearch,
  ShieldCheck,
  Trash2,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import { useConn, useDb, type Db } from '@/lib/stdb';
import { cleanError, useToast } from '@/lib/actions';
import { hourLabel, toMicros, usd, WEEKDAY_NAMES } from '@/lib/format';
import { Badge, Card, Input, Label, NativeSelect, Switch } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DbConnection } from '@/module_bindings';
import type { Provider } from '@/module_bindings/types';

// ---------------------------------------------------------------- constants

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'app', label: 'Your app' },
  { id: 'keys', label: 'AI keys' },
  { id: 'chains', label: 'Who does what' },
  { id: 'budget', label: 'Budget' },
  { id: 'review', label: 'Review' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const STACK_OPTIONS = [
  'PHP',
  'jQuery',
  'MySQL',
  'WordPress',
  'React',
  'Node.js',
  'Python',
  'Django',
  'Ruby on Rails',
  'Java',
  '.NET',
  'COBOL',
  'Base44',
  'Lovable',
  'Bolt',
];

const WORRIES = ['Security holes', 'Outdated dependencies', 'Bugs and wrong numbers', 'No tests', 'Slow pages', 'Hard-to-read code'];

const CHAIN_TASKS: { taskType: string; who: string; what: string }[] = [
  { taskType: 'code', who: 'Developers', what: 'Write the fixes' },
  { taskType: 'review', who: 'Tester and Reviewer', what: 'Check every change' },
  { taskType: 'research', who: 'Researcher', what: 'Tracks your stack and what is out of date' },
  { taskType: 'chat', who: 'Translator (talks to you)', what: 'Answers your questions in plain English' },
  { taskType: 'marketing', who: 'Marketer', what: 'Drafts marketing strategies' },
  { taskType: 'general', who: 'Manager, Auditor, reports', what: 'Plans the week and writes your updates' },
];

type Kind = 'maritime' | 'openai_compatible' | 'anthropic';
const KIND_LABEL: Record<string, string> = { maritime: 'Maritime', openai_compatible: 'OpenAI-compatible', anthropic: 'Anthropic' };

type ModelPreset = { id: string; inMicros: number; outMicros: number; est?: boolean };
type ProviderPreset = {
  key: string;
  name: string;
  kind: Kind;
  baseUrl: string;
  needsKey: boolean;
  keyPrefix?: string;
  keyPlaceholder?: string;
  note: string;
  models: ModelPreset[];
  custom?: boolean;
};

// Prices are micro-dollars per 1M tokens. `est` = estimated: confirm on the provider's pricing page.
const PRESETS: ProviderPreset[] = [
  {
    key: 'maritime',
    name: 'Maritime',
    kind: 'maritime',
    baseUrl: '',
    needsKey: false,
    note: "Runs on your Maritime plan's AI credits. No key needed.",
    models: [
      { id: 'gpt-5-mini', inMicros: 250_000, outMicros: 2_000_000 },
      { id: 'gpt-5.5', inMicros: 1_250_000, outMicros: 10_000_000, est: true },
    ],
  },
  {
    key: 'huggingface',
    name: 'Hugging Face',
    kind: 'openai_compatible',
    baseUrl: 'https://router.huggingface.co/v1',
    needsKey: true,
    keyPrefix: 'hf_',
    keyPlaceholder: 'hf_...',
    note: 'Hundreds of open models: Llama, DeepSeek, Qwen, gpt-oss',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct', inMicros: 600_000, outMicros: 600_000, est: true },
      { id: 'deepseek-ai/DeepSeek-V3', inMicros: 500_000, outMicros: 1_500_000, est: true },
      { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', inMicros: 200_000, outMicros: 600_000, est: true },
      { id: 'openai/gpt-oss-120b', inMicros: 150_000, outMicros: 600_000, est: true },
    ],
  },
  {
    key: 'claude',
    name: 'Claude',
    kind: 'anthropic',
    baseUrl: '',
    needsKey: true,
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-...',
    note: "Anthropic's models. Strong at writing and reviewing code.",
    models: [
      { id: 'claude-opus-5-5', inMicros: 4_000_000, outMicros: 20_000_000 },
      { id: 'claude-sonnet-5-5', inMicros: 2_000_000, outMicros: 10_000_000 },
      { id: 'claude-haiku-5-5', inMicros: 100_000, outMicros: 500_000 },
      { id: 'claude-fable-5-1', inMicros: 10_000_000, outMicros: 50_000_000 },
    ],
  },
  {
    key: 'gemini',
    name: 'Gemini',
    kind: 'openai_compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    needsKey: true,
    keyPlaceholder: 'Google AI Studio key',
    note: "Google's models. Fast and inexpensive for research.",
    models: [
      { id: 'gemini-2.5-flash', inMicros: 300_000, outMicros: 2_500_000 },
      { id: 'gemini-2.5-pro', inMicros: 1_250_000, outMicros: 10_000_000, est: true },
    ],
  },
  {
    key: 'openai',
    name: 'OpenAI',
    kind: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-...',
    note: 'GPT models from OpenAI.',
    models: [
      { id: 'gpt-5', inMicros: 1_250_000, outMicros: 10_000_000 },
      { id: 'gpt-5-mini', inMicros: 250_000, outMicros: 2_000_000 },
    ],
  },
  {
    key: 'custom',
    name: '',
    kind: 'openai_compatible',
    baseUrl: '',
    needsKey: true,
    keyPlaceholder: 'Your API key',
    note: 'Any OpenAI-compatible API, for example AIsa, 639Cloud, Deepspace or Groq.',
    models: [],
    custom: true,
  },
];
const PRESET_NAMES = new Set(PRESETS.filter(p => !p.custom).map(p => p.name));
const OTHER_MODEL = '__other__';

const dollars = (micros: number | bigint) => String(Math.round(Number(micros) / 10_000) / 100);
const parseUsd = (s: string) => parseFloat(s.replace(/[$,\s]/g, ''));

// ---------------------------------------------------------------- state shapes

type CardState = {
  enabled: boolean;
  name: string;
  baseUrl: string;
  modelChoice: string; // a preset id or OTHER_MODEL
  customModel: string;
  key: string;
  allowance: string;
  priceIn: string;
  priceOut: string;
  advanced: boolean;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error?: string;
};

function initialCard(p: ProviderPreset, db: Db): CardState {
  const cfg = p.custom ? undefined : db.providerConfigs.find(c => c.name === p.name);
  const presetModel = cfg ? p.models.find(m => m.id === cfg.model) : p.models[0];
  return {
    enabled: false,
    name: p.name,
    baseUrl: cfg?.baseUrl || p.baseUrl,
    modelChoice: p.custom ? OTHER_MODEL : presetModel ? presetModel.id : OTHER_MODEL,
    customModel: cfg && !presetModel ? cfg.model : '',
    key: '',
    allowance: cfg ? dollars(cfg.creditMicros) : '5',
    priceIn: cfg ? dollars(cfg.priceInPerMTok) : presetModel ? dollars(presetModel.inMicros) : '1',
    priceOut: cfg ? dollars(cfg.priceOutPerMTok) : presetModel ? dollars(presetModel.outMicros) : '3',
    advanced: !!p.custom,
    status: 'idle',
  };
}

const modelOf = (c: CardState) => (c.modelChoice === OTHER_MODEL ? c.customModel.trim() : c.modelChoice);

/** Reducer call that returns the error text instead of toasting it, so each step can show it inline. */
function useInlineCall() {
  const conn = useConn();
  return useCallback(
    async (fn: (r: DbConnection['reducers']) => Promise<void>): Promise<string | null> => {
      if (!conn) return 'Not connected to the database yet';
      try {
        await fn(conn.reducers);
        return null;
      } catch (e) {
        return cleanError(e);
      }
    },
    [conn]
  );
}

const providerCost = (p: Provider) => Number(p.priceInPerMTok) + Number(p.priceOutPerMTok);

function chainCandidates(db: Db): Provider[] {
  const ps = db.providers.filter(p => p.name !== 'Claude Code');
  return [...ps.filter(p => !p.isSimulated), ...ps.filter(p => p.isSimulated)];
}

function isClaude(db: Db, p: Provider) {
  return p.name === 'Claude' || db.providerConfigs.some(c => c.name === p.name && c.kind === 'anthropic');
}

/** Real providers first; Claude for code and review; the cheapest real model for research and marketing; then the current chain as backups. */
function suggestChains(db: Db): Record<string, string[]> {
  const candidates = chainCandidates(db);
  const real = candidates.filter(p => !p.isSimulated);
  const cheapestReal = [...real].sort((a, b) => providerCost(a) - providerCost(b));
  const out: Record<string, string[]> = {};
  for (const { taskType } of CHAIN_TASKS) {
    const existing = (db.chains.find(c => c.taskType === taskType)?.providerIds ?? [])
      .map(id => candidates.find(p => p.id === id))
      .filter((p): p is Provider => !!p);
    const order: Provider[] = [];
    if (taskType === 'code' || taskType === 'review') {
      const claude = real.find(p => isClaude(db, p));
      if (claude) order.push(claude);
    }
    if ((taskType === 'research' || taskType === 'marketing') && cheapestReal[0]) order.push(cheapestReal[0]);
    order.push(...existing.filter(p => !p.isSimulated), ...cheapestReal, ...existing.filter(p => p.isSimulated));
    const names: string[] = [];
    for (const p of order) if (!names.includes(p.name)) names.push(p.name);
    out[taskType] = names;
  }
  return out;
}

function guessStack(text: string): string[] {
  const t = text.toLowerCase();
  return STACK_OPTIONS.filter(o => {
    const esc = o.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`).test(t);
  });
}

// ---------------------------------------------------------------- small UI pieces

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#14213a" />
        <path d="M8 22h16M10 18h12M12 14h8M14 10h4" stroke="#f5a524" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-ink">Foundation</span>
    </Link>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
        on ? 'border-navy-800 bg-navy-800 text-white' : 'border-line bg-white text-navy-700 hover:border-navy-200 hover:bg-navy-50'
      )}
    >
      {on && <Check className="size-3.5 text-amber-300" />}
      {children}
    </button>
  );
}

function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

function MoneyField({ id, value, onChange, className }: { id: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
      <Input id={id} className="pl-6 tabular-nums" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function Progress({ step, onJump, maxReached }: { step: number; onJump: (i: number) => void; maxReached: number }) {
  return (
    <div>
      <div className="hidden items-center gap-2 md:flex">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          const reachable = i <= maxReached;
          return (
            <div key={s.id} className="flex flex-1 items-center gap-2 last:flex-none">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onJump(i)}
                className={cn('flex items-center gap-2 rounded-full pr-1 text-sm transition-colors', reachable ? 'hover:text-ink' : 'cursor-default')}
                aria-current={active ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    active ? 'bg-amber-400 text-navy-950 ring-4 ring-amber-100' : done ? 'bg-navy-800 text-white' : 'bg-white text-muted ring-1 ring-inset ring-line'
                  )}
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className={cn('whitespace-nowrap', active ? 'font-semibold text-ink' : done ? 'text-navy-700' : 'text-muted')}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <div className={cn('h-px flex-1', done ? 'bg-navy-700' : 'bg-line')} />}
            </div>
          );
        })}
      </div>
      <div className="md:hidden">
        <div className="flex items-center justify-between text-xs font-medium text-muted">
          <span>
            Step {step + 1} of {STEPS.length}
          </span>
          <span className="text-ink">{STEPS[step].label}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy-100">
          <div className="h-full rounded-full bg-amber-400 transition-[width] duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- step 3: provider card

function ProviderCardEditor({
  preset,
  card,
  onChange,
}: {
  preset: ProviderPreset;
  card: CardState;
  onChange: (patch: Partial<CardState>) => void;
}) {
  const db = useDb();
  const cfg = preset.custom ? undefined : db.providerConfigs.find(c => c.name === preset.name);
  const id = `pv-${preset.key}`;
  const model = preset.models.find(m => m.id === card.modelChoice);
  const keyWarn =
    card.key && preset.keyPrefix && !card.key.trim().startsWith(preset.keyPrefix) ? `${preset.name} keys usually start with ${preset.keyPrefix}` : '';
  const title = preset.custom ? 'Other OpenAI-compatible' : preset.name;
  return (
    <Card className={cn('overflow-hidden transition-shadow', card.enabled && 'border-navy-300 shadow-md ring-1 ring-navy-200')}>
      <label htmlFor={`${id}-on`} className="flex cursor-pointer items-start gap-3 p-4">
        <span
          className={cn(
            'inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold',
            card.enabled ? 'bg-navy-800 text-amber-300' : 'bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-100'
          )}
        >
          {preset.custom ? <Plus className="size-4" /> : preset.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-ink">{title}</span>
            {cfg && (
              <Badge tone="ok">
                <Check className="size-3" /> Connected{cfg.hasKey && cfg.keyLast4 ? ` ••••${cfg.keyLast4}` : ''}
              </Badge>
            )}
            {card.status === 'saved' && !cfg && <Badge tone="ok">Saved</Badge>}
          </div>
          <div className="mt-0.5 text-sm text-muted">{preset.note}</div>
        </div>
        <Switch id={`${id}-on`} checked={card.enabled} onCheckedChange={v => onChange({ enabled: v, status: 'idle', error: undefined })} aria-label={`Use ${title}`} />
      </label>

      {card.enabled && (
        <div className="grid gap-4 border-t border-line bg-navy-50/40 p-4">
          {preset.custom && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Provider name" htmlFor={`${id}-name`}>
                <Input id={`${id}-name`} placeholder="For example Groq" value={card.name} onChange={e => onChange({ name: e.target.value })} />
              </Field>
              <Field label="Base URL" htmlFor={`${id}-url`}>
                <Input id={`${id}-url`} placeholder="https://api.example.com/v1" value={card.baseUrl} onChange={e => onChange({ baseUrl: e.target.value })} />
              </Field>
            </div>
          )}
          {preset.needsKey && (
            <Field
              label="API key"
              htmlFor={`${id}-key`}
              hint={keyWarn || (cfg?.hasKey ? `Leave blank to keep the saved key ••••${cfg.keyLast4}` : undefined)}
            >
              <Input
                id={`${id}-key`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={cfg?.hasKey ? `••••${cfg.keyLast4}` : preset.keyPlaceholder}
                value={card.key}
                onChange={e => onChange({ key: e.target.value })}
              />
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <Field label="Model" htmlFor={`${id}-model`}>
              {preset.custom ? (
                <Input id={`${id}-model`} placeholder="Model name" value={card.customModel} onChange={e => onChange({ customModel: e.target.value })} />
              ) : (
                <div className="grid gap-2">
                  <NativeSelect
                    id={`${id}-model`}
                    className="w-full"
                    value={card.modelChoice}
                    onChange={e => {
                      const m = preset.models.find(x => x.id === e.target.value);
                      onChange(m ? { modelChoice: m.id, priceIn: dollars(m.inMicros), priceOut: dollars(m.outMicros) } : { modelChoice: OTHER_MODEL, advanced: true });
                    }}
                  >
                    {preset.models.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                        {m === preset.models[0] && preset.key === 'claude' ? ' (default)' : ''}
                      </option>
                    ))}
                    <option value={OTHER_MODEL}>Other</option>
                  </NativeSelect>
                  {card.modelChoice === OTHER_MODEL && (
                    <Input aria-label="Model name" placeholder="Model name" value={card.customModel} onChange={e => onChange({ customModel: e.target.value })} />
                  )}
                </div>
              )}
            </Field>
            <Field label="Allowance" htmlFor={`${id}-allow`} hint="Stops when it's spent">
              <MoneyField id={`${id}-allow`} value={card.allowance} onChange={v => onChange({ allowance: v })} />
            </Field>
          </div>
          <div>
            <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-navy-600 hover:underline" onClick={() => onChange({ advanced: !card.advanced })}>
              <ChevronDown className={cn('size-3.5 transition-transform', card.advanced && 'rotate-180')} />
              Advanced: prices
              {!card.advanced && (
                <span className="font-normal text-muted">
                  {' '}
                  · ${card.priceIn} in, ${card.priceOut} out per 1M tokens{model?.est ? ' (estimated)' : ''}
                </span>
              )}
            </button>
            {card.advanced && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="$ per 1M input tokens" htmlFor={`${id}-in`}>
                  <MoneyField id={`${id}-in`} value={card.priceIn} onChange={v => onChange({ priceIn: v })} />
                </Field>
                <Field label="$ per 1M output tokens" htmlFor={`${id}-out`}>
                  <MoneyField id={`${id}-out`} value={card.priceOut} onChange={v => onChange({ priceOut: v })} />
                </Field>
                {model?.est && <div className="col-span-2 text-xs text-muted">These prices are estimated. Check the provider's pricing page.</div>}
              </div>
            )}
          </div>
          {card.status === 'error' && card.error && <ErrorLine>{card.error}</ErrorLine>}
          {card.status === 'saving' && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" /> Saving
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- step 4: chain editor

function ChainEditor({
  task,
  names,
  onChange,
  candidates,
}: {
  task: (typeof CHAIN_TASKS)[number];
  names: string[];
  onChange: (names: string[]) => void;
  candidates: Provider[];
}) {
  const db = useDb();
  const move = (i: number, d: number) => {
    const next = [...names];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const addable = candidates.filter(p => !names.includes(p.name));
  return (
    <Card className="min-w-0 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <div className="text-[15px] font-semibold text-ink">{task.who}</div>
          <div className="text-xs text-muted">{task.what}</div>
        </div>
      </div>
      <ol className="mt-3 grid gap-1.5">
        {names.map((n, i) => {
          const p = candidates.find(x => x.name === n);
          return (
            <li key={n} className={cn('flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2', i === 0 ? 'border-navy-200 bg-navy-50/70' : 'border-line bg-white')}>
              <span className={cn('w-14 shrink-0 text-[10.5px] font-semibold uppercase tracking-wide', i === 0 ? 'text-amber-600' : 'text-muted')}>
                {i === 0 ? 'Primary' : `Backup ${i}`}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-ink">{n}</span>
                  {p?.isSimulated ? <Badge tone="outline">Demo</Badge> : p ? <Badge tone="ok">Real</Badge> : null}
                </div>
                {p && (
                  <div className="truncate font-mono text-[11px] text-muted" title={`${p.model} · ${usd(p.priceInPerMTok)} in, ${usd(p.priceOutPerMTok)} out per 1M tokens`}>
                    {p.model}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center">
                <Button type="button" variant="ghost" size="icon" className="size-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${n} up`}>
                  <ArrowUp />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-7" disabled={i === names.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${n} down`}>
                  <ArrowDown />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-7 text-muted" onClick={() => onChange(names.filter(x => x !== n))} aria-label={`Remove ${n}`}>
                  <X />
                </Button>
              </div>
            </li>
          );
        })}
        {names.length === 0 && <li className="rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted">No provider yet. Your current setup stays in place.</li>}
      </ol>
      {addable.length > 0 && (
        <NativeSelect
          className="mt-2 h-8 w-full max-w-full text-[13px] text-muted"
          value=""
          onChange={e => e.target.value && onChange([...names, e.target.value])}
          aria-label={`Add a backup for ${task.who}`}
        >
          <option value="">Add a backup…</option>
          {addable.map(p => (
            <option key={p.id.toString()} value={p.name}>
              {p.name} ({p.model}){p.isSimulated ? ' · Demo' : ''}
            </option>
          ))}
        </NativeSelect>
      )}
      {db.providers.length === 0 && <div className="mt-2 text-xs text-muted">No providers yet.</div>}
    </Card>
  );
}

// ---------------------------------------------------------------- page

export default function OnboardingPage() {
  const db = useDb();
  const navigate = useNavigate();
  const toast = useToast();
  const run = useInlineCall();
  const [params] = useSearchParams();

  const startStep = Math.max(0, STEPS.findIndex(s => s.id === (params.get('step') as StepId)));
  const [step, setStep] = useState(startStep);
  const [maxReached, setMaxReached] = useState(startStep);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Step 1
  const [passcode, setPasscode] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [signInError, setSignInError] = useState('');

  // Step 2
  const ob = db.onboarding;
  const [appName, setAppName] = useState(() => ob?.appName || db.project?.name || '');
  const [appDescription, setAppDescription] = useState(() => ob?.appDescription ?? '');
  const [stack, setStack] = useState<string[]>(() => guessStack(ob?.stack || db.project?.stackSummary || ''));
  const [stackOther, setStackOther] = useState(() => {
    const known = new Set(guessStack(ob?.stack ?? '').map(s => s.toLowerCase()));
    return (ob?.stack ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s && !known.has(s.toLowerCase()))
      .join(', ');
  });
  const [repoUrl, setRepoUrl] = useState(() => ob?.repoUrl || (/^https?:\/\//.test(db.project?.repoPath ?? '') ? db.project!.repoPath : ''));
  const [priorities, setPriorities] = useState<string[]>(() =>
    ob?.priorities.length ? ob.priorities.filter(p => WORRIES.includes(p)) : ['Security holes', 'Outdated dependencies']
  );

  // Step 3
  const [cards, setCards] = useState<Record<string, CardState>>(() => Object.fromEntries(PRESETS.map(p => [p.key, initialCard(p, db)])));
  const [removing, setRemoving] = useState<string | null>(null);
  const [keysError, setKeysError] = useState('');
  const patchCard = (key: string, patch: Partial<CardState>) => setCards(c => ({ ...c, [key]: { ...c[key], ...patch } }));
  const enabledPresets = PRESETS.filter(p => cards[p.key].enabled);

  // Step 4
  const candidates = useMemo(() => chainCandidates(db), [db]);
  const [chains, setChains] = useState<Record<string, string[]> | null>(null);
  const [chainsTouched, setChainsTouched] = useState(false);

  // Step 5
  const [budget, setBudget] = useState(() => dollars(db.budget?.limitMicros ?? 25_000_000n));
  const [mode, setMode] = useState<'autonomous' | 'manual'>(() => (db.settings?.mode === 'manual' ? 'manual' : 'autonomous'));
  const [crewDay, setCrewDay] = useState(3);
  const [crewHour, setCrewHour] = useState(12);
  const [startFirstRun, setStartFirstRun] = useState(true);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const utcOffsetMinutes = useMemo(() => -new Date().getTimezoneOffset(), []);

  const [submitError, setSubmitError] = useState('');

  // Suggest chains when the owner reaches "Who does what", and again if new providers show up before they edit it.
  useEffect(() => {
    if (STEPS[step].id === 'chains' && !chainsTouched) setChains(suggestChains(db));
  }, [step, chainsTouched, db]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step, done]);

  const go = (i: number) => {
    const n = Math.max(0, Math.min(STEPS.length - 1, i));
    setStep(n);
    setMaxReached(m => Math.max(m, n));
  };

  const stackText = [...stack, ...stackOther.split(',').map(s => s.trim())].filter(Boolean).join(', ');
  const budgetNum = parseUsd(budget);

  // ---- step actions

  const signIn = async () => {
    if (signedIn && !passcode) return go(1);
    setSignInError('');
    if (!passcode) {
      setSignInError('Enter the owner passcode');
      return;
    }
    setBusy(true);
    // MOCK: a shared owner passcode stands in for real login. Real: Supabase Auth mapped to the owner identity.
    const err = await run(r => r.claimOwner({ passcode }));
    setBusy(false);
    if (err) {
      setSignInError(err);
      return;
    }
    setSignedIn(true);
    setPasscode('');
    go(1);
  };

  const saveKeys = async () => {
    setKeysError('');
    if (enabledPresets.length === 0) return go(3);
    // Validate everything first so nothing is half-saved because of a typo.
    let invalid = false;
    for (const p of enabledPresets) {
      const c = cards[p.key];
      const name = c.name.trim();
      const cfg = db.providerConfigs.find(x => x.name === name);
      let error = '';
      if (!name) error = 'Name the provider';
      else if (name === 'Claude Code') error = 'Claude Code is connected from Settings → Integrations';
      else if (p.custom && PRESET_NAMES.has(name)) error = `Use the ${name} card for ${name}`;
      else if (p.kind === 'openai_compatible' && !c.baseUrl.trim().startsWith('https://')) error = 'The base URL must start with https://';
      else if (!modelOf(c)) error = 'Pick a model';
      else if (p.needsKey && !c.key.trim() && !cfg?.hasKey) error = `Paste the API key for ${name}`;
      else if (!(parseUsd(c.allowance) >= 0)) error = 'Enter an allowance in dollars';
      else if (!(parseUsd(c.priceIn) >= 0) || !(parseUsd(c.priceOut) >= 0)) error = 'Enter prices in dollars';
      if (error) {
        invalid = true;
        patchCard(p.key, { status: 'error', error });
      }
    }
    if (invalid) return;

    setBusy(true);
    let failed = 0;
    for (const p of enabledPresets) {
      const c = cards[p.key];
      patchCard(p.key, { status: 'saving', error: undefined });
      const err = await run(r =>
        r.configureProvider({
          name: c.name.trim(),
          kind: p.kind,
          baseUrl: p.kind === 'openai_compatible' ? c.baseUrl.trim() : '',
          model: modelOf(c),
          apiKey: p.needsKey ? c.key.trim() : '',
          creditMicros: toMicros(parseUsd(c.allowance)),
          priceInPerMTok: toMicros(parseUsd(c.priceIn)),
          priceOutPerMTok: toMicros(parseUsd(c.priceOut)),
        })
      );
      if (err) {
        failed++;
        patchCard(p.key, { status: 'error', error: err });
      } else {
        // The key is cleared from memory as soon as it is saved.
        patchCard(p.key, { status: 'saved', enabled: false, key: '' });
      }
    }
    setBusy(false);
    if (failed) {
      setKeysError(failed === enabledPresets.length ? 'Nothing was saved. Fix the cards marked below.' : 'Some providers were saved. Fix the cards marked below.');
      return;
    }
    toast('ok', `${enabledPresets.length === 1 ? 'Provider' : `${enabledPresets.length} providers`} saved`);
    setChainsTouched(false);
    go(3);
  };

  const removeKey = async (name: string) => {
    setRemoving(name);
    const err = await run(r => r.removeProviderKey({ name }));
    setRemoving(null);
    if (err) setKeysError(err);
    else {
      toast('ok', `Removed the ${name} key`);
      setChains(cs => (cs ? Object.fromEntries(Object.entries(cs).map(([k, v]) => [k, v.filter(n => n !== name || PRESET_NAMES.has(n))])) : cs));
      const p = PRESETS.find(x => x.name === name && !x.custom);
      if (p) setCards(c => ({ ...c, [p.key]: { ...initialCard(p, { ...db, providerConfigs: db.providerConfigs.filter(x => x.name !== name) }) } }));
    }
  };

  const finish = async () => {
    setSubmitError('');
    if (!appName.trim()) {
      setSubmitError('Give your app a name on the "Your app" step');
      return;
    }
    if (!(budgetNum >= 0)) {
      setSubmitError('Enter a weekly budget in dollars');
      return;
    }
    const finalChains = chains ?? suggestChains(db);
    setBusy(true);
    const err = await run(r =>
      r.completeOnboarding({
        appName: appName.trim(),
        appDescription: appDescription.trim(),
        stack: stackText,
        repoUrl: repoUrl.trim(),
        priorities,
        mode,
        weeklyBudgetMicros: toMicros(budgetNum),
        crewDay,
        crewHour,
        timezone,
        utcOffsetMinutes,
        chains: CHAIN_TASKS.map(t => ({ taskType: t.taskType, providerNames: finalChains[t.taskType] ?? [] })).filter(c => c.providerNames.length > 0),
        startFirstRun,
      })
    );
    setBusy(false);
    if (err) {
      setSubmitError(err);
      return;
    }
    setDone(true);
  };

  const next = () => {
    switch (STEPS[step].id) {
      case 'welcome':
        return void signIn();
      case 'app':
        if (!appName.trim()) return;
        return go(2);
      case 'keys':
        return void saveKeys();
      case 'review':
        return void finish();
      default:
        return go(step + 1);
    }
  };

  const nextLabel = (() => {
    switch (STEPS[step].id) {
      case 'welcome':
        return signedIn && !passcode ? 'Continue' : 'Sign in and continue';
      case 'keys':
        return enabledPresets.length ? `Save ${enabledPresets.length === 1 ? enabledPresets[0].name || 'provider' : `${enabledPresets.length} providers`} and continue` : 'Continue';
      case 'review':
        return 'Set up my crew';
      default:
        return 'Continue';
    }
  })();
  const nextDisabled = busy || (STEPS[step].id === 'app' && !appName.trim());

  // ---- render

  if (done) return <Success crewDay={crewDay} crewHour={crewHour} startFirstRun={startFirstRun} mode={mode} budget={budgetNum} onHome={() => navigate('/')} />;

  const realCount = candidates.filter(p => !p.isSimulated).length;

  return (
    <div className="flex min-h-full flex-col bg-canvas bg-[radial-gradient(1200px_500px_at_90%_-10%,rgba(245,165,36,0.10),transparent),radial-gradient(900px_500px_at_-10%_0%,rgba(28,43,71,0.08),transparent)]">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 pt-5 sm:px-6">
        <Logo />
        <Link to="/" className="text-sm font-medium text-muted hover:text-ink">
          Exit setup
        </Link>
      </header>
      <div className="mx-auto w-full max-w-4xl px-4 pt-6 sm:px-6">
        <Progress step={step} onJump={go} maxReached={maxReached} />
      </div>

      <main key={step} className="animate-fade-up mx-auto w-full max-w-3xl flex-1 px-4 pb-12 pt-8 sm:px-6">
        {STEPS[step].id === 'welcome' && (
          <>
            <div className="mb-6 overflow-hidden rounded-3xl bg-navy-900 p-6 text-white shadow-lg sm:p-8">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">Set up your crew in 3 minutes</div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Welcome to Foundation</h1>
              <p className="mt-2 max-w-xl text-[15px] text-navy-100">
                Foundation is a team of AI employees that understands, repairs and modernizes your older or AI-built app, on a schedule and budget you set.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  { icon: ScanSearch, t: 'Understands your code', d: 'Explains what is risky in plain English' },
                  { icon: Wrench, t: 'Fixes on a schedule', d: 'Weekly runs, every change tested' },
                  { icon: Wallet, t: 'Never overspends', d: 'Hard limits on every AI key' },
                ].map(f => (
                  <div key={f.t} className="rounded-2xl bg-white/5 p-3 ring-1 ring-inset ring-white/10">
                    <f.icon className="size-5 text-amber-300" />
                    <div className="mt-2 text-sm font-semibold">{f.t}</div>
                    <div className="text-xs text-navy-200">{f.d}</div>
                  </div>
                ))}
              </div>
            </div>
            <Card className="p-5">
              <form
                onSubmit={e => {
                  e.preventDefault();
                  void signIn();
                }}
                className="grid gap-3"
              >
                <Field label="Owner passcode" htmlFor="ob-passcode" hint="Only the owner can connect AI keys and change the crew's setup.">
                  <Input
                    id="ob-passcode"
                    type="password"
                    autoComplete="off"
                    placeholder={signedIn ? 'Signed in' : 'Owner passcode'}
                    value={passcode}
                    onChange={e => setPasscode(e.target.value)}
                    autoFocus
                  />
                </Field>
                {signedIn && (
                  <div className="flex items-center gap-2 text-sm text-emerald-700">
                    <CheckCircle2 className="size-4" /> Signed in as the owner on this browser
                  </div>
                )}
                {signInError && <ErrorLine>{signInError}</ErrorLine>}
                <button type="submit" className="hidden" />
              </form>
            </Card>
          </>
        )}

        {STEPS[step].id === 'app' && (
          <>
            <StepHeading title="Tell us about your app" subtitle="Your crew uses this to decide what to look at first." />
            <Card className="grid gap-5 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="App name" htmlFor="ob-name">
                  <Input id="ob-name" value={appName} onChange={e => setAppName(e.target.value)} placeholder="MediClaim" />
                </Field>
                <Field label="Repository URL (optional)" htmlFor="ob-repo">
                  <Input id="ob-repo" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/you/app" inputMode="url" />
                </Field>
              </div>
              <Field label="What does it do?" htmlFor="ob-desc" hint="One line is plenty.">
                <Input id="ob-desc" value={appDescription} onChange={e => setAppDescription(e.target.value)} placeholder="Patients submit insurance claims and track their refunds" />
              </Field>
              <div className="grid gap-2">
                <Label>What is it built with?</Label>
                <div className="flex flex-wrap gap-2">
                  {STACK_OPTIONS.map(o => (
                    <Chip key={o} on={stack.includes(o)} onClick={() => setStack(s => (s.includes(o) ? s.filter(x => x !== o) : [...s, o]))}>
                      {o}
                    </Chip>
                  ))}
                </div>
                <Input aria-label="Other technologies" className="mt-1 sm:max-w-sm" value={stackOther} onChange={e => setStackOther(e.target.value)} placeholder="Other (type it)" />
              </div>
              <div className="grid gap-2">
                <Label>What worries you most?</Label>
                <div className="flex flex-wrap gap-2">
                  {WORRIES.map(o => (
                    <Chip key={o} on={priorities.includes(o)} onClick={() => setPriorities(s => (s.includes(o) ? s.filter(x => x !== o) : [...s, o]))}>
                      {o}
                    </Chip>
                  ))}
                </div>
              </div>
            </Card>
          </>
        )}

        {STEPS[step].id === 'keys' && (
          <>
            <StepHeading title="Which AI providers do you have?" subtitle="Turn on the ones you use. Each key gets its own allowance, and your crew stops before it runs out." />
            <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-navy-100 bg-white px-4 py-3 text-sm text-navy-700">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <span>Keys go to a private table only your crew can read. They never come back to this browser.</span>
            </div>
            {db.providerConfigs.length > 0 && (
              <Card className="mb-4 p-4">
                <div className="mb-2 text-sm font-semibold text-ink">Already connected</div>
                <ul className="grid gap-1.5">
                  {db.providerConfigs.map(c => (
                    <li key={c.name} className="flex min-w-0 items-center gap-x-3 rounded-xl border border-line px-3 py-2">
                      <KeyRound className="size-4 text-navy-400" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="font-medium text-ink">{c.name}</span>
                          <Badge tone="outline">{KIND_LABEL[c.kind] ?? c.kind}</Badge>
                        </div>
                        <div className="truncate text-xs text-muted">
                          <span className="font-mono">{c.model}</span> · {c.kind === 'maritime' ? 'Maritime plan credits' : c.hasKey ? `Key ••••${c.keyLast4}` : 'No key'} · {usd(c.creditMicros)} allowance
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="shrink-0 text-muted" disabled={removing === c.name} onClick={() => void removeKey(c.name)}>
                        {removing === c.name ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {keysError && <div className="mb-4"><ErrorLine>{keysError}</ErrorLine></div>}
            <div className="grid gap-3">
              {PRESETS.map(p => (
                <ProviderCardEditor key={p.key} preset={p} card={cards[p.key]} onChange={patch => patchCard(p.key, patch)} />
              ))}
            </div>
            <p className="mt-4 text-center text-xs text-muted">No keys yet? Continue. Your crew can practice on demo wallets.</p>
          </>
        )}

        {STEPS[step].id === 'chains' && (
          <>
            <StepHeading
              title="Who does what"
              subtitle="Pick which AI each employee uses first, and who takes over when it runs out. We suggested an order: real keys first."
            />
            {realCount === 0 && (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                You haven't connected a real key yet, so your crew uses demo wallets. You can add keys later from My Finances.
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {CHAIN_TASKS.map(t => (
                <ChainEditor
                  key={t.taskType}
                  task={t}
                  candidates={candidates}
                  names={chains?.[t.taskType] ?? []}
                  onChange={names => {
                    setChainsTouched(true);
                    setChains(cs => ({ ...(cs ?? {}), [t.taskType]: names }));
                  }}
                />
              ))}
            </div>
            {chainsTouched && (
              <div className="mt-3 text-right">
                <Button variant="link" size="sm" onClick={() => setChainsTouched(false)}>
                  Use the suggested order
                </Button>
              </div>
            )}
          </>
        )}

        {STEPS[step].id === 'budget' && (
          <>
            <StepHeading title="Budget and schedule" subtitle="Set a weekly ceiling and when the crew does its maintenance run." />
            <div className="grid gap-4">
              <Card className="grid gap-4 p-5 sm:grid-cols-[200px_1fr] sm:items-center">
                <Field label="Weekly budget" htmlFor="ob-budget">
                  <MoneyField id="ob-budget" value={budget} onChange={setBudget} />
                </Field>
                <p className="text-sm text-muted">Across every AI key. When the week's budget is used up, autonomous work pauses until next week.</p>
              </Card>
              <Card className="p-5">
                <div className="mb-3 text-sm font-semibold text-ink">When a provider runs out</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { k: 'autonomous' as const, t: 'Autonomous (recommended)', d: 'Switches to the next AI on the list and keeps working.' },
                    { k: 'manual' as const, t: 'Manual', d: 'Pauses and asks you to switch or upgrade.' },
                  ].map(o => (
                    <label
                      key={o.k}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:bg-navy-50/50 has-[:checked]:border-navy-300 has-[:checked]:bg-navy-50"
                    >
                      <input type="radio" name="ob-mode" className="mt-1 accent-[#1c2b47]" checked={mode === o.k} onChange={() => setMode(o.k)} />
                      <div>
                        <div className="text-sm font-medium text-ink">{o.t}</div>
                        <div className="text-xs text-muted">{o.d}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </Card>
              <Card className="p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                  <Clock className="size-4 text-amber-500" /> Weekly crew run
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Day" htmlFor="ob-day">
                    <NativeSelect id="ob-day" value={crewDay} onChange={e => setCrewDay(Number(e.target.value))}>
                      {WEEKDAY_NAMES.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Time" htmlFor="ob-hour">
                    <NativeSelect id="ob-hour" value={crewHour} onChange={e => setCrewHour(Number(e.target.value))}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {hourLabel(h)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <div className="pb-2 text-xs text-muted">Your time zone: {timezone}</div>
                </div>
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <input type="checkbox" className="mt-1 accent-[#e08a0b]" checked={startFirstRun} onChange={e => setStartFirstRun(e.target.checked)} />
                  <div>
                    <div className="text-sm font-medium text-ink">Start the first maintenance run now</div>
                    <div className="text-xs text-muted">The Manager reads your app and plans the first fixes right after setup.</div>
                  </div>
                </label>
              </Card>
            </div>
          </>
        )}

        {STEPS[step].id === 'review' && (
          <>
            <StepHeading title="Review and finish" subtitle="Check everything once. You can change any of this later in Settings." />
            <div className="grid gap-3">
              <ReviewBlock title="Your app" onEdit={() => go(1)}>
                <div className="font-medium text-ink">{appName || 'No name yet'}</div>
                {appDescription && <div className="text-muted">{appDescription}</div>}
                <div className="mt-1 text-muted">{stackText || 'Stack not set'}</div>
                {repoUrl && <div className="truncate font-mono text-xs text-muted">{repoUrl}</div>}
                {priorities.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {priorities.map(p => (
                      <Badge key={p} tone="warn">
                        {p}
                      </Badge>
                    ))}
                  </div>
                )}
              </ReviewBlock>
              <ReviewBlock title="AI keys" onEdit={() => go(2)}>
                {db.providerConfigs.length ? (
                  <ul className="grid gap-1">
                    {db.providerConfigs.map(c => (
                      <li key={c.name} className="flex flex-wrap items-center gap-x-2">
                        <span className="font-medium text-ink">{c.name}</span>
                        <span className="font-mono text-xs text-muted">{c.model}</span>
                        <span className="text-xs text-muted">
                          · {c.kind === 'maritime' ? 'plan credits' : `••••${c.keyLast4}`} · {usd(c.creditMicros)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-muted">No real keys. Your crew uses demo wallets.</div>
                )}
              </ReviewBlock>
              <ReviewBlock title="Who does what" onEdit={() => go(3)}>
                <ul className="grid gap-1">
                  {CHAIN_TASKS.map(t => {
                    const names = (chains ?? suggestChains(db))[t.taskType] ?? [];
                    return (
                      <li key={t.taskType} className="flex flex-wrap gap-x-2">
                        <span className="text-muted">{t.who}:</span>
                        <span className="text-ink">{names.length ? names.join(' → ') : 'unchanged'}</span>
                      </li>
                    );
                  })}
                </ul>
              </ReviewBlock>
              <ReviewBlock title="Budget and schedule" onEdit={() => go(4)}>
                <div className="text-ink">
                  {Number.isFinite(budgetNum) ? usd(toMicros(budgetNum)) : '—'} a week · {mode === 'manual' ? 'Manual' : 'Autonomous'}
                </div>
                <div className="text-muted">
                  {WEEKDAY_NAMES[crewDay]}s at {hourLabel(crewHour)} ({timezone})
                  {startFirstRun ? ' · first run starts now' : ''}
                </div>
              </ReviewBlock>
              {submitError && <ErrorLine>{submitError}</ErrorLine>}
            </div>
          </>
        )}
      </main>

      <footer className="sticky bottom-0 z-20 border-t border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Button variant="ghost" onClick={() => go(step - 1)} disabled={step === 0 || busy}>
            <ArrowLeft /> Back
          </Button>
          <div className="flex items-center gap-2">
            {STEPS[step].id === 'welcome' && !signedIn && (
              <Button variant="ghost" className="hidden text-muted sm:inline-flex" onClick={() => go(1)} disabled={busy} title="If this browser already signed in as the owner">
                Already signed in
              </Button>
            )}
            <Button variant={STEPS[step].id === 'review' ? 'accent' : 'default'} size="lg" onClick={next} disabled={nextDisabled}>
              {busy && <Loader2 className="animate-spin" />}
              {nextLabel}
              {!busy && STEPS[step].id !== 'review' && <ArrowRight />}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ReviewBlock({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
        <Button variant="link" size="xs" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <div className="text-sm">{children}</div>
    </Card>
  );
}

function Success({
  crewDay,
  crewHour,
  startFirstRun,
  mode,
  budget,
  onHome,
}: {
  crewDay: number;
  crewHour: number;
  startFirstRun: boolean;
  mode: string;
  budget: number;
  onHome: () => void;
}) {
  const db = useDb();
  const steps = [
    startFirstRun
      ? { t: 'The first run starts now', d: 'The Manager reads your app, the Auditor explains what is risky, and the Developers start on the top fixes.' }
      : { t: 'Start a run whenever you like', d: 'Ask the Translator on Home, or press Run now on My Developers.' },
    { t: `Every ${WEEKDAY_NAMES[crewDay]} at ${hourLabel(crewHour)}`, d: 'Your crew does its weekly maintenance run on its own.' },
    {
      t: `Spending stays under ${Number.isFinite(budget) ? usd(toMicros(budget), 0) : 'your budget'} a week`,
      d: mode === 'manual' ? 'If a provider runs out, the crew pauses and asks you to switch or upgrade.' : 'If a provider runs out, the crew switches to the next AI on the list.',
    },
    { t: 'You get a plain-English update', d: 'The Communicator writes it on My Communications after each week.' },
  ];
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-canvas bg-[radial-gradient(900px_500px_at_50%_-10%,rgba(245,165,36,0.14),transparent)] px-4 py-10">
      <div className="animate-fade-up w-full max-w-xl">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-navy-900 text-amber-300 shadow-lg">
          <Check className="size-7" />
        </div>
        <h1 className="text-center text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Your crew is set up</h1>
        <p className="mt-2 text-center text-[15px] text-muted">Here's what happens next for {db.project?.name ?? 'your app'}.</p>
        <Card className="mt-6 p-2">
          <ol>
            {steps.map((s, i) => (
              <li key={s.t} className="flex gap-3 rounded-xl p-3">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700">{i + 1}</span>
                <div>
                  <div className="text-sm font-semibold text-ink">{s.t}</div>
                  <div className="text-sm text-muted">{s.d}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <div className="mt-6 flex flex-col-reverse items-stretch justify-center gap-2 sm:flex-row">
          <Button variant="outline" size="lg" asChild>
            <Link to="/developers">Watch My Developers</Link>
          </Button>
          <Button variant="accent" size="lg" onClick={onHome}>
            Go to Home <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
