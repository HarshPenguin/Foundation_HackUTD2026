import type { FixKey } from './types';

/** The planted, fixable problems in MediClaim, as the Auditor and Updater describe them. */
export interface KnownIssue {
  key: FixKey;
  file: string; // path inside the MediClaim repo
  title: string;
  developer: string; // default owner (displayName)
  plain: string; // one plain-English line for the owner
  short: string; // noun phrase: "the SQL injection in claim search"
  instructions: string; // what the Developer should do
}

export const KNOWN_ISSUES: Record<FixKey, KnownIssue> = {
  sqli: {
    key: 'sqli',
    short: 'the SQL injection in claim search',
    file: 'public/search.php',
    title: 'Fix SQL injection in claim search',
    developer: 'Dev-Security',
    plain: 'Claim search can be hijacked to read every patient record',
    instructions:
      'Replace the string-built SQL in public/search.php with a PDO prepared statement and a bound :name parameter. Escape every value printed into the HTML with htmlspecialchars.',
  },
  rounding: {
    key: 'rounding',
    short: 'the claim total rounding bug',
    file: 'lib/totals.php',
    title: 'Fix claim total rounding',
    developer: 'Dev-Upgrades',
    plain: 'Claim totals drift by a cent because money is added as decimals',
    instructions:
      'In lib/totals.php, parse dollar strings into whole cents (integers), add in cents, apply the 2% reduction rounded half up to the cent, and keep claim_total() and format_money() working for claim.php.',
  },
  config_secret: {
    key: 'config_secret',
    short: 'the database password written in the code',
    file: 'config.php',
    title: 'Move the database password out of the code',
    developer: 'Dev-Security',
    plain: 'The database password is written in the code',
    instructions: 'In config.php, read the database password from the MEDICLAIM_DB_PASS environment variable with getenv() instead of a hardcoded string.',
  },
  jquery: {
    key: 'jquery',
    short: 'the outdated jQuery',
    file: 'public/index.php',
    title: 'Upgrade jQuery 1.4 to 3.7',
    developer: 'Dev-Upgrades',
    plain: 'The page runs jQuery from 2010 with known security issues',
    instructions: 'In public/index.php, load jQuery 3.7.1, remove the $.browser check, and replace .live() with $(document).on().',
  },
};

export const FIX_KEYS = Object.keys(KNOWN_ISSUES) as FixKey[];

export function isFixKey(x: unknown): x is FixKey {
  return typeof x === 'string' && x in KNOWN_ISSUES;
}

/** The default weekly plan (matches the seeded update plan). */
export const DEFAULT_PLAN: FixKey[] = ['sqli', 'rounding'];

export function slugFor(key: FixKey): string {
  return { sqli: 'sqli-claim-search', rounding: 'cents-totals', config_secret: 'db-password-env', jquery: 'jquery-3' }[key];
}
