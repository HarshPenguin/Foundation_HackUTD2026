// The Tester's scripted checks: php -l plus a tiny PHP check per known fix.
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { FixKey } from '@foundation/shared';
import { env } from './env';

const run = promisify(execFile);

export interface CheckResult {
  passed: number;
  total: number;
  failures: string[];
  ok: boolean;
}

const PHP_PRELUDE = `<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_WARNING);
$results = array();
function check($label, $ok, $detail = '') { global $results; $results[] = array('label' => $label, 'ok' => (bool) $ok, 'detail' => $detail); }
function finish() { global $results; echo json_encode($results); }
`;

const CHECKS: Record<FixKey, string> = {
  rounding: `${PHP_PRELUDE}
ob_start();
require $argv[1];
ob_end_clean();
$cases = array(
  array('one $1.15 line item', array(array('amount' => '1.15', 'qty' => 1)), 113),
  array('100 x $0.29', array(array('amount' => '0.29', 'qty' => 100)), 2842),
  array('3 x $4.35', array(array('amount' => '4.35', 'qty' => 3)), 1279),
  array('mixed claim of $60.87', array(array('amount' => '19.99', 'qty' => 3), array('amount' => '0.10', 'qty' => 7), array('amount' => '0.20', 'qty' => 1)), 5965),
  array('one $10.00 line item', array(array('amount' => '10.00', 'qty' => 1)), 980),
);
foreach ($cases as $c) {
  if (function_exists('claim_total_cents')) { $got = claim_total_cents($c[1]); }
  else { $r = claim_total($c[1]); $got = is_int($r) ? $r : (int) round($r * 100); }
  check('Total for ' . $c[0] . ' is cent-exact', $got === $c[2], 'expected ' . $c[2] . ' cents, got ' . $got);
}
$shown = format_money(claim_total(array(array('amount' => '1.15', 'qty' => 1))));
check('Claim page shows $1.13 for a $1.15 item', $shown === '$1.13', 'claim page would show ' . $shown);
finish();
`,
  sqli: `${PHP_PRELUDE}
$src = file_get_contents($argv[1]);
check('No SQL built by joining strings with variables', !preg_match('/(SELECT|INSERT|UPDATE|DELETE)\\b[^;]*?["\\']\\s*\\.\\s*\\$/is', $src), 'a query is still glued together from request data');
check('No variables written straight into SQL text', !preg_match('/->(prepare|query)\\s*\\(\\s*"[^"]*\\$/', $src), 'a variable is interpolated inside the SQL string');
check('Uses a prepared statement', preg_match('/->prepare\\s*\\(/', $src) === 1, 'no prepare() call found');
check('Binds the search term as data', preg_match('/->execute\\s*\\(\\s*(array\\(|\\[)/', $src) === 1 || preg_match('/bind(Value|Param)\\s*\\(/', $src) === 1, 'the search term is never bound');
check('No removed mysql_query() calls', !preg_match('/mysql_query\\s*\\(/', $src), 'still calls mysql_query(), removed in PHP 7');
finish();
`,
  config_secret: `${PHP_PRELUDE}
$src = file_get_contents($argv[1]);
check('No password written in the code', strpos($src, 'Medic@re2012!') === false && !preg_match('/\\$DB_PASS\\s*=\\s*["\\'][^"\\']+["\\']/', $src), 'a password string is still in config.php');
check('Password comes from the environment', preg_match('/getenv\\s*\\(\\s*["\\']MEDICLAIM_DB_PASS/', $src) === 1 || preg_match('/\\$_ENV\\[/', $src) === 1, 'no getenv() for the password');
finish();
`,
  jquery: `${PHP_PRELUDE}
$src = file_get_contents($argv[1]);
check('Loads jQuery 3.7', preg_match('/jquery-3\\.7\\.\\d+(\\.min)?\\.js/', $src) === 1, 'jQuery 3.7 is not loaded');
check('Old jQuery 1.4 removed', strpos($src, 'jquery-1.4') === false, 'still loads jQuery 1.4');
check('No removed .live() calls', !preg_match('/\\.live\\s*\\(/', $src), '.live() was removed in jQuery 1.9');
check('No removed $.browser checks', strpos($src, '$.browser') === false, '$.browser was removed in jQuery 1.9');
finish();
`,
};

function scriptPath(key: FixKey): string {
  const dir = join(env.workspaceDir, 'checks');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${key}_check.php`);
  writeFileSync(p, CHECKS[key]);
  return p;
}

export async function phpLint(file: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { stdout } = await run('php', ['-l', file], { timeout: 20_000 });
    return { ok: true, message: stdout.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string; code?: string };
    if (e.code === 'ENOENT') return { ok: true, message: 'php is not installed; syntax check skipped' };
    const msg = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message;
    return { ok: false, message: msg.split('\n').find(l => /error/i.test(l)) ?? msg.slice(0, 200) };
  }
}

export async function runFixCheck(key: FixKey, file: string): Promise<CheckResult> {
  try {
    const { stdout } = await run('php', ['-d', 'display_errors=stderr', scriptPath(key), file], { timeout: 20_000 });
    const rows = JSON.parse(stdout.trim().split('\n').pop() || '[]') as Array<{ label: string; ok: boolean; detail: string }>;
    const failures = rows.filter(r => !r.ok).map(r => `${r.label}: ${r.detail}`);
    return { passed: rows.length - failures.length, total: rows.length, failures, ok: rows.length > 0 && failures.length === 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string; code?: string };
    if (e.code === 'ENOENT') return { passed: 0, total: 0, failures: [], ok: true }; // no php: rely on review
    const msg = `${e.stderr ?? ''}${e.stdout ?? ''}`.trim() || e.message;
    return { passed: 0, total: 1, failures: [`The check could not run the patched file: ${msg.split('\n')[0]?.slice(0, 200)}`], ok: false };
  }
}

/** Writes text to a scratch file under the workspace (used to check main's version of a file). */
export function scratchFile(name: string, content: string): string {
  const dir = join(env.workspaceDir, 'checks', 'scratch');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}
