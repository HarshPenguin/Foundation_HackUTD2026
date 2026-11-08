import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** apps/worker */
export const WORKER_ROOT = resolve(here, '..');
/** repository root (apps/worker/../..) */
export const REPO_ROOT = resolve(WORKER_ROOT, '..', '..');

loadDotenv({ path: resolve(WORKER_ROOT, '.env'), quiet: true } as Parameters<typeof loadDotenv>[0]);

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v != null && v.trim() !== '' ? v.trim() : fallback;
}

export const env = {
  stdbUri: str('STDB_URI', 'ws://127.0.0.1:3000'),
  stdbDb: str('STDB_DB', 'foundation'),
  pairingCode: str('WORKER_PAIRING_CODE'),
  // Maritime injects OPENAI_API_KEY / OPENAI_BASE_URL into agents that use Maritime LLM.
  llmKey: str('MARITIME_LLM_KEY', str('OPENAI_API_KEY')),
  llmBaseUrl: str('MARITIME_BASE_URL', str('OPENAI_BASE_URL', 'https://api.maritime.sh/api/llm/v1')),
  workspaceDir: resolve(WORKER_ROOT, str('WORKSPACE_DIR', '.workspace')),
  legacyDemoDir: resolve(REPO_ROOT, str('LEGACY_DEMO_DIR', 'legacy-demo')),
  port: Number(str('PORT', str('HEALTH_PORT', '8788'))),
  /** Multiplies the pauses between visible steps. 0 = no pauses (tests). */
  pace: Number(str('PACE', '1.6')),
  concurrency: Math.max(1, Number(str('WORKER_CONCURRENCY', '2'))),
  llmTimeoutMs: Number(str('LLM_TIMEOUT_MS', '45000')),
};

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Pause between visible steps so the live panel is watchable. */
export function pause(ms = 1200): Promise<void> {
  const jitter = 0.8 + Math.random() * 0.4;
  return sleep(Math.round(ms * env.pace * jitter));
}
