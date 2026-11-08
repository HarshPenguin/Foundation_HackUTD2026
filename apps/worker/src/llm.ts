import type { CompletionRequest } from '@foundation/shared';
import type { Employee, Task } from './module_bindings/types';
import { adapterFor, ProviderError } from './providers/index';
import type { Db } from './db';
import { env, sleep } from './env';

export interface ThinkResult {
  text: string;
  /** true when a real provider answered (not simulated, not the offline playbook) */
  live: boolean;
  /** true when the canned playbook text was used because the real call failed */
  offline: boolean;
  providerName: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * One LLM step for a reserved, claimed task: call the task's provider, then commitSpend with the
 * real usage. Never throws for provider problems: falls back to `req.canned` and logs why.
 */
export async function think(db: Db, task: Task, employee: Employee, req: CompletionRequest): Promise<ThinkResult> {
  const fresh = db.task(task.id) ?? task;
  const provider = db.provider(fresh.providerId);
  const canned = req.canned ?? '';
  if (!provider) {
    return { text: canned, live: false, offline: true, providerName: 'none', inputTokens: 0, outputTokens: 0 };
  }
  const adapter = adapterFor(provider, db.providerSetup(provider));
  let text = canned;
  let inputTokens = 0;
  let outputTokens = 0;
  let live = false;
  let offline = false;
  try {
    const res = await adapter.complete({ ...req, contextTokens: req.contextTokens ?? Number(fresh.inputTokens) });
    text = res.text;
    inputTokens = res.inputTokens;
    outputTokens = res.outputTokens;
    live = !adapter.isSimulated;
  } catch (err) {
    offline = true;
    // The offline playbook still takes a moment, so the live panel reads naturally.
    await sleep(Math.round((1200 + Math.random() * 1000) * Math.min(env.pace, 1.5)));
    const pe = err instanceof ProviderError ? err : new ProviderError((err as Error).message ?? String(err));
    console.warn(`[llm] ${provider.name} call failed for task ${task.id}: ${pe.message}`);
    if (pe.usage) {
      inputTokens = pe.usage.inputTokens;
      outputTokens = pe.usage.outputTokens;
    }
    // Real-world stops: out of credits, or the key was rejected. The Purser stops the provider so the
    // next task switches down the fallback chain (or asks the owner in Manual mode).
    // Gemini reports a bad key as 400 "Please pass a valid API key".
    const keyRejected = pe.status === 401 || pe.status === 403 || (pe.status === 400 && /api[ _-]?key/i.test(pe.message));
    if (pe.budgetExhausted || keyRejected) {
      const why = pe.budgetExhausted ? 'AI credits used up' : 'API key was rejected';
      try {
        await db.r.markProviderStopped({ providerId: provider.id, reason: `${provider.name} ${why}` });
      } catch (e) {
        console.warn('[llm] markProviderStopped failed:', (e as Error).message);
      }
      await db.log(task.runId, employee.id, 'budget', `${provider.name}: ${why}. The Purser stopped it, so ${employee.displayName} used its offline playbook and the next task switches models`);
    } else {
      await db.log(task.runId, employee.id, 'info', `${provider.name} was unreachable, so ${employee.displayName} used its offline playbook`);
    }
  }
  try {
    await db.r.commitSpend({ taskId: task.id, inputTokens: BigInt(inputTokens), outputTokens: BigInt(outputTokens) });
  } catch (err) {
    console.warn(`[llm] commitSpend failed for task ${task.id}:`, (err as Error).message);
  }
  return { text, live, offline, providerName: provider.name, inputTokens, outputTokens };
}
