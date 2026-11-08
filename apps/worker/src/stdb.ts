import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DbConnection } from './module_bindings/index';
import { env } from './env';

export type Conn = DbConnection;

const tokenFile = () => join(env.workspaceDir, 'worker-token');

function loadToken(): string | undefined {
  try {
    if (!existsSync(tokenFile())) return undefined;
    const saved = JSON.parse(readFileSync(tokenFile(), 'utf8')) as { uri?: string; db?: string; token?: string };
    // A token is only valid on the server that issued it.
    if (saved.uri === env.stdbUri && saved.token) return saved.token;
  } catch {
    /* unreadable token file: start fresh */
  }
  return undefined;
}

function saveToken(token: string) {
  mkdirSync(env.workspaceDir, { recursive: true });
  writeFileSync(tokenFile(), JSON.stringify({ uri: env.stdbUri, db: env.stdbDb, token }), { mode: 0o600 });
}

export function forgetToken() {
  try {
    unlinkSync(tokenFile());
  } catch {
    /* already gone */
  }
}

export interface ConnectHooks {
  onReconnect?: (conn: Conn) => void;
  onDisconnect?: (err?: Error) => void;
}

function tryConnect(token: string | undefined, hooks: ConnectHooks): Promise<Conn> {
  return new Promise((resolve, reject) => {
    let settled = false;
    DbConnection.builder()
      .withUri(env.stdbUri)
      .withDatabaseName(env.stdbDb)
      .withToken(token)
      .withAutomaticReconnect()
      .onConnect((conn, _identity, newToken) => {
        saveToken(newToken);
        settled = true;
        resolve(conn);
      })
      .onAutomaticReconnect((conn, _identity, newToken) => {
        saveToken(newToken);
        hooks.onReconnect?.(conn);
      })
      .onConnectError((_ctx, err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      })
      .onDisconnect((_ctx, err) => hooks.onDisconnect?.(err))
      .build();
  });
}

/** Connects with the saved worker token (stable identity); falls back to a fresh identity if it is rejected. */
export async function connect(hooks: ConnectHooks = {}): Promise<Conn> {
  const token = loadToken();
  try {
    return await tryConnect(token, hooks);
  } catch (err) {
    if (!token) throw err;
    console.warn('[stdb] saved token rejected, connecting with a fresh identity:', (err as Error).message);
    forgetToken();
    return tryConnect(undefined, hooks);
  }
}

/** Subscribe to every public table and resolve once the initial rows are in the cache. */
export function subscribeAll(conn: Conn): Promise<void> {
  const tables = [
    'settings',
    'project',
    'employee',
    'provider',
    'fallback_chain',
    'budget',
    'spend_event',
    'run',
    'task',
    'activity',
    'notification',
    'chat_message',
    'report',
    'review',
    'provider_config',
    'onboarding',
    'worker_secret',
    'repo',
    'messaging',
    'text_message',
    'worker_messaging',
  ];
  return new Promise((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError(ctx => reject(new Error(`subscription failed: ${String((ctx as { event?: unknown }).event ?? 'unknown')}`)))
      .subscribe(tables.map(t => `SELECT * FROM ${t}`));
  });
}

export async function registerWorker(conn: Conn): Promise<boolean> {
  if (!env.pairingCode) {
    console.error('[stdb] WORKER_PAIRING_CODE is not set; the module will reject worker calls');
    return false;
  }
  try {
    await conn.reducers.registerWorker({ code: env.pairingCode });
    return true;
  } catch (err) {
    console.error('[stdb] registerWorker failed:', (err as Error).message);
    return false;
  }
}
