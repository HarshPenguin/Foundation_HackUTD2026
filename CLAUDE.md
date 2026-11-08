# Foundation
AI maintenance team for legacy and vibe-coded software: it understands, repairs, and modernizes
outdated code on a schedule you set. Also an API credit manager with per-provider thresholds
($0 default), switch-or-upgrade, and a weekly spending lock.
HackUTD 2026 — 8090 + SpacetimeDB tracks. Deadline: submit 10:30 AM 2026-11-08.
Full brief: docs/FOUNDATION_KICKOFF.md

## Layout
apps/module (SpacetimeDB TS module) · apps/web (React/Vite/Tailwind/shadcn) · apps/worker (Node agents)
legacy-demo/ (fake "MediClaim" PHP app, planted bugs — do NOT fix outside agent runs) · packages/shared

## Rules
- Budget/threshold/lock rules live ONLY in module reducers. Never trust the worker or web for them.
- Reducers: deterministic, no network, no Date.now()/Math.random() — use the reducer context.
- LLM calls happen only in apps/worker via provider adapters. Real provider: Maritime LLM
  (OpenAI-compatible, base https://api.maritime.sh/api/llm/v1, token `mllm_...` from env). Others simulated.
- Every fake is marked `// MOCK:` with a one-line note on how to make it real.
- UI copy: "employees", "My Finances", "My Developers", "My Communications", "Switch or upgrade".
  Sentence case, no exclamation marks.
- After changing module tables/reducers: regenerate bindings (`spacetime generate`) and typecheck web.
- Never read or print .env files. Never commit secrets.
- The demo must work with all LLM calls failing (seed data via seed_demo()).

## Commands
pnpm dev · pnpm typecheck · spacetime publish · spacetime generate · spacetime logs
(verify exact flags against the official SpacetimeDB skills/docs)
