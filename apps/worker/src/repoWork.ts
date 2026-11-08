// Work on the owner's connected repo (not the MediClaim demo): plan from real scanner findings,
// patch on branches inside the crew's clone, and verify with lint + a re-scan.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Db } from './db';
import { parseJson } from './db';
import { env } from './env';
import { scanFile, scanRepo, type Finding } from './scanner';
import { cloneOwnerRepo, git, withRepoLock } from './workspace';

const run = promisify(execFile);

export interface RepoFix {
  url: string;
  file: string;
  line: number;
  title: string;
  why: string;
  snippet: string;
}

export function connectedRepo(db: Db) {
  const r = db.conn.db.repo.id.find(0);
  return r && r.status === 'ready' ? r : undefined;
}

export function repoFixOf(input: string): RepoFix | undefined {
  return parseJson<{ repoFix?: RepoFix }>(input)?.repoFix;
}

export function cloneDir(url: string) {
  const slug = url.replace(/\.git$/, '').split('/').slice(-2).join('__').replace(/[^A-Za-z0-9_.-]/g, '_');
  return join(env.workspaceDir, 'repos', slug);
}

/** The crew's clone of the repo, re-cloned if the machine lost it. Leaves it on its base commit. */
export async function ensureClone(url: string): Promise<string> {
  const dir = cloneDir(url);
  if (!existsSync(join(dir, '.git'))) await cloneOwnerRepo(url);
  await git(['config', 'user.name', 'Foundation crew'], dir);
  await git(['config', 'user.email', 'crew@foundation.local'], dir);
  await git(['config', 'commit.gpgsign', 'false'], dir);
  return dir;
}

const SECURITY = /injection|XSS|evaluated|included|secret/i;

/** The Manager's plan for a connected repo: the top distinct risks, split between the two Developers. */
export async function planRepoFixes(url: string, already: Set<string>): Promise<Array<{ developer: string; fix: RepoFix }>> {
  const dir = await ensureClone(url);
  const scan = scanRepo(dir);
  const picked: Finding[] = [];
  for (const f of scan.findings) {
    if (picked.length >= 2) break;
    if (picked.some(p => p.title === f.title) || already.has(`${f.file}:${f.title}`)) continue;
    if (f.file === 'package.json') continue;
    picked.push(f);
  }
  return picked.map(f => ({
    developer: SECURITY.test(f.title) ? 'Dev-Security' : 'Dev-Upgrades',
    fix: { url, file: f.file, line: f.line, title: f.title, why: f.why, snippet: f.snippet },
  }));
}

export function readRepoFile(url: string, file: string): string {
  return readFileSync(join(cloneDir(url), file), 'utf8');
}

/** A concrete, written-up fix for when no AI model is connected. */
export function fixProposal(f: RepoFix): string {
  const how: Array<[RegExp, string]> = [
    [/SQL injection/i, 'Replace the string-built query with a prepared statement (PDO `prepare` + `execute` with bound parameters), and cast numeric IDs with `(int)`.'],
    [/command injection/i, 'Never pass user input to the shell. Validate it against a strict pattern (for example an IP address) and wrap it in `escapeshellarg()`, or use a library call instead of a shell command.'],
    [/XSS/i, 'Escape every value before it reaches the page with `htmlspecialchars($value, ENT_QUOTES, \'UTF-8\')`.'],
    [/evaluated/i, 'Remove `eval`. Parse the data explicitly (for example `JSON.parse` / `json_decode`) or look the action up in a fixed list.'],
    [/secret/i, 'Move the secret to an environment variable (`getenv(\'DB_PASSWORD\')`) and rotate it, since it has been in the code.'],
    [/hashing/i, 'Use `password_hash()` to store passwords and `password_verify()` to check them, then re-hash on next login.'],
    [/mysql_/i, 'Switch from `mysql_*` to PDO or `mysqli`, which also makes prepared statements possible.'],
    [/included/i, 'Only include files from a fixed allow-list, never a path built from user input.'],
    [/jQuery/i, 'Upgrade jQuery to 3.7.1 and replace removed calls like `.live()` with `.on()`.'],
  ];
  const step = how.find(([re]) => re.test(f.title))?.[1] ?? 'Rewrite this line to stop trusting user input.';
  return `**${f.title}** in \`${f.file}:${f.line}\`\n\n\`${f.snippet}\`\n\n${f.why}\n\n**Fix:** ${step}`;
}

/** Commits the new file content on a fresh branch from the clone's base commit. */
export function commitRepoFix(url: string, slug: string, file: string, content: string, message: string) {
  return withRepoLock(async () => {
    const dir = await ensureClone(url);
    const base = (await git(['rev-parse', 'HEAD'], dir)).trim();
    const branch = `foundation/${slug}`;
    await git(['checkout', '-q', '-B', branch, base], dir);
    try {
      writeFileSync(join(dir, file), content.endsWith('\n') ? content : `${content}\n`);
      await git(['add', '--', file], dir);
      await git(['commit', '-q', '-m', message], dir);
      const diff = await git(['diff', `${base}..${branch}`], dir);
      const stat = await git(['diff', '--numstat', `${base}..${branch}`], dir);
      const [added, removed] = stat.trim().split(/\s+/).map(Number);
      return { branch, base, diff, added: added || 0, removed: removed || 0 };
    } finally {
      await git(['checkout', '-q', '--detach', base], dir).catch(() => undefined);
    }
  });
}

async function lint(dir: string, file: string): Promise<{ ok: boolean; tool: string; message: string }> {
  const abs = join(dir, file);
  const tool = file.endsWith('.php') || file.endsWith('.inc') ? ['php', ['-l', abs]] : file.endsWith('.js') ? [process.execPath, ['--check', abs]] : undefined;
  if (!tool) return { ok: true, tool: 'no linter for this file type', message: '' };
  try {
    await run(tool[0] as string, tool[1] as string[], { timeout: 20_000 });
    return { ok: true, tool: tool[0] === 'php' ? 'php -l' : 'node --check', message: '' };
  } catch (e) {
    const out = `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}`.split('\n').find(Boolean) ?? 'syntax error';
    return { ok: false, tool: tool[0] === 'php' ? 'php -l' : 'node --check', message: out.slice(0, 160) };
  }
}

/** The Tester's check: lint the changed file and confirm the scanner no longer finds the risk there. */
export function verifyRepoFix(url: string, branch: string, f: RepoFix) {
  return withRepoLock(async () => {
    const dir = await ensureClone(url);
    const base = (await git(['rev-parse', 'HEAD'], dir)).trim();
    await git(['checkout', '-q', branch], dir);
    try {
      const l = await lint(dir, f.file);
      const still = scanFile(dir, f.file).filter(x => x.title === f.title);
      return { lint: l, stillThere: still.length, ok: l.ok && still.length === 0 };
    } finally {
      await git(['checkout', '-q', '--detach', base], dir).catch(() => undefined);
    }
  });
}
