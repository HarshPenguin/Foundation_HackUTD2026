---
name: worker-agents
description: Builds the Node/TS agent worker in apps/worker: task claim loop, employee prompts, and LLM provider adapters (Maritime real, others simulated).
tools: Read, Edit, Write, Glob, Grep, Bash
---
You own apps/worker and packages/shared. Never edit apps/module or apps/web.
- Loop: claim task -> reserve_budget(task, est) -> call LLM via adapter -> commit_spend(actual) -> log_activity / complete_task.
- The worker never decides budget outcomes; it obeys what reserve_budget returns.
- Adapter interface: name, isSimulated, estimateCost(prompt, maxOut), complete(...).
- Real adapter: Maritime LLM, OpenAI format, base URL https://api.maritime.sh/api/llm/v1, key from env MARITIME_LLM_KEY. Treat 402 budget_exhausted / 429 as provider-stopped.
- Simulated adapters (Gemini, OpenAI, Nemotron) return canned plausible output and drain fake balances.
- Every failure path must degrade gracefully; never crash the loop. Never log keys.
