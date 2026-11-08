# Foundation: architecture (Phase 1 draft, pending approval)

## 1. Deployment topology

| Layer | Runs on | What it does |
|---|---|---|
| **Frontend** (`apps/web`) | **Vercel** (static Vite build). Custom domain from GoDaddy if available, otherwise the free `*.vercel.app` URL | The 5 pages. Subscribes to SpacetimeDB directly over websocket. No backend of its own |
| **Database + all rules** (`apps/module`) | **SpacetimeDB Maincloud** | Tables, reducers, schedules. Budget, threshold, lock, switch-or-upgrade, fire-and-replace all enforced here |
| **Agent runtime** (`apps/worker`) | **Maritime agent box** (persistent micro-VM, Dockerfile at `apps/worker`) | Claims tasks, runs employees, git branches on `legacy-demo`, runs the Tester's checks. Gets the `mllm_` token injected automatically |
| **Real LLM** | **Maritime LLM** (OpenAI-compatible, `https://api.maritime.sh/api/llm/v1`) | The one real provider. `402 budget_exhausted` maps to "provider stopped" |
| **Simulated LLMs** | Inside the worker | Gemini, OpenAI, Nemotron (Brev): canned output, fake balances that drain |
| **Vercel functions** (`apps/web/api/`) | Vercel | Thin, stateless only: mock email inbox render, "Connect" integration stubs. Never touches budget logic |

Domain vs. hosting, in one line: a **domain** is the name (`foundation.tech`); **hosting** is the computer that serves the files. Vercel is the hosting; a GoDaddy domain (if we get one) just points at it.

## 2. ADE (development environment)

| Piece | Where | Status |
|---|---|---|
| `CLAUDE.md` | repo root | done |
| `.claude/settings.json` | allowlist (pnpm, spacetime, git read/commit, node, tsc), deny `.env*` reads, PostToolUse typecheck hook | done |
| Subagents | `.claude/agents/`: `stdb-module`, `web-ui`, `worker-agents`, `demo-reviewer` | done |
| Skills | `.claude/skills/spacetimedb-{typescript-server,concepts,cli}` (official Clockwork Labs rules shipped with SpacetimeDB 2.14.1) + built-in `claude-api` | done |
| SpacetimeDB CLI | cloud session: installed 2.14.1. Your PC: optional (see README) | done here |
| Maritime | LLM token: needs an `mllm_` token (the saved one is an `mk_` account key). Maritime MCP on your PC: optional | pending |
| MCP servers | Context7 / GitHub / Playwright: Playwright is preinstalled here; GitHub is replaced by the git-bundle handoff; Context7 skipped (official skills cover SpacetimeDB) | adjusted |
| Parallel sessions | After schema freeze: subagents `stdb-module` + `worker-agents` and `web-ui` work in parallel on disjoint folders | planned |
| GitHub | git-bundle handoff (you push from your laptop) | in use |

## 3. Tables (SpacetimeDB 2.x TypeScript)

All tables are `public` (single-tenant demo; one owner). Enum-like fields are short strings for speed; allowed values listed.
Money is stored in **micro-dollars** (`u64`, 1 USD = 1,000,000) to avoid float bugs (the same bug we plant in MediClaim).

| Table | Columns |
|---|---|
| `settings` (1 row, id=0) | mode `autonomous\|manual`, commChannel `email\|in_app\|sms`, commFrequency `weekly\|daily\|monthly`, ownerName, managerOptimizesCadence bool |
| `project` | id, name, repoPath, stackSummary, healthScore u32 (0–100), lastAuditAt |
| `employee` | id, role `translator\|manager\|auditor\|researcher\|updater\|developer\|tester\|purser\|reviewer\|marketer\|communicator`, displayName ("Dev-Security"), generation u32, status `active\|on_review\|fired`, model, providerId, cadence `on_demand\|daily\|weekly\|monthly\|quarterly`, lastRunAt option, promptVersion u32, handoffNote |
| `provider` | id, name, isSimulated, balanceMicros, thresholdMicros (default 0), priceInPerMTok, priceOutPerMTok (micros per 1M tokens), status `healthy\|low\|stopped` |
| `fallback_chain` | taskType PK `research\|code\|review\|marketing\|chat\|general`, providerIds `u64[]` (ordered) |
| `budget` (1 row, id=0) | weekStart timestamp, limitMicros, spentMicros, reservedMicros, spendLocked bool (default true), autonomousHalted bool |
| `spend_event` | id, taskId, providerId, estMicros, actualMicros, kind `reserve\|commit\|release\|switch`, at |
| `run` | id, trigger `schedule\|manual\|chat`, status `running\|done\|halted`, startedAt, endedAt option, totalMicros |
| `task` | id, runId, employeeId, taskType, status `queued\|reserved\|running\|waiting_user\|done\|rejected\|failed`, title, input, output, branch, diff, providerId option, estMicros, costMicros, claimedBy option(identity), createdAt |
| `activity` | id, runId, employeeId, kind `plan\|work\|review\|switch\|hire\|fire\|budget\|info`, message, at (index on runId) |
| `notification` | id, kind `needs_input\|switch_or_upgrade\|budget_halt\|info`, title, body, taskId option, providerId option, resolved bool, createdAt |
| `chat_message` | id, role `user\|translator`, text, directiveJson, at |
| `report` | id, kind `weekly_update\|performance_review\|marketing_strategy\|audit\|research\|insights`, authorEmployeeId, title, bodyMd, period, at |
| `review` | id, employeeId, period, score u32, tasksDone, rejections, failures, costPerAcceptedMicros, recommendation `keep\|coach\|replace`, summary |
| `cadence_timer` (scheduled) | scheduledId, scheduledAt, employeeId → `onCadence` reducer creates a run + task |
| `week_rollover_timer` (scheduled) | weekly → resets budget, re-locks spending, clears autonomousHalted |

## 4. Reducers

| Reducer | Caller | Rule |
|---|---|---|
| `reserveBudget(taskId, estMicros)` | worker | §5.1 of the brief: walks the task type's fallback chain; first provider with `balance − est ≥ threshold` AND weekly room (unless unlocked) wins. Autonomous: switch + log. Manual: `waiting_user` + `switch_or_upgrade` notification. None pass: autonomous → `autonomousHalted`; manual → notify |
| `commitSpend(taskId, actualMicros)` | worker | Releases reservation, charges actual, updates provider status (`low` under 20%, `stopped` at threshold) |
| `markProviderStopped(providerId, reason)` | worker | Real-world signal (Maritime 402) → status `stopped` |
| `resolveSwitchOrUpgrade(notificationId, choice)` | web | `switch` → next in chain, re-queue. `upgrade` → `// MOCK:` add $20 |
| `unlockSpending(confirmPhrase)` / `lockSpending()` | web | Phrase must equal `UNLOCK` |
| `setMode`, `setThreshold`, `setCadence`, `setWeeklyBudget`, `setFallbackChain`, `setCommPrefs` | web | Validation in reducer |
| `sendChat(text)` | web | Inserts user message + Translator task |
| `startRun(trigger)` | web ("Run now") / scheduler | Creates run + Manager planning task |
| `claimTask(taskId)` / `completeTask(taskId, output, branch, diff, status)` / `logActivity(...)` / `createTask(...)` | worker | Worker can't skip `reserveBudget`: `claimTask` only works on `reserved` tasks |
| `writeReport`, `writeReview` | worker | |
| `fireAndReplace(employeeId, reason)` | web / worker (Manager) | Old → `fired`, new row with `generation+1`, fresh context + handoff note; logs `hire`/`fire` activity. Translator can't be fired |
| `seedDemo()` / `init` | publish | Idempotent: 11 employees, 4 providers (Maritime real; Gemini low balance so it drains mid-run), chains, a finished past run with activity, reports, reviews (Researcher on review) |

## 5. Run pipeline (demo)

`startRun` → Manager task → worker plans (real LLM) → creates Developer tasks (fix SQL injection, fix rounding) → `reserveBudget` (Gemini first in `code` chain, low balance → mid-run switch to Maritime) → Developer patches `legacy-demo` on branch `foundation/fix-*` → Tester runs `php -l`-style checks + LLM review → approve/reject → Reviewer + Communicator write report. Every step logs `activity`, so the live panel streams it.

If every LLM call fails, the worker falls back to canned outputs per employee (still real reducers, real budget math), and `seedDemo` covers every screen.

## 6. Folder layout

```
Foundation/
├─ CLAUDE.md · .claude/ (settings, agents, skills)
├─ apps/module   SpacetimeDB TS module
├─ apps/web      React + Vite + Tailwind + shadcn/ui → Vercel
├─ apps/worker   Node/TS agent runtime + Dockerfile → Maritime
├─ legacy-demo/  "MediClaim" PHP 5 app with planted bugs
├─ packages/shared  cost estimator, prompts, types
└─ docs/  DEVPOST.md, FOUNDATION_KICKOFF.md, architecture.md, demo-script.md
```
