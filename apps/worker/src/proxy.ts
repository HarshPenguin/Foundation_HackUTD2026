// Behind an HTTPS proxy (dev sandboxes, some hosts), Node's built-in WebSocket and fetch ignore
// HTTPS_PROXY. Route both through undici's EnvHttpProxyAgent so SpacetimeDB (wss) works.
import { EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher, WebSocket as UndiciWebSocket } from 'undici';

if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const dispatcher = new EnvHttpProxyAgent();
  setGlobalDispatcher(dispatcher);
  (globalThis as { fetch: unknown }).fetch = ((input: unknown, init?: Record<string, unknown>) =>
    undiciFetch(input as never, { ...(init ?? {}), dispatcher } as never)) as unknown;
  class ProxiedWebSocket extends UndiciWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, { protocols, dispatcher } as never);
    }
  }
  (globalThis as { WebSocket: unknown }).WebSocket = ProxiedWebSocket;
}
