// Sends the owner's queued texts through Photon (iMessage, with SMS fallback).
// SpacetimeDB decides what to send (text_message rows); this only delivers them.
import { createHttpClient } from '@photon-ai/advanced-imessage';
import type { Conn } from './stdb';

type PhotonClient = ReturnType<typeof createHttpClient>;

let client: PhotonClient | undefined;
let clientKey = '';
const chatGuids = new Map<string, string>();
const inFlight = new Set<string>();

function photonFor(address: string, token: string, server: string): PhotonClient {
  const key = `${address}|${server}|${token.slice(-6)}`;
  if (!client || key !== clientKey) {
    client = createHttpClient({ address, token, ...(server ? { server } : {}), timeout: 15_000, retry: { maxAttempts: 3, initialDelay: 300, maxDelay: 3_000 } });
    clientKey = key;
    chatGuids.clear();
  }
  return client;
}

async function chatFor(im: PhotonClient, phone: string): Promise<string> {
  const cached = chatGuids.get(phone);
  if (cached) return cached;
  try {
    const created = await im.chats.create([phone]);
    chatGuids.set(phone, created.chat.guid);
    return created.chat.guid;
  } catch {
    // Fall back to a direct chat GUID; the server resolves iMessage vs SMS.
    const guid = `any;-;${phone}`;
    chatGuids.set(phone, guid);
    return guid;
  }
}

function safeError(e: unknown): string {
  return String((e as Error)?.message ?? e)
    .replace(/(token|bearer)\s*[:=]?\s*\S+/gi, '$1 [hidden]')
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
      const im = photonFor(m.address, creds.token, m.server);
      const chat = await chatFor(im, creds.phone);
      await im.messages.sendText(chat, t.body, { clientMessageId: `foundation-${t.id}` });
      await conn.reducers.markTextSent({ id: t.id, ok: true, error: '' });
      console.log(`[texts] sent #${t.id} (${t.kind})`);
    } catch (e) {
      const msg = safeError(e);
      // A repeated clientMessageId means the original send already went through.
      const duplicate = /duplicate/i.test(msg);
      await conn.reducers.markTextSent({ id: t.id, ok: duplicate, error: duplicate ? '' : msg }).catch(() => undefined);
      console.warn(`[texts] #${t.id} ${duplicate ? 'already sent' : `failed: ${msg}`}`);
    } finally {
      inFlight.delete(t.id.toString());
    }
  }
}
