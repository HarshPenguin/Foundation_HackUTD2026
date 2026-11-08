import OpenAI from 'openai';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { estimateTokens, type CompletionRequest, type CompletionResult } from '@foundation/shared';
import { env } from '../env';
import { ProviderError, type LlmProvider } from './types';

/**
 * Any OpenAI-compatible chat API: Maritime LLM, Hugging Face router, Gemini's OpenAI endpoint,
 * OpenAI, AIsa, or any custom /v1/chat/completions base URL.
 */
export class OpenAICompatProvider implements LlmProvider {
  isSimulated = false;
  private client: OpenAI;
  private sendReasoningEffort: boolean;

  constructor(
    public name: string,
    public model: string,
    baseURL: string,
    apiKey: string
  ) {
    // Behind an HTTPS proxy (dev sandboxes), Node's built-in fetch ignores HTTPS_PROXY: route through undici.
    const proxied = Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);
    // reasoning_effort only applies to OpenAI reasoning models; other providers may reject it.
    this.sendReasoningEffort = /(^|\/)(gpt-5|o\d)/i.test(model);
    this.client = new OpenAI({
      apiKey: apiKey || 'placeholder',
      baseURL,
      timeout: env.llmTimeoutMs,
      maxRetries: 0,
      ...(proxied
        ? { fetch: undiciFetch as unknown as typeof fetch, fetchOptions: { dispatcher: new EnvHttpProxyAgent() } as unknown as OpenAI.RequestOptions['fetchOptions'] }
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
        // Some models reject reasoning_effort or json mode; retry once without them.
        if (err instanceof OpenAI.APIError && err.status === 400 && (this.sendReasoningEffort || req.jsonMode)) {
          this.sendReasoningEffort = false;
          req = { ...req, jsonMode: false };
          res = await call();
        } else throw err;
      }
    } catch (err) {
      if (err instanceof OpenAI.APIError) {
        const body = err.error as { code?: string; error?: { code?: string } } | undefined;
        const code = (err.code as string | undefined) ?? body?.code ?? body?.error?.code;
        throw new ProviderError(`HTTP ${err.status ?? '?'}: ${shortMessage(err.message)}`, err.status, code ?? undefined);
      }
      throw new ProviderError(shortMessage((err as Error).message ?? String(err)));
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

export function shortMessage(m: string): string {
  // Never echo key fragments back into logs or the activity feed.
  return m.replace(/\b(mk|mllm|sk|hf|sk-ant|AIza)[-_][A-Za-z0-9*_-]+/g, '[key]').slice(0, 160);
}
