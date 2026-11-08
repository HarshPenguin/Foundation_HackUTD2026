import Anthropic from '@anthropic-ai/sdk';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { estimateTokens, type CompletionRequest, type CompletionResult } from '@foundation/shared';
import { env } from '../env';
import { shortMessage } from './openaiCompat';
import { ProviderError, type LlmProvider } from './types';

// Current Claude models: thinking is adaptive by default (no `thinking` param needed), effort is set
// low to keep crew steps cheap, and server-side refusal fallbacks are on for the models that take them.
const EFFORT_MODELS = /^claude-(opus-5|sonnet-5|haiku-5|fable-5|mythos-5|opus-4-[678]|sonnet-4-6)/;
const FALLBACK_MODELS = /^claude-(opus-5|fable-5-1|mythos-5-1|sonnet-5-5)/;

/** Claude through the official Anthropic SDK (bring your own key). */
export class AnthropicProvider implements LlmProvider {
  isSimulated = false;
  private client: Anthropic;
  private useFallbacks: boolean;

  constructor(
    public name: string,
    public model: string,
    apiKey: string,
    baseURL?: string
  ) {
    const proxied = Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);
    this.useFallbacks = FALLBACK_MODELS.test(model);
    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      timeout: env.llmTimeoutMs,
      maxRetries: 0,
      ...(proxied
        ? { fetch: undiciFetch as unknown as typeof fetch, fetchOptions: { dispatcher: new EnvHttpProxyAgent() } as never }
        : {}),
    });
  }

  estimateTokens(prompt: string) {
    return estimateTokens(prompt);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const system = req.jsonMode ? `${req.system}\n\nReply with a single JSON object and nothing else.` : req.system;
    const params = {
      model: this.model,
      // Adaptive thinking shares max_tokens with the answer, so leave headroom above the answer budget.
      max_tokens: Math.max(req.maxOutputTokens * 2, 4096),
      system,
      messages: [{ role: 'user' as const, content: req.user }],
      ...(EFFORT_MODELS.test(this.model) ? { output_config: { effort: 'low' as const } } : {}),
    };
    let res: Anthropic.Beta.BetaMessage | Anthropic.Message;
    try {
      if (this.useFallbacks) {
        try {
          res = await this.client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
        } catch (err) {
          // If the fallback beta is not available to this key, run the plain request instead.
          if (err instanceof Anthropic.BadRequestError && /fallback|beta/i.test(err.message)) {
            this.useFallbacks = false;
            res = await this.client.messages.create(params);
          } else throw err;
        }
      } else {
        res = await this.client.messages.create(params);
      }
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new ProviderError(`HTTP ${err.status ?? '?'}: ${shortMessage(err.message)}`, err.status ?? undefined);
      }
      throw new ProviderError(shortMessage((err as Error).message ?? String(err)));
    }
    const u = res.usage;
    const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const outputTokens = u.output_tokens ?? 0;
    if (res.stop_reason === 'refusal') {
      throw new ProviderError('Claude declined this request', undefined, 'refusal', { inputTokens, outputTokens });
    }
    let text = '';
    for (const block of res.content) if (block.type === 'text') text += block.text;
    if (!text.trim()) {
      throw new ProviderError(`empty reply (stop_reason ${res.stop_reason ?? 'unknown'})`, undefined, 'empty', { inputTokens, outputTokens });
    }
    return { text, inputTokens, outputTokens };
  }
}
