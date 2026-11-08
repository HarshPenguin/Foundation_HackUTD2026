// Foundation worker: connects to SpacetimeDB as the registered worker and runs the AI crew.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { Db } from './db';
import { env, sleep } from './env';
import { Pipeline } from './pipeline';
import { connect, registerWorker, subscribeAll, type Conn } from './stdb';
import { ensureRepo } from './workspace';

const state = {
  startedAt: new Date().toISOString(),
  connected: false,
  registered: false,
  lastHeartbeatAt: '' as string,
  lastError: '' as string,
};

let pipeline: Pipeline | undefined;
let conn: Conn | undefined;

process.on('unhandledRejection', err => {
  state.lastError = String((err as Error)?.message ?? err);
  console.error('[worker] unhandled rejection:', err);
});
process.on('uncaughtException', err => {
  state.lastError = err.message;
  console.error('[worker] uncaught exception:', err);
});

async function ensureRegistered(c: Conn): Promise<boolean> {
  const ok = await registerWorker(c);
  state.registered = ok;
  if (pipeline) pipeline.enabled = ok;
  if (ok) console.log('[worker] registered as the Foundation worker');
  return ok;
}

async function heartbeat() {
  if (!conn) return;
  try {
    if (!state.registered) {
      await ensureRegistered(conn);
      return;
    }
    await conn.reducers.workerHeartbeat({});
    state.lastHeartbeatAt = new Date().toISOString();
  } catch (err) {
    const msg = (err as Error).message;
    console.warn('[worker] heartbeat failed:', msg);
    // The database may have been republished or the pairing code re-set: register again.
    if (/registered worker|not initialized/i.test(msg)) await ensureRegistered(conn);
  }
}

// ------------------------------------------------------------------ health + chat endpoint (Maritime contract)

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 100_000) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/** POST /chat: forwards the message to the Translator and waits up to 25 s for its reply. */
async function chatViaTranslator(message: string): Promise<string> {
  if (!conn) return 'The crew is starting up. Try again in a moment.';
  const before = [...conn.db.chatMessage.iter()].reduce((m, r) => (r.id > m ? r.id : m), 0n);
  await conn.reducers.sendChat({ text: message });
  const deadline = Date.now() + 25_000;
  let taskId: bigint | undefined;
  while (Date.now() < deadline) {
    const msgs = [...conn.db.chatMessage.iter()].filter(m => m.id > before);
    if (taskId == null) taskId = msgs.find(m => m.role === 'user' && m.text === message.trim().slice(0, 2000))?.taskId ?? undefined;
    const reply = taskId != null ? msgs.find(m => m.role === 'translator' && m.taskId === taskId) : undefined;
    if (reply) return reply.text;
    await sleep(300);
  }
  return "I'm still working on that. The answer will appear in your Foundation chat.";
}

function startHttp() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        return send(res, 200, {
          ok: true,
          service: 'foundation-worker',
          ...state,
          stdb: { uri: env.stdbUri, db: env.stdbDb },
          llm: { baseUrl: env.llmBaseUrl, keyConfigured: Boolean(env.llmKey) },
          pipeline: pipeline?.status(),
        });
      }
      if (req.method === 'POST' && url.pathname === '/chat') {
        const raw = await readBody(req);
        let message = raw;
        try {
          message = (JSON.parse(raw) as { message?: string }).message ?? '';
        } catch {
          /* plain text body */
        }
        if (!message.trim()) return send(res, 400, { response: 'Send {"message": "..."}' });
        return send(res, 200, { response: await chatViaTranslator(message) });
      }
      send(res, 404, { error: 'not found' });
    } catch (err) {
      send(res, 500, { error: (err as Error).message });
    }
  });
  server.on('error', err => console.warn('[http] health server error:', err.message));
  server.listen(env.port, '0.0.0.0', () => console.log(`[http] health on :${env.port} (GET /health, POST /chat)`));
}

// ------------------------------------------------------------------ boot

function fixLocalhost() {
  // Maritime micro-VMs ship an empty /etc/hosts.
  try {
    if (existsSync('/etc/hosts') && !/\blocalhost\b/.test(readFileSync('/etc/hosts', 'utf8'))) appendFileSync('/etc/hosts', '127.0.0.1 localhost\n');
  } catch {
    /* not root: fine */
  }
}

async function main() {
  fixLocalhost();
  console.log(
    `[worker] starting. stdb=${env.stdbUri}/${env.stdbDb} workspace=${env.workspaceDir} llm=${env.llmBaseUrl} key=${env.llmKey ? 'set' : 'not set'} concurrency=${env.concurrency}`
  );
  startHttp();

  for (let attempt = 1; ; attempt++) {
    try {
      conn = await connect({
        onReconnect: c => {
          state.connected = true;
          console.log('[worker] reconnected');
          void ensureRegistered(c);
        },
        onDisconnect: err => {
          state.connected = false;
          console.warn('[worker] disconnected', err?.message ?? '');
        },
      });
      break;
    } catch (err) {
      state.lastError = (err as Error).message;
      const wait = Math.min(30, 2 * attempt);
      console.error(`[worker] could not connect (${(err as Error).message}); retrying in ${wait}s`);
      await sleep(wait * 1000);
    }
  }
  state.connected = true;
  await subscribeAll(conn);
  console.log('[worker] subscribed to all tables');

  pipeline = new Pipeline(new Db(conn));
  await ensureRegistered(conn);
  try {
    await ensureRepo();
  } catch (err) {
    console.warn('[worker] could not prepare the MediClaim workspace yet:', (err as Error).message);
  }

  const kick = () => setTimeout(() => pipeline?.tick(), 30);
  conn.db.task.onInsert(kick);
  conn.db.task.onUpdate(kick);
  conn.db.run.onUpdate(kick);
  setInterval(() => pipeline?.tick(), 1000);
  setInterval(() => void heartbeat(), 30_000);
  void heartbeat();
  pipeline.tick();
  console.log('[worker] ready');

  const stop = () => {
    console.log('[worker] shutting down');
    try {
      conn?.disconnect();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(err => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
