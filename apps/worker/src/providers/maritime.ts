import { env } from '../env';
import { OpenAICompatProvider } from './openaiCompat';

/** Maritime LLM: the OpenAI-compatible proxy, using the token Maritime injects into the agent. */
export class MaritimeProvider extends OpenAICompatProvider {
  constructor(name: string, model: string) {
    super(name, model, env.llmBaseUrl, env.llmKey);
  }
}
