import type { Provider } from '../module_bindings/types';
import { MaritimeProvider } from './maritime';
import { SimulatedProvider } from './simulated';
import type { LlmProvider } from './types';

export { ProviderError, type LlmProvider } from './types';

const cache = new Map<string, LlmProvider>();

/** Picks the adapter for a provider row: real Maritime for non-simulated rows, simulated otherwise. */
export function adapterFor(p: Provider): LlmProvider {
  const key = `${p.id}:${p.model}:${p.isSimulated}`;
  let a = cache.get(key);
  if (!a) {
    a = p.isSimulated ? new SimulatedProvider(p.name, p.model) : new MaritimeProvider(p.name, p.model);
    cache.set(key, a);
  }
  return a;
}
