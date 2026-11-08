// Sums token usage from a Claude Code transcript (JSONL). Streaming writes several lines per
// assistant message, so usage is de-duplicated by message id (keeping the largest numbers).
import { readFileSync } from 'node:fs';

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  turns: number;
}

interface Line {
  type?: string;
  isSidechain?: boolean;
  message?: {
    id?: string;
    model?: string;
    content?: unknown;
    usage?: Record<string, number | undefined>;
  };
}

export function readUsage(path: string): Usage {
  const byId = new Map<string, { i: number; o: number; cw: number; cr: number }>();
  let model = '';
  let turns = 0;
  let anon = 0;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    if (!raw.trim()) continue;
    let l: Line;
    try {
      l = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    if (l.type === 'user' && !l.isSidechain && typeof l.message?.content === 'string') turns++;
    const u = l.message?.usage;
    if (l.type !== 'assistant' || !u) continue;
    const m = l.message?.model ?? '';
    if (m && !m.startsWith('<')) model = m;
    const id = l.message?.id ?? `anon-${anon++}`;
    const cur = {
      i: u.input_tokens ?? 0,
      o: u.output_tokens ?? 0,
      cw: u.cache_creation_input_tokens ?? 0,
      cr: u.cache_read_input_tokens ?? 0,
    };
    const prev = byId.get(id);
    byId.set(
      id,
      prev
        ? { i: Math.max(prev.i, cur.i), o: Math.max(prev.o, cur.o), cw: Math.max(prev.cw, cur.cw), cr: Math.max(prev.cr, cur.cr) }
        : cur
    );
  }
  const total = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
  for (const v of byId.values()) {
    total.inputTokens += v.i;
    total.outputTokens += v.o;
    total.cacheWriteTokens += v.cw;
    total.cacheReadTokens += v.cr;
  }
  return { model: model || 'claude-opus-5-5', turns, ...total };
}
