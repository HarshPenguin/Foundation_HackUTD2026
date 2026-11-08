import type { CompletionRequest, CompletionResult } from '@foundation/shared';

export interface LlmProvider {
  name: string;
  model: string;
  isSimulated: boolean;
  estimateTokens(prompt: string): number;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    /** Tokens billed even though the call failed (e.g. reply cut off). */
    public usage?: { inputTokens: number; outputTokens: number }
  ) {
    super(message);
  }
  get budgetExhausted() {
    return this.status === 402 || this.code === 'budget_exhausted';
  }
}
