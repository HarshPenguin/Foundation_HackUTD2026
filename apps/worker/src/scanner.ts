// Deterministic code scanner: the Auditor's first pass. Works with no AI key.
// Reads the real files and reports stack, size, outdated dependencies and risky patterns.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export interface Finding {
  severity: 'high' | 'medium' | 'low';
  title: string; // plain English
  why: string;
  file: string;
  line: number;
  snippet: string;
}

export interface ScanResult {
  fileCount: number;
  lineCount: number;
  languages: Array<{ name: string; files: number }>;
  frameworks: string[];
  entryPoints: string[];
  hasTests: boolean;
  findings: Finding[];
  healthScore: number;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv', 'venv', 'bower_components']);
const LANG: Record<string, string> = {
  '.php': 'PHP', '.js': 'JavaScript', '.jsx': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.py': 'Python',
  '.rb': 'Ruby', '.java': 'Java', '.cs': 'C#', '.go': 'Go', '.html': 'HTML', '.htm': 'HTML', '.css': 'CSS',
  '.sql': 'SQL', '.cob': 'COBOL', '.cbl': 'COBOL', '.vue': 'Vue', '.c': 'C', '.cpp': 'C++', '.sh': 'Shell',
};
const CODE_EXT = new Set(['.php', '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.java', '.cs', '.go', '.html', '.htm', '.vue', '.inc']);
const MAX_FILES = 4000;
const MAX_BYTES = 400_000;

interface Rule {
  severity: Finding['severity'];
  title: string;
  why: string;
  test: RegExp;
  ext?: string[];
  skip?: RegExp;
}

const REQ = String.raw`\$_(GET|POST|REQUEST|COOKIE)`;
const RULES: Rule[] = [
  {
    severity: 'high',
    title: 'Database query built from user input (SQL injection)',
    why: 'Anyone can change the query to read or delete data. Use prepared statements.',
    test: new RegExp(String.raw`(SELECT|INSERT|UPDATE|DELETE)\b[^;\n]*(['"]\s*\.\s*\$|\{?\$_?(GET|POST|REQUEST|id\b))|(mysqli?_query|->query)\s*\([^)]*` + REQ, 'i'),
    ext: ['.php', '.inc'],
  },
  {
    severity: 'high',
    title: 'Command run with user input (command injection)',
    why: 'An attacker could run any command on your server.',
    test: new RegExp(String.raw`\b(shell_exec|exec|system|passthru|popen|proc_open)\s*\([^)]*(\$_(GET|POST|REQUEST)|\$target|\$cmd)`, 'i'),
    ext: ['.php', '.inc'],
  },
  {
    severity: 'high',
    title: 'User input printed straight into the page (XSS)',
    why: 'Someone can plant scripts that run in your users’ browsers. Escape output.',
    test: new RegExp(String.raw`\b(echo|print)\b[^;\n]*` + REQ + String.raw`|(<[a-z]|\$html)[^;\n]*['"]\s*\.\s*\$_(GET|POST|REQUEST)\[`, 'i'),
    ext: ['.php', '.inc'],
    skip: /htmlspecialchars|htmlentities|intval|\(int\)/i,
  },
  {
    severity: 'high',
    title: 'Code evaluated at runtime',
    why: '`eval` can run attacker-controlled code.',
    test: /\beval\s*\(/,
    ext: ['.php', '.js', '.py'],
  },
  {
    severity: 'medium',
    title: 'Password or secret written in the code',
    why: 'Anyone with the code has the secret. Move it to an environment variable.',
    test: /\b(db_?pass(word)?|password|passwd|secret|api_?key)\b['"]?\s*(=>|=|:)\s*['"][^'"\s]{4,}['"]/i,
    skip: /example|changeme|your[_-]|placeholder|xxxx|getenv|process\.env|\$_ENV/i,
  },
  {
    severity: 'medium',
    title: 'Removed PHP database functions (mysql_*)',
    why: 'These were removed in PHP 7, so the app can’t run on supported PHP versions.',
    test: /\bmysql_(query|connect|fetch_\w+|select_db|real_escape_string)\s*\(/,
    ext: ['.php', '.inc'],
  },
  {
    severity: 'medium',
    title: 'Weak password hashing (md5/sha1)',
    why: 'These hashes are cracked in seconds. Use password_hash / bcrypt.',
    test: /\b(md5|sha1)\s*\(\s*\$\w*pass/i,
    ext: ['.php', '.inc', '.py', '.js'],
  },
  {
    severity: 'medium',
    title: 'File included from user input',
    why: 'An attacker could load any file on the server.',
    test: new RegExp(String.raw`\b(include|require)(_once)?\s*\(?[^;\n]*` + REQ, 'i'),
    ext: ['.php', '.inc'],
  },
  {
    severity: 'low',
    title: 'Old jQuery (before 3.5) with known security issues',
    why: 'jQuery under 3.5 has known XSS bugs (CVE-2020-11022/11023). Upgrade to 3.7.',
    test: /jquery[-.]?(1\.\d+|2\.\d+|3\.[0-4])(\.\d+)?(\.min)?\.js/i,
  },
];

function walk(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) stack.push(p);
      } else if (st.isFile() && st.size <= MAX_BYTES) out.push(p);
    }
  }
  return out;
}

function readJson(path: string): Record<string, any> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

export function scanRepo(root: string): ScanResult {
  const files = walk(root);
  const langCount = new Map<string, number>();
  const findings: Finding[] = [];
  const perRule = new Map<string, number>();
  let lineCount = 0;
  let hasTests = false;
  const entryPoints: string[] = [];
  const frameworks = new Set<string>();

  for (const abs of files) {
    const rel = relative(root, abs).replace(/\\/g, '/');
    const ext = extname(abs).toLowerCase();
    const lang = LANG[ext];
    if (lang) langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
    if (/(^|\/)(tests?|spec|__tests__)\//i.test(rel) || /(\.test|\.spec|Test)\.(php|js|ts|py)$/.test(rel)) hasTests = true;
    if (/^(index|app|main|server)\.(php|js|py|ts)$/i.test(rel)) entryPoints.push(rel);
    if (!CODE_EXT.has(ext)) continue;
    let text = '';
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    lineCount += lines.length;
    for (const rule of RULES) {
      if (rule.ext && !rule.ext.includes(ext)) continue;
      const used = perRule.get(rule.title) ?? 0;
      if (used >= 6) continue; // keep the report readable
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.length > 400 || !rule.test.test(l) || (rule.skip && rule.skip.test(l))) continue;
        findings.push({ severity: rule.severity, title: rule.title, why: rule.why, file: rel, line: i + 1, snippet: l.trim().slice(0, 140) });
        perRule.set(rule.title, (perRule.get(rule.title) ?? 0) + 1);
        break; // one hit per rule per file
      }
    }
  }

  // Dependencies and frameworks from manifests.
  const pkg = readJson(join(root, 'package.json'));
  if (pkg) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
    for (const [n, v] of Object.entries(deps)) {
      if (['react', 'vue', 'angular', 'express', 'next', 'jquery', 'svelte'].includes(n)) frameworks.add(`${n} ${v}`);
      if (n === 'jquery' && /^[~^]?(1|2|3\.[0-4])\./.test(v))
        findings.push({ severity: 'low', title: 'Old jQuery (before 3.5) with known security issues', why: 'Upgrade to 3.7.', file: 'package.json', line: 1, snippet: `"jquery": "${v}"` });
      if (n === 'angular' && /^[~^]?1\./.test(v))
        findings.push({ severity: 'medium', title: 'AngularJS 1.x is end of life', why: 'No security fixes since 2022. Plan a move to a supported framework.', file: 'package.json', line: 1, snippet: `"angular": "${v}"` });
    }
  }
  const composer = readJson(join(root, 'composer.json'));
  if (composer?.require?.php) frameworks.add(`PHP ${composer.require.php}`);
  for (const f of ['requirements.txt', 'Gemfile', 'pom.xml', 'go.mod']) {
    try {
      statSync(join(root, f));
      frameworks.add(f);
    } catch {
      /* not present */
    }
  }

  const languages = [...langCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, files]) => ({ name, files }));
  // Score per kind of risk (not per occurrence), so one noisy pattern can't sink the score.
  const weight = { high: 15, medium: 7, low: 4 } as const;
  const kinds = new Map(findings.map(f => [f.title, f.severity]));
  const penalty = [...kinds.values()].reduce((s, sev) => s + weight[sev], 0) + (hasTests ? 0 : 10);
  const healthScore = Math.max(5, Math.min(100, 100 - penalty));
  const order = { high: 0, medium: 1, low: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { fileCount: files.length, lineCount, languages, frameworks: [...frameworks], entryPoints, hasTests, findings, healthScore };
}

export function languagesLine(r: ScanResult): string {
  return r.languages.map(l => `${l.name} (${l.files})`).join(', ') || 'unknown';
}

/** Plain-English audit report in Markdown. `summary` is an optional AI-written explanation. */
export function auditMarkdown(name: string, url: string, sha: string, r: ScanResult, summary?: string): string {
  const groups = new Map<string, Finding[]>();
  for (const f of r.findings) groups.set(f.title, [...(groups.get(f.title) ?? []), f]);
  const risks = [...groups.entries()].slice(0, 8).map(([title, fs], i) => {
    const where = fs.slice(0, 3).map(f => `\`${f.file}:${f.line}\``).join(', ');
    return `${i + 1}. **${title}** (${fs[0].severity}, ${fs.length} place${fs.length > 1 ? 's' : ''}): ${fs[0].why} Seen in ${where}${fs.length > 3 ? ' and more' : ''}.`;
  });
  return [
    summary ? `**In plain English:** ${summary.trim()}` : `**In plain English:** ${name} is a ${r.languages[0]?.name ?? 'web'} app with ${r.fileCount} files (${r.lineCount.toLocaleString('en-US')} lines of code). I cloned it from ${url} at commit \`${sha.slice(0, 7)}\` and read every source file.`,
    '',
    `**What it's built on:** ${languagesLine(r)}${r.frameworks.length ? `. Also: ${r.frameworks.join(', ')}` : ''}.`,
    r.entryPoints.length ? `**Entry points:** ${r.entryPoints.slice(0, 5).map(e => `\`${e}\``).join(', ')}.` : '',
    '',
    `**Top risks** (${r.findings.length} found, health ${r.healthScore}/100)`,
    ...(risks.length ? risks : ['No risky patterns found by the scanner.']),
    '',
    `**Tests:** ${r.hasTests ? 'some tests exist.' : 'none found. Nobody can tell if a change breaks something.'}`,
  ]
    .filter(l => l !== undefined)
    .join('\n');
}

/** Findings for one file (used by the Tester to confirm a risk is gone). */
export function scanFile(root: string, rel: string): Finding[] {
  const ext = extname(rel).toLowerCase();
  let text = '';
  try {
    text = readFileSync(join(root, rel), 'utf8');
  } catch {
    return [];
  }
  const out: Finding[] = [];
  const lines = text.split('\n');
  for (const rule of RULES) {
    if (rule.ext && !rule.ext.includes(ext)) continue;
    lines.forEach((l, i) => {
      if (l.length <= 400 && rule.test.test(l) && !(rule.skip && rule.skip.test(l)))
        out.push({ severity: rule.severity, title: rule.title, why: rule.why, file: rel, line: i + 1, snippet: l.trim().slice(0, 140) });
    });
  }
  return out;
}
