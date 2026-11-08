export type Role =
  | 'translator'
  | 'manager'
  | 'auditor'
  | 'researcher'
  | 'updater'
  | 'developer'
  | 'tester'
  | 'purser'
  | 'reviewer'
  | 'marketer'
  | 'communicator';

export type TaskType = 'research' | 'code' | 'review' | 'marketing' | 'chat' | 'general';

export type TaskStatus = 'queued' | 'reserved' | 'running' | 'waiting_user' | 'blocked' | 'done' | 'rejected' | 'failed';

export type ReportKind =
  | 'weekly_update'
  | 'performance_review'
  | 'marketing_strategy'
  | 'audit'
  | 'research'
  | 'insights'
  | 'update_plan';

export type ActivityKind = 'plan' | 'work' | 'review' | 'switch' | 'hire' | 'fire' | 'budget' | 'info';

/** A known, fixable problem in the MediClaim demo app. */
export type FixKey = 'sqli' | 'rounding' | 'config_secret' | 'jquery';

/** JSON stored in a Developer task's `input`. */
export interface DevTaskInput {
  fixKey: FixKey;
  file: string;
  instructions: string;
  attempt?: number;
  testerFeedback?: string;
}

/** JSON stored in a Tester task's `input`. */
export interface TesterTaskInput {
  devTaskId: string; // u64 as a decimal string
  branch: string;
  file: string;
  fixKey: FixKey;
}

/** JSON the Manager LLM returns. */
export interface ManagerPlan {
  summary: string;
  tasks: Array<{ fixKey: FixKey; developer: string; title: string; why: string }>;
}

export type DirectiveIntent = 'question' | 'start_maintenance' | 'billing' | 'status' | 'other';

/** JSON the Translator attaches to its reply (chat_message.directiveJson). */
export interface Directive {
  intent: DirectiveIntent;
  summary: string;
}

export interface CompletionRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
  jsonMode?: boolean;
  /** Text a simulated provider returns. Real providers ignore it. */
  canned?: string;
  /** Input tokens reserved for this call (prompt + repo/database context). Simulated providers bill close to this. */
  contextTokens?: number;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
