// Minimal SpacetimeDB HTTP client: identities, reducer calls, SQL. No SDK, so hooks start fast.
import type { Config } from './config.js';

export class ReducerError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

const TIMEOUT_MS = Number(process.env.FOUNDATION_TIMEOUT_MS || 8000);

function http(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

export async function newIdentity(server: string): Promise<{ identity: string; token: string }> {
  const r = await http(`${server}/v1/identity`, { method: 'POST' });
  if (!r.ok) throw new Error(`Could not create an identity on ${server} (HTTP ${r.status})`);
  return (await r.json()) as { identity: string; token: string };
}

function headers(c: Config): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (c.token) h.Authorization = `Bearer ${c.token}`;
  return h;
}

/** Calls a reducer by its database name (snake_case) with positional args. Throws ReducerError on refusal. */
export async function call(c: Config, reducer: string, args: unknown[]): Promise<void> {
  const r = await http(`${c.server}/v1/database/${c.db}/call/${reducer}`, {
    method: 'POST',
    headers: headers(c),
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new ReducerError(r.status, (await r.text()).trim() || `HTTP ${r.status}`);
}

export type Row = Record<string, unknown>;

// SQL results are encoded by type: options as [0, value] / [1, []], timestamps and
// identities as one-field products ([micros]). Decode using the schema that comes with them.
type AlgType = {
  Sum?: { variants: Array<{ name?: { some?: string }; algebraic_type: AlgType }> };
  Product?: { elements: Array<{ name?: { some?: string }; algebraic_type: AlgType }> };
  Array?: AlgType;
  [k: string]: unknown;
};

function decode(v: unknown, t: AlgType | undefined): unknown {
  if (!t) return v;
  if (t.Sum && Array.isArray(v)) {
    const variants = t.Sum.variants;
    const isOption = variants.length === 2 && variants[0].name?.some === 'some' && variants[1].name?.some === 'none';
    if (isOption) return v[0] === 0 ? decode(v[1], variants[0].algebraic_type) : null;
    const variant = variants[v[0] as number];
    return { tag: variant?.name?.some ?? v[0], value: decode(v[1], variant?.algebraic_type) };
  }
  if (t.Product && Array.isArray(v)) {
    const els = t.Product.elements;
    const special = els.length === 1 ? els[0].name?.some ?? '' : '';
    if (special.startsWith('__timestamp')) return Number(v[0]);
    if (special.startsWith('__')) return v[0];
    return Object.fromEntries(els.map((e, i) => [e.name?.some ?? String(i), decode(v[i], e.algebraic_type)]));
  }
  if (t.Array && Array.isArray(v)) return v.map(x => decode(x, t.Array));
  return v;
}

export async function sql(c: Config, query: string): Promise<Row[]> {
  const r = await http(`${c.server}/v1/database/${c.db}/sql`, { method: 'POST', headers: headers(c), body: query });
  if (!r.ok) throw new Error(`SQL failed (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`);
  const out = (await r.json()) as Array<{
    schema: { elements: Array<{ name: { some?: string }; algebraic_type: AlgType }> };
    rows: unknown[][];
  }>;
  const first = out[0];
  if (!first) return [];
  const cols = first.schema.elements.map((e, i) => ({ name: e.name.some ?? `col${i}`, type: e.algebraic_type }));
  return first.rows.map(row => Object.fromEntries(row.map((v, i) => [cols[i].name, decode(v, cols[i].type)])));
}

export function usd(micros: unknown): string {
  return `$${(Math.round(Number(micros) / 10_000) / 100).toFixed(2)}`;
}
