// Behind an HTTPS proxy (dev sandboxes, some hosts), Node's built-in WebSocket and fetch ignore
// HTTPS_PROXY. Route both through undici's EnvHttpProxyAgent so SpacetimeDB (wss) works.
import { EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher, WebSocket as UndiciWebSocket } from 'undici';

if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const dispatcher = new EnvHttpProxyAgent();
  setGlobalDispatcher(dispatcher);
  const NativeRequest = globalThis.Request;
  (globalThis as { fetch: unknown }).fetch = (async (input: unknown, init?: Record<string, unknown>) => {
    // SDKs often pass a built-in Request object, which undici's fetch can't read: unpack it.
    if (NativeRequest && input instanceof NativeRequest) {
      const body = input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.arrayBuffer();
      return undiciFetch(input.url, { method: input.method, headers: Object.fromEntries(input.headers as unknown as Iterable<[string, string]>), body, signal: input.signal, ...(init ?? {}), dispatcher } as never);
    }
    return undiciFetch(input as never, { ...(init ?? {}), dispatcher } as never);
  }) as unknown;
  class ProxiedWebSocket extends UndiciWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, { protocols, dispatcher } as never);
    }
  }
  (globalThis as { WebSocket: unknown }).WebSocket = ProxiedWebSocket;
}
