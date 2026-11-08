import OpenAI from 'openai';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { estimateTokens, type CompletionRequest, type CompletionResult } from '@foundation/shared';
import { env } from '../env';
import { ProviderError, type LlmProvider } from './types';

/** The one real provider: Maritime LLM, OpenAI-compatible. */
export class MaritimeProvider implements LlmProvider {
  isSimulated = false;
  private client: OpenAI;
  private sendReasoningEffort = true;

  constructor(
    public name: string,
    public model: string
  ) {
    // Behind an HTTPS proxy (dev sandboxes), Node's built-in fetch ignores HTTPS_PROXY: route through undici.
    const proxied = Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);
    this.client = new OpenAI({
      // Inside a Maritime agent the token is injected as OPENAI_API_KEY. In a sandbox whose
      // proxy injects the Authorization header, any placeholder works.
      apiKey: env.llmKey || 'mllm_placeholder',
      baseURL: env.llmBaseUrl,
      timeout: env.llmTimeoutMs,
      maxRetries: 0,
      ...(proxied
        ? { fetch: undiciFetch as unknown as typeof fetch, fetchOptions: { dispatcher: new EnvHttpProxyAgent() } as unknown as OpenAI.RequestOptions["fetchOptions"] }
        : {}),
    });
  }

  estimateTokens(prompt: string) {
    return estimateTokens(prompt);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const call = async () => {
      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: this.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_completion_tokens: req.maxOutputTokens,
      };
      if (this.sendReasoningEffort) params.reasoning_effort = 'minimal';
      if (req.jsonMode) params.response_format = { type: 'json_object' };
      return this.client.chat.completions.create(params);
    };
    let res: OpenAI.Chat.Completions.ChatCompletion;
    try {
      try {
        res = await call();
      } catch (err) {
        // Some models reject reasoning_effort; retry once without it.
        if (err instanceof OpenAI.APIError && err.status === 400 && /reasoning/i.test(err.message) && this.sendReasoningEffort) {
          this.sendReasoningEffort = false;
          res = await call();
        } else throw err;
      }
    } catch (err) {
      if (err instanceof OpenAI.APIError) {
        const body = err.error as { code?: string; error?: { code?: string } } | undefined;
        const code = (err.code as string | undefined) ?? body?.code ?? body?.error?.code;
        throw new ProviderError(`HTTP ${err.status ?? '?'}: ${shortMessage(err.message)}`, err.status, code ?? undefined);
      }
      throw new ProviderError((err as Error).message ?? String(err));
    }
    const text = res.choices[0]?.message?.content ?? '';
    const inputTokens = res.usage?.prompt_tokens ?? 0;
    const outputTokens = res.usage?.completion_tokens ?? 0;
    if (!text.trim()) {
      throw new ProviderError(`empty reply (finish_reason ${res.choices[0]?.finish_reason ?? 'unknown'})`, undefined, 'empty', {
        inputTokens,
        outputTokens,
      });
    }
    return { text, inputTokens, outputTokens };
  }
}

function shortMessage(m: string): string {
  // Never echo key fragments back into logs or the activity feed.
  return m.replace(/(mk|mllm|sk)_[A-Za-z0-9*_-]+/g, '[key]').slice(0, 160);
}
