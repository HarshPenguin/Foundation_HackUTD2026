import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { env } from './env';

const run = promisify(execFile);

export const repoDir = () => join(env.workspaceDir, 'mediclaim');
const worktreesDir = () => join(env.workspaceDir, 'worktrees');

export async function git(args: string[], cwd = repoDir()): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return stdout;
}

/** One git operation at a time on the shared repo (worktrees share refs and config). */
let chain: Promise<unknown> = Promise.resolve();
export function withRepoLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/** First use: copy legacy-demo into the workspace and make a baseline commit on main. */
export async function ensureRepo(): Promise<string> {
  const dir = repoDir();
  if (existsSync(join(dir, '.git'))) return dir;
  return withRepoLock(async () => {
    if (existsSync(join(dir, '.git'))) return dir;
    if (!existsSync(env.legacyDemoDir)) throw new Error(`legacy-demo not found at ${env.legacyDemoDir}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    cpSync(env.legacyDemoDir, dir, { recursive: true });
    await git(['init', '-q', '-b', 'main'], dir);
    await git(['config', 'user.name', 'Foundation crew'], dir);
    await git(['config', 'user.email', 'crew@foundation.local'], dir);
    await git(['config', 'commit.gpgsign', 'false'], dir);
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '-m', 'MediClaim baseline (imported by Foundation)'], dir);
    return dir;
  });
}

export async function readMainFile(file: string): Promise<string> {
  await ensureRepo();
  return git(['show', `main:${file}`]);
}

async function branchExists(branch: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export interface BranchResult {
  branch: string;
  diff: string;
  added: number;
  removed: number;
}

/** Creates foundation/<slug> from main with one file replaced, commits it, and returns the diff against main. */
export async function commitFixOnBranch(slug: string, taskId: bigint, file: string, content: string, message: string): Promise<BranchResult> {
  await ensureRepo();
  return withRepoLock(async () => {
    let branch = `foundation/${slug}`;
    if (await branchExists(branch)) branch = `foundation/${slug}-${taskId}`;
    const wt = join(worktreesDir(), `dev-${taskId}`);
    rmSync(wt, { recursive: true, force: true });
    await git(['worktree', 'prune']);
    mkdirSync(worktreesDir(), { recursive: true });
    await git(['worktree', 'add', '-q', '-b', branch, wt, 'main']);
    try {
      writeFileSync(join(wt, file), content);
      await git(['add', '--', file], wt);
      await git(['commit', '-q', '--allow-empty', '-m', message], wt);
    } finally {
      await git(['worktree', 'remove', '--force', wt]).catch(() => undefined);
    }
    const diff = await git(['diff', '--src-prefix=a/legacy-demo/', '--dst-prefix=b/legacy-demo/', `main...${branch}`]);
    const stat = await git(['diff', '--numstat', `main...${branch}`]);
    let added = 0;
    let removed = 0;
    for (const line of stat.trim().split('\n')) {
      const [a, r] = line.split('\t');
      added += Number(a) || 0;
      removed += Number(r) || 0;
    }
    return { branch, diff, added, removed };
  });
}

/** Checks out a branch into its own worktree for the Tester. Call the returned cleanup when done. */
export async function checkoutForReview(branch: string, taskId: bigint): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  await ensureRepo();
  return withRepoLock(async () => {
    const wt = join(worktreesDir(), `review-${taskId}`);
    rmSync(wt, { recursive: true, force: true });
    await git(['worktree', 'prune']);
    mkdirSync(worktreesDir(), { recursive: true });
    await git(['worktree', 'add', '-q', '--detach', wt, branch]);
    return {
      dir: wt,
      cleanup: () => withRepoLock(async () => {
        await git(['worktree', 'remove', '--force', wt]).catch(() => undefined);
      }),
    };
  });
}

/** Checks out main into its own worktree (for before/after comparisons). */
export async function checkoutMain(taskId: bigint) {
  return checkoutForReview('main', BigInt(`9${taskId}`));
}

export async function listFiles(): Promise<string[]> {
  await ensureRepo();
  return (await git(['ls-files'])).trim().split('\n').filter(Boolean);
}

/** The owner's own repo: a shallow clone in the crew's persistent workspace. Returns its folder and commit. */
export async function cloneOwnerRepo(url: string): Promise<{ dir: string; sha: string }> {
  const slug = url.replace(/\.git$/, '').split('/').slice(-2).join('__').replace(/[^A-Za-z0-9_.-]/g, '_');
  const dir = join(env.workspaceDir, 'repos', slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  await run('git', ['clone', '--depth', '1', '--single-branch', url, dir], {
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const sha = (await git(['rev-parse', 'HEAD'], dir)).trim();
  return { dir, sha };
}
