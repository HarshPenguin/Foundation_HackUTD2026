// Foundation as an MCP server for Claude Code: read the crew's state and findings, ask the
// Translator, and hand work to the crew. Runs over stdio (`node dist/cli.js mcp`).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { call, ReducerError, sql, usd, type Row } from './stdb.js';

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });
const num = (v: unknown) => Number(v ?? 0);
const latest = (rows: Row[], key: string) => [...rows].sort((a, b) => num(b[key]) - num(a[key]));
const when = (micros: unknown) => (micros ? new Date(num(micros) / 1000).toLocaleString() : 'not scheduled');

async function status(): Promise<string> {
  const c = loadConfig();
  const [budget] = await sql(c, 'SELECT * FROM budget');
  const providers = await sql(c, 'SELECT * FROM provider');
  const runs = latest(await sql(c, 'SELECT * FROM run'), 'started_at');
  const employees = await sql(c, 'SELECT * FROM employee');
  const notes = (await sql(c, 'SELECT * FROM notification')).filter(n => !n.resolved);
  const integrations = (await sql(c, "SELECT * FROM integration WHERE kind = 'claude_code'")).filter(i => i.status === 'connected');
  const [settings] = await sql(c, 'SELECT * FROM settings');

  const lines: string[] = [];
  if (budget) {
    lines.push(
      `Weekly budget: ${usd(budget.spent_micros)} spent + ${usd(budget.reserved_micros)} reserved of ${usd(budget.limit_micros)}.` +
        ` Spending lock ${budget.spend_locked ? 'on' : 'off'}.${budget.autonomous_halted ? ' Autonomous work is PAUSED for the week.' : ''}`
    );
  }
  lines.push(`Mode: ${settings?.mode ?? 'unknown'}. Crew ${settings?.worker_online ? 'online' : 'offline'}.`);
  lines.push('Wallets:');
  for (const p of providers) {
    const avail = num(p.balance_micros) - num(p.reserved_micros);
    lines.push(`  - ${p.name} (${p.model}${p.is_simulated ? ', simulated' : ''}): ${usd(avail)} available, stops at ${usd(p.threshold_micros)}, ${p.status}`);
  }
  const cc = integrations.reduce((s, i) => s + num(i.spent_this_week_micros), 0);
  if (integrations.length) lines.push(`Claude Code this week: ${usd(cc)} across ${integrations.reduce((s, i) => s + num(i.sessions_this_week), 0)} sessions.`);
  const manager = employees.find(e => e.role === 'manager' && e.status !== 'fired');
  lines.push(`Next scheduled crew run: ${when(manager?.next_run_at)}.`);
  const last = runs.find(r => r.trigger !== 'chat');
  if (last) lines.push(`Last crew run (#${last.id}, ${last.status}): ${last.summary || 'in progress'}`);
  const onReview = employees.filter(e => e.status === 'on_review').map(e => e.display_name);
  if (onReview.length) lines.push(`On review: ${onReview.join(', ')}.`);
  if (notes.length) lines.push(`Open notifications: ${notes.map(n => n.title).join('; ')}.`);
  return lines.join('\n');
}

export async function runMcp() {
  const server = new McpServer({ name: 'foundation', version: '0.1.0' });

  server.registerTool(
    'foundation_status',
    {
      description:
        "Foundation's current state: weekly AI budget and spending lock, every API wallet (including this Claude Code's), the crew's mode, last and next maintenance run, and open notifications. Check this before starting expensive work.",
    },
    async () => {
      try {
        return text(await status());
      } catch (e) {
        return fail(`Could not reach Foundation: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'foundation_app_audit',
    {
      description:
        "The Auditor's plain-English map of the legacy app Foundation maintains (how it works, its stack, top risks, dead code) plus the Updater's current update plan. Read this before changing the legacy codebase.",
    },
    async () => {
      try {
        const reports = latest(await sql(loadConfig(), 'SELECT * FROM report'), 'at');
        const audit = reports.find(r => r.kind === 'audit');
        const plan = reports.find(r => r.kind === 'update_plan');
        if (!audit && !plan) return text('No audit yet.');
        return text([audit && `# ${audit.title}\n\n${audit.body_md}`, plan && `# ${plan.title}\n\n${plan.body_md}`].filter(Boolean).join('\n\n'));
      } catch (e) {
        return fail(`Could not reach Foundation: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'foundation_recent_changes',
    {
      description: "What the Foundation crew changed in its latest run: each task, its branch, whether the Tester approved it, and optionally the diff.",
      inputSchema: { includeDiffs: z.boolean().optional().describe('Include the code diffs (longer output)') },
    },
    async ({ includeDiffs }) => {
      try {
        const c = loadConfig();
        const runs = latest(await sql(c, 'SELECT * FROM run'), 'started_at').filter(r => r.trigger !== 'chat');
        const run = runs.find(r => r.status !== 'running') ?? runs[0];
        if (!run) return text('The crew has not run yet.');
        const tasks = (await sql(c, `SELECT * FROM task WHERE run_id = ${num(run.id)}`)).filter(t => t.branch);
        const out = [`Run #${run.id} (${run.status}): ${run.summary}`];
        for (const t of tasks) {
          out.push(`- ${t.title} [${t.status}] on branch ${t.branch}, cost ${usd(t.cost_micros)}`);
          if (includeDiffs && t.diff) out.push('```diff\n' + String(t.diff).slice(0, 6000) + '\n```');
        }
        return text(out.join('\n'));
      } catch (e) {
        return fail(`Could not reach Foundation: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'foundation_ask_translator',
    {
      description:
        "Ask Foundation's Translator (the owner's plain-English contact for the AI maintenance crew) a question about the app, the crew, or spending. Waits up to 45 seconds for the reply.",
      inputSchema: { question: z.string().min(1).max(2000) },
    },
    async ({ question }) => {
      const c = loadConfig();
      try {
        const before = new Set((await sql(c, 'SELECT * FROM chat_message')).map(m => String(m.id)));
        await call(c, 'send_chat', [question]);
        const deadline = Date.now() + 45_000; // stay under the MCP client's 60 s request timeout
        let taskId: number | null = null;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          const msgs = await sql(c, 'SELECT * FROM chat_message');
          if (taskId == null) {
            const mine = msgs.find(m => !before.has(String(m.id)) && m.role === 'user' && m.text === question.trim());
            if (mine?.task_id != null) taskId = num(mine.task_id);
          }
          const reply = taskId != null && msgs.find(m => m.role === 'translator' && num(m.task_id) === taskId);
          if (reply) return text(String(reply.text));
        }
        return text('The Translator has not answered yet (the crew may be offline). Try foundation_status.');
      } catch (e) {
        return fail(e instanceof ReducerError ? e.message : `Could not reach Foundation: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    'foundation_request_work',
    {
      description:
        'Hand maintenance work to the Foundation crew: starts a run in which the Manager plans the next fixes, Developers patch on branches, the Tester checks them, and the Purser keeps it inside budget. Returns immediately; use foundation_recent_changes later.',
    },
    async () => {
      try {
        await call(loadConfig(), 'start_run', ['manual']);
        return text('The crew started a run. Watch it live on My Developers, or call foundation_recent_changes in about a minute.');
      } catch (e) {
        return fail(e instanceof ReducerError ? e.message : `Could not reach Foundation: ${(e as Error).message}`);
      }
    }
  );

  await server.connect(new StdioServerTransport());
}
