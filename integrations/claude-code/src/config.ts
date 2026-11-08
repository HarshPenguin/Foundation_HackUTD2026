// Where this computer's Foundation connection lives. The token is this Claude Code's own
// SpacetimeDB identity (not an API key); it can only do what the Foundation module allows.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  server: string; // e.g. https://maincloud.spacetimedb.com
  db: string; // e.g. foundation-hackutd
  token?: string;
  name?: string;
}

export const CONFIG_DIR = process.env.FOUNDATION_HOME || join(homedir(), '.foundation');
export const CONFIG_PATH = join(CONFIG_DIR, 'claude-code.json');

const DEFAULTS: Config = {
  server: process.env.FOUNDATION_SERVER || 'https://maincloud.spacetimedb.com',
  db: process.env.FOUNDATION_DB || 'foundation-hackutd',
};

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<Config>;
    return {
      ...DEFAULTS,
      ...saved,
      server: process.env.FOUNDATION_SERVER || saved.server || DEFAULTS.server,
      db: process.env.FOUNDATION_DB || saved.db || DEFAULTS.db,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(c: Config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* not supported on Windows */
  }
}
