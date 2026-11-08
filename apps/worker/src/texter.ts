// Sends the owner's queued texts through Photon Spectrum (iMessage, with SMS fallback).
// SpacetimeDB decides what to send (text_message rows); this only delivers them.
// Credentials: the Spectrum project ID (public, in `messaging.address`) and the project
// secret (private, read through the worker-only `worker_messaging` view).
import { Spectrum } from '@spectrum-ts/core';
import { imessage } from '@spectrum-ts/imessage';
import type { Conn } from './stdb';

type App = Awaited<ReturnType<typeof Spectrum>>;

let app: App | undefined;
let appKey = '';
let starting: Promise<App> | undefined;
const spaces = new Map<string, { send(text: string): Promise<unknown> }>();
const inFlight = new Set<string>();

async function spectrumFor(projectId: string, projectSecret: string): Promise<App> {
  const key = `${projectId}|${projectSecret.slice(-6)}`;
  if (app && key === appKey) return app;
  if (starting && key === appKey) return starting;
  if (app) await Promise.resolve(app.stop?.()).catch(() => undefined);
  app = undefined;
  spaces.clear();
  appKey = key;
  starting = Spectrum({ projectId, projectSecret, providers: [imessage.config()], signal: AbortSignal.timeout(20_000) }).then(a => {
    app = a;
    starting = undefined;
    return a;
  });
  starting.catch(() => {
    starting = undefined;
    appKey = '';
  });
  return starting;
}

async function spaceFor(a: App, phone: string) {
  const cached = spaces.get(phone);
  if (cached) return cached;
  const space = await imessage(a).space.create(phone);
  spaces.set(phone, space);
  return space;
}

function safeError(e: unknown): string {
  return String((e as Error)?.message ?? e)
    .replace(/(secret|token|bearer)\s*[:=]?\s*\S+/gi, '$1 [hidden]')
    .slice(0, 240);
}

/** Delivers every queued outbound text, oldest first. Safe to call often. */
export async function sendQueuedTexts(conn: Conn) {
  const m = conn.db.messaging.id.find(0);
  const creds = [...conn.db.workerMessaging.iter()][0];
  if (!m || !m.enabled || !creds) return;
  const queued = [...conn.db.textMessage.iter()]
    .filter(t => t.direction === 'out' && t.status === 'queued' && !inFlight.has(t.id.toString()))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const t of queued) {
    inFlight.add(t.id.toString());
    try {
      const a = await spectrumFor(m.address, creds.token);
      const space = await spaceFor(a, creds.phone);
      await space.send(t.body);
      await conn.reducers.markTextSent({ id: t.id, ok: true, error: '' });
      console.log(`[texts] sent #${t.id} (${t.kind})`);
    } catch (e) {
      const msg = safeError(e);
      await conn.reducers.markTextSent({ id: t.id, ok: false, error: msg }).catch(() => undefined);
      console.warn(`[texts] #${t.id} failed: ${msg}`);
    } finally {
      inFlight.delete(t.id.toString());
    }
  }
}
