import { pause } from '../env';
import { parseJson } from '../db';
import { think } from '../llm';
import { auditMarkdown, languagesLine, scanRepo } from '../scanner';
import { cloneOwnerRepo } from '../workspace';
import type { RoleCtx, RoleResult } from './common';
import { writeRoleReport } from './reports';

/** The Auditor: clones the owner's repo, scans it, and writes "How <app> works". */
export async function audit(c: RoleCtx): Promise<RoleResult> {
  const input = parseJson<{ repoUrl?: string }>(c.task.input);
  if (!input?.repoUrl) return writeRoleReport(c); // scheduled audits of the current app
  const { db, task, employee } = c;
  const url = input.repoUrl;
  const name = url.replace(/\.git$/, '').split('/').pop() ?? 'your app';
  const status = (s: string, message: string, extra: Partial<Parameters<typeof db.r.updateRepo>[0]> = {}) =>
    db.r
      .updateRepo({ status: s, message, commitSha: '', fileCount: 0, languages: '', findings: 0, healthScore: 0, auditMd: '', ...extra })
      .catch(e => console.warn('[auditor] updateRepo failed:', (e as Error).message));

  await status('cloning', `Cloning ${url}`);
  await db.log(task.runId, employee.id, 'work', `${employee.displayName} is cloning ${name} onto the crew's machine`);
  let dir: string;
  let sha: string;
  try {
    ({ dir, sha } = await cloneOwnerRepo(url));
  } catch (e) {
    const why = String((e as Error).message).split('\n').find(l => /fatal|error/i.test(l)) ?? 'clone failed';
    await status('failed', `Couldn't clone it: ${why.slice(0, 200)}. Is the repo public?`);
    await db.log(task.runId, employee.id, 'info', `Couldn't clone ${name}. Check that the repo is public`);
    return { status: 'failed', output: `Clone failed: ${why}` };
  }

  await status('scanning', `Reading ${name} at ${sha.slice(0, 7)}`, { commitSha: sha });
  await db.log(task.runId, employee.id, 'work', `Cloned ${name} at ${sha.slice(0, 7)}. Reading every source file`);
  const scan = scanRepo(dir);
  await pause(900);
  await db.log(task.runId, employee.id, 'work', `Read ${scan.fileCount} files (${scan.lineCount.toLocaleString('en-US')} lines): ${languagesLine(scan)}`);
  const seen = new Set<string>();
  for (const f of scan.findings) {
    if (seen.has(f.title) || seen.size >= 3) continue;
    seen.add(f.title);
    await pause(700);
    await db.log(task.runId, employee.id, 'review', `Found: ${f.title} in ${f.file}:${f.line}`);
  }

  // Optional AI summary; the report stands on its own without it.
  const top = scan.findings.slice(0, 10).map(f => `- ${f.severity}: ${f.title} (${f.file}:${f.line}) ${f.snippet}`).join('\n');
  const res = await think(db, task, employee, {
    system: 'You are the Auditor on an AI maintenance crew. Explain a legacy codebase to a non-technical owner in 3 short sentences: what the app does, what it is built on, and the single biggest risk. Plain English, no jargon, no exclamation marks.',
    user: `App: ${name}\nFiles: ${scan.fileCount}, lines: ${scan.lineCount}\nLanguages: ${languagesLine(scan)}\nFrameworks/manifests: ${scan.frameworks.join(', ') || 'none'}\nEntry points: ${scan.entryPoints.join(', ') || 'unknown'}\nFindings:\n${top || 'none'}`,
    maxOutputTokens: Number(task.maxOutputTokens) || 600,
    canned: '',
  });
  const md = auditMarkdown(name, url, sha, scan, res.live ? res.text : undefined);
  await db.r.writeReport({ kind: 'audit', authorEmployeeId: employee.id, title: `How ${name} works`, bodyMd: md, period: 'on connect' });
  await status('ready', `${scan.findings.length} risks found, health ${scan.healthScore}/100`, {
    commitSha: sha,
    fileCount: scan.fileCount,
    languages: languagesLine(scan),
    findings: scan.findings.length,
    healthScore: scan.healthScore,
    auditMd: md,
  });
  await pause(600);
  await db.log(task.runId, employee.id, 'info', `Audit ready: ${scan.findings.length} risks in ${name}, health ${scan.healthScore}/100. See "How ${name} works" on My Developers`);
  return { status: 'done', output: `Audited ${name}: ${scan.findings.length} risks, health ${scan.healthScore}/100` };
}
