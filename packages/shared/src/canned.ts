// MOCK: canned outputs used by the simulated providers (Gemini, OpenAI, NVIDIA Nemotron) and as the
// offline playbook when the real provider (Maritime) is unreachable. Real: the same prompts sent to each provider's API.
import type { FixKey, ManagerPlan } from './types';
import { DEFAULT_PLAN, KNOWN_ISSUES } from './issues';

export function cannedManagerPlan(keys: FixKey[] = DEFAULT_PLAN): ManagerPlan {
  return {
    summary: `Planned ${keys.length} fixes from the audit, highest risk first.`,
    tasks: keys.map(k => ({
      fixKey: k,
      developer: KNOWN_ISSUES[k].developer,
      title: KNOWN_ISSUES[k].title,
      why: KNOWN_ISSUES[k].plain,
    })),
  };
}

export const CANNED_TESTER_NOTES: Record<FixKey, string> = {
  sqli: 'The search now uses a prepared statement with a bound parameter, and output is escaped. Nobody can rewrite the query from the search box.',
  rounding: 'Totals are added in whole cents and the 2% reduction rounds half up. The known drifting examples now come out cent-exact.',
  config_secret: 'The password is read from the environment. No secret is left in the code.',
  jquery: 'jQuery 3.7.1 is loaded and the removed .live() and $.browser calls are gone.',
};

export function cannedReviewerHeadline(names: string[]): string {
  return names.length ? `Reviews written for ${names.join(', ')}.` : 'No reviews needed this run.';
}

export function cannedResearch(): string {
  return `- **PHP 8.3 is the only safe target.** PHP 8.1 lost security support this month; MediClaim still targets 5.6.
- **jQuery 3.7.1** is current and fixes CVE-2020-11022 and CVE-2020-11023 (XSS in \`.html()\`).
- **PDO prepared statements** remain the recommended fix for SQL built from strings; \`mysql_*\` functions do not exist in PHP 7+.
- **New:** HHS guidance now expects claim totals to be stored as whole cents in billing exports.
- **New:** a free composer audit (\`composer audit\`) can flag vulnerable PHP packages in CI.`;
}

export function cannedMarketing(shipped: string[]): string {
  const list = shipped.length ? shipped.map(s => `- ${s}`).join('\n') : '- Behind-the-scenes reliability work';
  return `**Release note**
${list}

**Announcement (email to clinic staff):** "We've made MediClaim safer and more accurate behind the scenes. Claim search is protected and totals now match to the cent. Nothing changes in how you work."

**Growth ideas**
1. Add a "Security checked weekly" badge to the login page.
2. Send partner clinics a one-page billing-accuracy report each month.
3. Lead the next newsletter with the cent-exact totals fix.`;
}

export function cannedAudit(): string {
  return `**In plain English:** MediClaim takes a patient's claim, checks the amount, and stores it for billing. Staff search claims by patient name.

**What it's built on:** PHP 5.6 (unsupported since 2018), jQuery 1.4 (2010), MySQL queries written directly inside the pages.

**Top risks**
1. **Claim search can be hijacked** (SQL injection in \`search.php\`).
2. **Claim totals drift by cents** (\`lib/totals.php\` adds money as decimals).
3. **Database password is written in the code** (\`config.php\`).
4. **No tests.**
5. **Old jQuery** with known security issues.

**Dead code:** \`old_export.php\` is never linked.`;
}

export function cannedUpdatePlan(): string {
  return `1. **Dev-Security:** replace string-built SQL in \`search.php\` with PDO prepared statements.
2. **Dev-Upgrades:** store money as whole cents in \`lib/totals.php\`.
3. **Dev-Security:** move the database password into an environment variable.
4. **Dev-Upgrades:** upgrade jQuery 1.4 to 3.7 in \`index.php\`.
5. **Tester:** keep the cent-exact totals check and the search escaping check in every run.`;
}

export function cannedInsights(lines: string[]): string {
  return lines.length
    ? lines.map(l => `- ${l}`).join('\n')
    : '- Spending is steady. No unused keys and no provider near its limit.';
}
