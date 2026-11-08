import type { Provider, ProviderConfig } from '../module_bindings/types';
import { env } from '../env';
import { AnthropicProvider } from './anthropic';
import { OpenAICompatProvider } from './openaiCompat';
import { SimulatedProvider } from './simulated';
import type { LlmProvider } from './types';

export { ProviderError, type LlmProvider } from './types';

const cache = new Map<string, LlmProvider>();

export interface ProviderSetup {
  config?: ProviderConfig;
  /** API key from the worker-only `worker_secret` view; undefined if none. */
  apiKey?: string;
}

/**
 * Picks the adapter for a provider row:
 *  - simulated rows get canned output (MOCK wallets),
 *  - "Maritime" (or kind maritime) uses the Maritime LLM token injected into the agent,
 *  - openai_compatible uses the saved base URL + key (Hugging Face, Gemini, OpenAI, AIsa, ...),
 *  - anthropic uses the Anthropic SDK with the saved key.
 */
export function adapterFor(p: Provider, setup: ProviderSetup = {}): LlmProvider {
  const cfg = setup.config;
  const kind = p.isSimulated ? 'simulated' : cfg?.kind ?? (p.name === 'Maritime' ? 'maritime' : 'maritime');
  const key = setup.apiKey ?? '';
  const cacheKey = `${p.id}:${p.model}:${kind}:${cfg?.baseUrl ?? ''}:${key.slice(-6)}`;
  let a = cache.get(cacheKey);
  if (a) return a;
  if (kind === 'simulated') a = new SimulatedProvider(p.name, p.model);
  else if (kind === 'anthropic') a = new AnthropicProvider(p.name, p.model, key, cfg?.baseUrl || undefined);
  else if (kind === 'openai_compatible') a = new OpenAICompatProvider(p.name, p.model, cfg?.baseUrl ?? '', key);
  // Maritime: the agent's injected OPENAI_API_KEY/OPENAI_BASE_URL (or a saved key, if the owner gave one).
  else a = new OpenAICompatProvider(p.name, p.model, cfg?.baseUrl || env.llmBaseUrl, key || env.llmKey);
  cache.set(cacheKey, a);
  return a;
}
