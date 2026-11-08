import { estimateTokens, type CompletionRequest, type CompletionResult } from '@foundation/shared';
import { sleep, env } from '../env';
import type { LlmProvider } from './types';

/**
 * MOCK: Gemini, OpenAI and NVIDIA Nemotron are simulated. They return the canned output the caller
 * supplies after 1.5-3 s, and bill plausible token counts so their fake balances drain.
 * Real: swap in each provider's SDK (Gemini API, OpenAI API, NVIDIA NIM on Brev) behind this interface.
 */
export class SimulatedProvider implements LlmProvider {
  isSimulated = true;

  constructor(
    public name: string,
    public model: string
  ) {}

  estimateTokens(prompt: string) {
    return estimateTokens(prompt);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    await sleep(Math.round((1500 + Math.random() * 1500) * Math.max(env.pace, 0.05)));
    const text = req.canned ?? 'Done.';
    const promptTokens = estimateTokens(req.system + req.user);
    const context = Math.max(req.contextTokens ?? 0, promptTokens);
    // Bill most of the reserved context and about a third of the output allowance.
    const inputTokens = Math.round(context * (0.9 + Math.random() * 0.07));
    const outputTokens = Math.min(
      req.maxOutputTokens,
      Math.max(estimateTokens(text), Math.round(req.maxOutputTokens * (0.3 + Math.random() * 0.08)))
    );
    return { text, inputTokens, outputTokens };
  }
}
