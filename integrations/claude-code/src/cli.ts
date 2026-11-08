#!/usr/bin/env node
// foundation-claude-code: connects Claude Code to Foundation.
//   connect --passcode <owner passcode> [--name "My laptop"]   link this computer to Foundation
//   install [--project <dir>]                                  add Foundation's MCP server + hooks to a project
//   status                                                     print Foundation's budget and wallets
//   hook preflight | hook stop                                 used by Claude Code hooks (reads JSON on stdin)
//   mcp                                                        run the MCP server (used by Claude Code)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_PATH, loadConfig, saveConfig } from './config.js';
import { call, newIdentity, ReducerError, sql, usd } from './stdb.js';
import { readUsage } from './transcript.js';

const CLI_PATH = fileURLToPath(import.meta.url);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function readStdin(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) return {};
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  try {
    return data.trim() ? (JSON.parse(data) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function connect() {
  const passcode = arg('passcode') ?? process.env.FOUNDATION_PASSCODE;
  if (!passcode) throw new Error('Pass --passcode <owner passcode> (the one you use to reset the demo).');
  const c = loadConfig();
  if (!c.token) {
    const id = await newIdentity(c.server);
    c.token = id.token;
  }
  c.name = arg('name') ?? c.name ?? `Claude Code on ${hostname()}`;
  await call(c, 'connect_integration', [passcode, 'claude_code', c.name]);
  saveConfig(c);
  console.log(`Connected "${c.name}" to Foundation (${c.db}).`);
  console.log(`Saved the connection to ${CONFIG_PATH}.`);
  console.log(`Next: node "${CLI_PATH}" install --project <your app folder>`);
}

function mergeJson(path: string, mutate: (o: Record<string, any>) => void) {
  const o = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<string, any>) : {};
  mutate(o);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(o, null, 2) + '\n');
}

function install() {
  const project = resolve(arg('project') ?? process.cwd());
  if (!existsSync(project)) throw new Error(`No such folder: ${project}`);
  const node = JSON.stringify(process.execPath);
  const cli = JSON.stringify(CLI_PATH);
  const hook = (sub: string) => ({ type: 'command', command: `${node} ${cli} hook ${sub}`, timeout: 15 });

  mergeJson(join(project, '.mcp.json'), o => {
    o.mcpServers = { ...(o.mcpServers ?? {}), foundation: { command: process.execPath, args: [CLI_PATH, 'mcp'] } };
  });
  mergeJson(join(project, '.claude', 'settings.json'), o => {
    const hooks = (o.hooks ??= {});
    const add = (event: string, sub: string) => {
      const list: any[] = (hooks[event] ??= []);
      const already = list.some(g => (g.hooks ?? []).some((h: any) => String(h.command ?? '').includes(`hook ${sub}`) && String(h.command).includes('cli.js')));
      if (!already) list.push({ hooks: [hook(sub)] });
    };
    add('UserPromptSubmit', 'preflight');
    add('Stop', 'stop');
    add('SessionEnd', 'stop');
  });
  console.log(`Installed Foundation into ${project}:`);
  console.log('  .mcp.json             MCP server "foundation" (status, audit, recent changes, ask the Translator, request work)');
  console.log('  .claude/settings.json hooks: budget check before each prompt, spend report after each reply');
  console.log('Start Claude Code in that folder and approve the "foundation" MCP server when asked.');
}

async function statusCmd() {
  const c = loadConfig();
  const [b] = await sql(c, 'SELECT * FROM budget');
  const providers = await sql(c, 'SELECT * FROM provider');
  console.log(`Foundation (${c.db})${c.token ? '' : ' - not connected yet'}`);
  if (b) console.log(`Weekly budget: ${usd(b.spent_micros)} of ${usd(b.limit_micros)} used, lock ${b.spend_locked ? 'on' : 'off'}`);
  for (const p of providers) console.log(`  ${String(p.name).padEnd(16)} ${usd(Number(p.balance_micros) - Number(p.reserved_micros)).padStart(8)}  ${p.status}`);
}

/** UserPromptSubmit: exit 2 blocks the prompt and shows stderr to the user. Fails open if Foundation is unreachable. */
async function hookPreflight() {
  await readStdin();
  const c = loadConfig();
  if (!c.token) return;
  try {
    await call(c, 'claude_code_preflight', [Number(process.env.FOUNDATION_PROMPT_ESTIMATE_MICROS || 50_000)]);
  } catch (e) {
    if (e instanceof ReducerError && e.message.startsWith('Foundation paused')) {
      await call(c, 'record_blocked_prompt', [e.message]).catch(() => undefined);
      process.stderr.write(`${e.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`Foundation check skipped: ${(e as Error).message}\n`);
  }
}

/** Stop / SessionEnd: report this session's cumulative usage; Foundation charges only the increase. */
async function hookStop() {
  const input = await readStdin();
  const c = loadConfig();
  const transcript = String(input.transcript_path ?? '');
  const sessionId = String(input.session_id ?? '');
  if (!c.token || !transcript || !sessionId || !existsSync(transcript)) return;
  try {
    const u = readUsage(transcript);
    const project = basename(String(input.cwd ?? process.cwd()));
    await call(c, 'report_external_usage', [sessionId, u.model, project, u.inputTokens, u.outputTokens, u.cacheWriteTokens, u.cacheReadTokens, u.turns]);
  } catch (e) {
    process.stderr.write(`Foundation spend report failed: ${(e as Error).message}\n`);
  }
}

async function main() {
  const [cmd, sub] = process.argv.slice(2);
  if (cmd === 'connect') return connect();
  if (cmd === 'install') return install();
  if (cmd === 'status') return statusCmd();
  if (cmd === 'hook' && sub === 'preflight') return hookPreflight();
  if (cmd === 'hook' && sub === 'stop') return hookStop();
  if (cmd === 'mcp') return (await import('./mcp.js')).runMcp();
  console.log('Usage: foundation-claude-code <connect --passcode P [--name N] | install [--project DIR] | status | hook preflight|stop | mcp>');
}

main().catch(e => {
  process.stderr.write(`${(e as Error).message}\n`);
  process.exit(1);
});
