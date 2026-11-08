import type { InferSchema, ReducerCtx } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import type spacetimedb from './schema';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const MIN = 60_000_000n;
const HOUR = 60n * MIN;
const DAY = 24n * HOUR;
const USD = 1_000_000n;

export function wipe(ctx: Ctx) {
  const d = ctx.db;
  for (const r of [...d.cadenceTimer.iter()]) d.cadenceTimer.scheduledId.delete(r.scheduledId);
  for (const r of [...d.reservationTimer.iter()]) d.reservationTimer.scheduledId.delete(r.scheduledId);
  for (const r of [...d.settings.iter()]) d.settings.id.delete(r.id);
  for (const r of [...d.project.iter()]) d.project.id.delete(r.id);
  for (const r of [...d.employee.iter()]) d.employee.id.delete(r.id);
  for (const r of [...d.provider.iter()]) d.provider.id.delete(r.id);
  for (const r of [...d.fallbackChain.iter()]) d.fallbackChain.taskType.delete(r.taskType);
  for (const r of [...d.budget.iter()]) d.budget.id.delete(r.id);
  for (const r of [...d.spendEvent.iter()]) d.spendEvent.id.delete(r.id);
  for (const r of [...d.run.iter()]) d.run.id.delete(r.id);
  for (const r of [...d.task.iter()]) d.task.id.delete(r.id);
  for (const r of [...d.activity.iter()]) d.activity.id.delete(r.id);
  for (const r of [...d.notification.iter()]) d.notification.id.delete(r.id);
  for (const r of [...d.chatMessage.iter()]) d.chatMessage.id.delete(r.id);
  for (const r of [...d.report.iter()]) d.report.id.delete(r.id);
  for (const r of [...d.review.iter()]) d.review.id.delete(r.id);
}

export function seed(ctx: Ctx) {
  const d = ctx.db;
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const ago = (micros: bigint) => new Timestamp(now - micros);

  d.settings.insert({
    id: 0,
    ownerName: 'Harsh',
    mode: 'autonomous',
    commChannel: 'email',
    commFrequency: 'weekly',
    managerOptimizesCadence: true,
    workerOnline: false,
    workerLastSeenAt: undefined,
  });

  d.project.insert({
    id: 0n,
    name: 'MediClaim',
    repoPath: 'legacy-demo',
    stackSummary: 'PHP 5.6, jQuery 1.4, MySQL with SQL written inside page code. No tests. Last real update 2014.',
    healthScore: 41,
    lastAuditAt: ago(3n * DAY),
  });

  // ---- providers. Prices are micro-dollars per 1M tokens, provider list prices.
  // MOCK: simulated balances. Real: provider usage/billing APIs (Maritime /api/agents/{id}/llm-calls).
  const maritime = d.provider.insert({
    id: 0n, name: 'Maritime', model: 'gpt-5-mini', isSimulated: false,
    balanceMicros: 25n * USD, reservedMicros: 0n, thresholdMicros: 0n,
    priceInPerMTok: 250_000n, priceOutPerMTok: 2_000_000n,
    status: 'healthy', statusReason: '', usesThisWeek: 14, lastUsedAt: ago(6n * DAY),
  });
  const gemini = d.provider.insert({
    id: 0n, name: 'Gemini', model: 'gemini-2.5-flash', isSimulated: true,
    // Just enough for one worst-case code task, so the second one triggers the switch on stage.
    balanceMicros: 7_000n, reservedMicros: 0n, thresholdMicros: 0n,
    priceInPerMTok: 300_000n, priceOutPerMTok: 2_500_000n,
    status: 'low', statusReason: '$0.01 left before its limit', usesThisWeek: 31, lastUsedAt: ago(6n * DAY),
  });
  const openai = d.provider.insert({
    id: 0n, name: 'OpenAI', model: 'gpt-5', isSimulated: true,
    balanceMicros: 3_400_000n, reservedMicros: 0n, thresholdMicros: 500_000n,
    priceInPerMTok: 1_250_000n, priceOutPerMTok: 10_000_000n,
    status: 'healthy', statusReason: '', usesThisWeek: 0, lastUsedAt: ago(40n * DAY),
  });
  const nemotron = d.provider.insert({
    id: 0n, name: 'NVIDIA Nemotron', model: 'nemotron-nano-9b', isSimulated: true,
    balanceMicros: 1_100_000n, reservedMicros: 0n, thresholdMicros: 0n,
    priceInPerMTok: 60_000n, priceOutPerMTok: 240_000n,
    status: 'healthy', statusReason: '', usesThisWeek: 9, lastUsedAt: ago(6n * DAY),
  });

  const chains: Array<[string, bigint[]]> = [
    ['code', [gemini.id, maritime.id, openai.id]],
    ['research', [gemini.id, nemotron.id, maritime.id]],
    ['review', [maritime.id, openai.id]],
    ['marketing', [nemotron.id, maritime.id]],
    ['chat', [maritime.id, nemotron.id]],
    ['general', [maritime.id, nemotron.id, openai.id]],
  ];
  for (const [taskType, providerIds] of chains) d.fallbackChain.insert({ taskType, providerIds });

  d.budget.insert({
    id: 0,
    weekStart: ago(2n * DAY),
    limitMicros: 5n * USD,
    spentMicros: 1_840_000n,
    reservedMicros: 0n,
    spendLocked: true,
    autonomousHalted: false,
    savedBySwitchingMicros: 620_000n,
  });

  // ---- employees
  type Spec = [role: string, name: string, cadence: string, day: number, hour: number, status?: string];
  const specs: Spec[] = [
    ['translator', 'Translator', 'on_demand', 0, 12],
    ['manager', 'Manager', 'weekly', 3, 12],
    ['auditor', 'Auditor', 'monthly', 1, 9],
    ['researcher', 'Researcher', 'monthly', 1, 8, 'on_review'],
    ['updater', 'Updater', 'monthly', 2, 9],
    ['developer', 'Dev-Security', 'weekly', 3, 12],
    ['developer', 'Dev-Upgrades', 'weekly', 3, 12],
    ['tester', 'Tester', 'weekly', 3, 12],
    ['purser', 'Purser', 'weekly', 0, 18],
    ['reviewer', 'Reviewer', 'weekly', 4, 9],
    ['marketer', 'Marketer', 'monthly', 5, 10],
    ['communicator', 'Communicator', 'weekly', 4, 10],
  ];
  const emp: Record<string, bigint> = {};
  for (const [role, name, cadence, day, hour, status] of specs) {
    const e = d.employee.insert({
      id: 0n, role, displayName: name, generation: 1, status: status ?? 'active',
      cadence, runDay: day, runHour: hour, timezone: 'America/Chicago', utcOffsetMinutes: -360,
      lastRunAt: role === 'translator' ? undefined : ago(6n * DAY), nextRunAt: undefined,
      promptVersion: 1, handoffNote: '', hiredAt: ago(30n * DAY),
    });
    emp[name] = e.id;
  }

  // ---- last week's run (replayable on the live panel)
  const runStart = now - 6n * DAY;
  const r = d.run.insert({
    id: 0n, trigger: 'schedule', status: 'done',
    summary: 'Upgraded jQuery, patched a stored XSS in the notes field, added the first 6 tests.',
    startedAt: new Timestamp(runStart), endedAt: new Timestamp(runStart + 14n * MIN), totalMicros: 412_000n,
  });
  const steps: Array<[number, string, string, string]> = [
    [0, 'Manager', 'plan', 'Read the audit and research. Planned 3 tasks: jQuery 1.4 to 3.7, XSS in claim notes, first tests'],
    [1, 'Purser', 'budget', 'Reserved $0.06 on Gemini for Dev-Upgrades. Weekly budget: $1.43 of $5.00 used'],
    [2, 'Dev-Upgrades', 'work', 'Created branch foundation/jquery-3 and replaced deprecated .live() and .browser calls'],
    [5, 'Tester', 'review', 'Rejected the first jQuery patch: claim search form stopped submitting'],
    [7, 'Dev-Upgrades', 'work', 'Fixed the form handler. Re-submitted'],
    [8, 'Tester', 'review', 'Approved foundation/jquery-3. 4 checks passed'],
    [9, 'Dev-Security', 'work', 'Escaped claim notes on output. Branch foundation/xss-notes'],
    [10, 'Tester', 'review', 'Approved foundation/xss-notes'],
    [11, 'Researcher', 'work', 'Research drop was late and repeated last month\'s findings'],
    [12, 'Reviewer', 'review', 'Reviews written. Researcher placed on review'],
    [14, 'Communicator', 'info', 'Weekly update sent to your email'],
  ];
  for (const [m, who, kind, message] of steps) {
    d.activity.insert({ id: 0n, runId: r.id, employeeId: emp[who] ?? 0n, kind, message, at: new Timestamp(runStart + BigInt(m) * MIN) });
  }
  const doneTask = (who: string, type: string, title: string, branch: string, cost: bigint, diff: string, status = 'done') =>
    d.task.insert({
      id: 0n, runId: r.id, employeeId: emp[who], taskType: type, status, title, input: '', output: '',
      branch, diff, providerId: maritime.id, inputTokens: 3000n, maxOutputTokens: 1500n,
      estMicros: cost, reservedMicros: 0n, costMicros: cost, excludedProviderIds: [], blockReason: '',
      createdAt: new Timestamp(runStart), updatedAt: new Timestamp(runStart + 10n * MIN),
    });
  doneTask('Dev-Upgrades', 'code', 'Upgrade jQuery 1.4 to 3.7', 'foundation/jquery-3', 96_000n,
    '--- a/legacy-demo/public/index.php\n+++ b/legacy-demo/public/index.php\n-<script src="js/jquery-1.4.2.min.js"></script>\n+<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>\n-$(".claim-row").live("click", openClaim);\n+$(document).on("click", ".claim-row", openClaim);');
  doneTask('Dev-Security', 'code', 'Escape claim notes (stored XSS)', 'foundation/xss-notes', 71_000n,
    '--- a/legacy-demo/public/claim.php\n+++ b/legacy-demo/public/claim.php\n-<td><?php echo $row["notes"]; ?></td>\n+<td><?php echo htmlspecialchars($row["notes"], ENT_QUOTES, "UTF-8"); ?></td>');

  // ---- reports
  const report = (kind: string, who: string, title: string, bodyMd: string, period: string, at: bigint) =>
    d.report.insert({ id: 0n, kind, authorEmployeeId: emp[who], title, bodyMd, period, at: ago(at) });

  report('audit', 'Auditor', 'How MediClaim works', `**In plain English:** MediClaim takes a patient's claim, checks the amount, and stores it for billing. Staff search claims by patient name.

**What it's built on:** PHP 5.6 (unsupported since 2018), jQuery 1.4 (2010), MySQL queries written directly inside the pages.

**Top risks**
1. **Claim search can be hijacked** (SQL injection in \`search.php\`). Anyone can read every patient record.
2. **Claim totals drift by cents** (\`lib/totals.php\` adds money as decimals). Small errors add up to improper payments.
3. **Database password is written in the code** (\`config.php\`).
4. **No tests.** Nobody can tell if a change breaks billing.
5. **Old jQuery** with known security issues.

**Dead code:** \`old_export.php\` and \`fax.php\` are never linked.`, 'monthly', 3n * DAY);

  report('weekly_update', 'Communicator', 'Your weekly update', `Hi Harsh. Here's what your crew did on MediClaim this week.

**Shipped (2 changes, both reviewed)**
- Upgraded jQuery from 2010 to the current version. One attempt was rejected by the Tester and fixed.
- Closed a security hole that let anyone plant code in claim notes.

**Still open:** claim search can be hijacked (SQL injection), and claim totals can be off by a few cents. Both are planned for Wednesday.

**Money:** $0.41 spent this run, $1.84 of your $5.00 weekly budget. Nothing went over a limit. Switching to cheaper models saved $0.62.

**People:** the Researcher is on review for a late, repetitive research drop.`, 'week', 6n * DAY);

  report('marketing_strategy', 'Marketer', 'Marketing strategy: "Safer claims"', `**Release note:** MediClaim now runs on current, supported web libraries and blocks a class of data-tampering attacks.

**Announcement (email to clinic staff):** "We've upgraded MediClaim behind the scenes. Pages load faster and claim notes are safer. Nothing changes in how you work."

**Growth ideas**
1. Put a "Security checked weekly" badge on the login page.
2. Offer partner clinics a short reliability report each month.
3. Lead next month's newsletter with the billing-accuracy fix once it ships.`, 'month', 6n * DAY);

  report('research', 'Researcher', 'Stack research: PHP and jQuery', `- PHP 5.6 and 7.x are end of life. PHP 8.3 is the safe target.
- jQuery under 3.5 has known XSS issues (CVE-2020-11022, CVE-2020-11023).
- mysql_* functions were removed in PHP 7. Use PDO with prepared statements.
- *Reviewer note: most of this repeats last month's drop.*`, 'month', 7n * DAY);

  report('update_plan', 'Updater', 'Update plan for Developers', `1. **Dev-Security:** replace string-built SQL in \`search.php\` with PDO prepared statements.
2. **Dev-Security:** move the database password into an environment variable.
3. **Dev-Upgrades:** store money as whole cents in \`lib/totals.php\`.
4. **Tester:** add tests for claim totals (cent-exact) and search escaping.`, 'month', 7n * DAY);

  report('insights', 'Purser', 'Spending insights', `- **OpenAI hasn't been used in 40 days** but holds $3.40. Consider removing that key, or moving it to the front of your Review chain.
- **Research runs on Gemini cost 3x what Nemotron would.** Moving research to Nemotron first would save about $0.30 a week.
- **APIs you actually need:** Maritime (code, review, chat) and one cheap model for research. That covers 96% of your crew's work.
- **Gemini is nearly empty.** Your crew will switch to Maritime automatically in Autonomous mode.`, 'week', 1n * DAY);

  // ---- reviews
  const review = (who: string, score: number, done: number, rej: number, fail: number, cpa: bigint, rec: string, summary: string) =>
    d.review.insert({ id: 0n, employeeId: emp[who], period: 'last week', score, tasksDone: done, rejections: rej, failures: fail, costPerAcceptedMicros: cpa, recommendation: rec, summary, at: ago(6n * DAY) });
  review('Manager', 88, 3, 0, 0, 0n, 'keep', 'Planned a realistic week and stayed well under budget.');
  review('Dev-Upgrades', 74, 1, 1, 0, 96_000n, 'coach', 'Shipped the jQuery upgrade, but the first attempt broke the search form.');
  review('Dev-Security', 91, 1, 0, 0, 71_000n, 'keep', 'Clean, minimal security fix. Approved first time.');
  review('Tester', 93, 3, 0, 0, 22_000n, 'keep', 'Caught a broken form before it shipped.');
  review('Researcher', 38, 1, 0, 1, 210_000n, 'replace', 'Late, and 80% of findings repeated last month. Recommend replacing with a fresh brief and a cheaper model.');
  review('Purser', 95, 31, 0, 0, 0n, 'keep', 'Switched models twice, saving $0.62. No limit was crossed.');
  report('performance_review', 'Reviewer', 'Performance reviews: last week', `| Employee | Score | Verdict |
|---|---|---|
| Purser | 95 | Keep |
| Tester | 93 | Keep |
| Dev-Security | 91 | Keep |
| Manager | 88 | Keep |
| Dev-Upgrades | 74 | Coach |
| Researcher | 38 | **Replace** |

**Researcher placed on review. Recommend replacing.** Late research that mostly repeated last month, at the highest cost per useful finding on the team.`, 'week', 6n * DAY);

  d.notification.insert({
    id: 0n, kind: 'info', title: 'Researcher placed on review',
    body: 'The Reviewer recommends replacing the Researcher. Open My Developers to decide.',
    taskId: undefined, providerId: undefined, resolved: false, createdAt: ago(6n * DAY),
  });
  d.chatMessage.insert({
    id: 0n, role: 'translator', directiveJson: '', taskId: undefined, at: ago(6n * DAY),
    text: "Hi Harsh. I'm your Translator. Ask me anything about MediClaim, your crew, or your spending, in plain English.",
  });
}
