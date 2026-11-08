import type { Role, TaskType } from './types';

/** Rough token estimate: about 4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Max output tokens each role may ask for. Reservations use this as the worst case. */
export const MAX_OUTPUT_TOKENS: Record<Role, number> = {
  translator: 500,
  manager: 900,
  auditor: 1500,
  researcher: 1500,
  updater: 1000,
  developer: 2000,
  tester: 800,
  purser: 900,
  reviewer: 900,
  marketer: 1200,
  communicator: 1000,
};

/**
 * Minimum input tokens reserved per task type. Prompts carry repo and database context
 * that a plain estimate of the instructions does not see, so reservations never go below these.
 * Code on Gemini: 3000 in x $0.30/M + 2000 out x $2.50/M = 5_900 micros worst case.
 */
export const MIN_INPUT_TOKENS: Record<TaskType, number> = {
  code: 3000,
  review: 2000,
  research: 3000,
  marketing: 2000,
  chat: 1500,
  general: 2500,
};

export function reservationFor(role: string, taskType: string, prompt: string): { inputTokens: number; maxOutputTokens: number } {
  const minIn = MIN_INPUT_TOKENS[taskType as TaskType] ?? 2000;
  const maxOut = MAX_OUTPUT_TOKENS[role as Role] ?? 1000;
  return { inputTokens: Math.max(minIn, estimateTokens(prompt)), maxOutputTokens: maxOut };
}

/** Same rounding as the module: micro-dollars, rounded up. */
export function costMicros(priceInPerMTok: bigint, priceOutPerMTok: bigint, inTok: bigint, outTok: bigint): bigint {
  return (inTok * priceInPerMTok + outTok * priceOutPerMTok + 999_999n) / 1_000_000n;
}

/** "$1.23", or "$0.0026" for amounts under a cent so small runs don't read as free. */
export function formatUsd(micros: bigint): string {
  const neg = micros < 0n;
  const m = neg ? -micros : micros;
  if (m > 0n && m < 10_000n) {
    const tenThousandths = (m + 50n) / 100n;
    return `${neg ? '-' : ''}$0.${tenThousandths.toString().padStart(4, '0')}`;
  }
  const cents = (m + 5_000n) / 10_000n;
  return `${neg ? '-' : ''}$${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}
