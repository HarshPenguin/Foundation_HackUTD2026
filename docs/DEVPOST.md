# Devpost submission: HackUTD 2026

> Tracks: **8090 Solutions (Legacy System Modernization)** and **SpacetimeDB**
> Final submission: 12 PM, 2026-11-08. `[CHECK]` marks anything to confirm before submitting.

---

## Project name
Foundation

## Elevator pitch (≤ 200 chars)
An AI maintenance team for legacy and vibe-coded software. It understands, repairs and modernizes your app on a schedule, and manages every AI key and bill with a $0 hard stop.

---

## About the project
*(Paste everything between the two lines below into Devpost's "About the project" field. It supports Markdown and LaTeX.)*

---

## Inspiration

The world runs on old software that nobody fully understands. Medicare alone made **\$28.8 billion in improper payments** last year, through claims systems built on decades-old code. Large organizations pay consultants to keep systems like that alive. Small businesses, clinics, nonprofits and solo founders can't.

There's a newer version of the same problem. Tools like Base44 and Lovable let anyone ship an app in an afternoon. Then the dependencies age, security holes open up, and the person who "built" it can't read the code. **Every vibe-coded app becomes a legacy app the day it ships.**

Talking with the 8090 team raised two more questions:

1. **"Couldn't I just do this with one prompt in Claude Code?"** One prompt can fix one bug. It can't give you *ongoing ownership*: a team that remembers last week, runs on a schedule, reviews its own work and answers to you. And if you already use Claude Code, Foundation should work *with* it, not compete with it.
2. **AI bills are a minefield.** Non-technical builders juggle keys for Claude, Gemini, OpenAI and more, each with its own limits and dashboards. They usually find out a key ran dry, or a bill exploded, after it happened.

So I built a persistent AI dev team for **post-production**, with a finance department that won't let it overspend.

## What it does

Foundation gives a non-technical owner a **virtual dev team** for an existing or legacy app. Each AI agent is presented as an **employee**:

| Employee | Job |
|---|---|
| **Chatbot** | The only employee you talk to. Turns plain English into work for the Manager and answers in plain English. Can't be fired. |
| **Manager** | Plans each cycle, assigns tasks, acts on performance reviews. |
| **Auditor** | Clones your repo and maps it: how it works in plain English, its stack, and every risky line (`file:line`). |
| **Researcher → Updater** | Gathers deprecations and CVEs for your stack; the Updater turns them into update plans. |
| **Developers** | Patch bugs and upgrade code, always on a separate git branch. |
| **Tester** | Runs real checks (`php -l` plus behavioral PHP checks) and approves or rejects each change. Developers never approve their own work. |
| **Purser** | The finance department: deterministic budget rules (enforced in the database) plus spending insights. |
| **Reviewer** | Writes performance reviews from real metrics and recommends **fire and replace** (same role, fresh context, revised brief). |
| **Marketer · Communicator** | Turn what shipped into a marketing plan, and send you the weekly update. |

### Five pages
- **Home:** a ChatGPT-style chat with the Chatbot, plus at-a-glance cards.
- **My Finances:** every API wallet, thresholds, the spending lock, drag-to-reorder fallback chains, a budget calculator, insights, and Claude Code spending.
- **My Developers:** Autonomous/Manual mode, the org chart, a live panel streaming the crew's work, code diffs, and fire and replace.
- **My Communications:** weekly updates, performance reviews, marketing strategies, audits and research.
- **Settings:** cadences, budget defaults, integrations, owner passcode.

### Connect your code
Paste a public GitHub, GitLab or Bitbucket link. Base44 and Lovable apps work too, via their "Export to GitHub" button. Then:
1. **The Auditor clones it** onto the crew's machine on Maritime and reads every file. No AI key is needed for this part: a built-in scanner finds the stack, outdated libraries and risky patterns. Those include SQL injection, command injection, XSS, `eval`, hardcoded passwords, weak password hashing and removed `mysql_*` calls, each with its exact `file:line`.
2. **It writes "How your app works"** with a health score. With an AI key, a model adds a plain-English summary.
3. **Run now:** the Manager plans fixes from those real findings.
   - **With an AI key:** Developers patch on git branches in the crew's clone. The Tester lints the file and re-runs the scanner to confirm the risk is gone.
   - **Without one:** Developers write up the exact fix instead of pretending.

In the demo I connected **DVWA**, a well-known legacy PHP app. Foundation read 242 files, found 30 risks across 7 kinds, and planned its first fixes.

### Onboarding: bring any model
A short onboarding asks about your app (stack, repo, what worries you), which AI providers you have, which model should do which job, and your budget and schedule. The crew's fallback chains are built from your answers. Foundation supports:
- **Anything OpenAI-compatible:** Maritime, Hugging Face (Llama, DeepSeek, Qwen, gpt-oss…), Gemini, OpenAI, or any custom base URL.
- **Claude** through Anthropic's official SDK.

Keys go into a **private** SpacetimeDB table. A per-identity **view** returns them only to the registered crew worker, so they never come back to a browser.

### The Purser: a $0 hard stop, enforced in the database
Before every task the worker asks the database to reserve the **worst case** cost:

$$\hat{C}_{\text{task}} = t^{\text{in}} \, p^{\text{in}}_k + t^{\text{out}}_{\max} \, p^{\text{out}}_k$$

A task may run on provider $k$ only if

$$B_k - R_k - \hat{C}_{\text{task}} \ge \tau_k \quad \text{and} \quad S + R + \hat{C}_{\text{task}} \le L \;\;(\text{while spending is locked})$$

where $B_k$ is the provider's balance, $R_k$ what's already reserved on it, $\tau_k$ your threshold (default $\tau_k = 0$), and $S$, $R$, $L$ the week's spent, reserved and limit. Afterwards only the actual cost is charged and the rest is released. A stuck reservation is released after 10 minutes.

If a provider fails the check, **or fails for real** (Maritime returns "out of AI credits", or an API key is rejected), the Purser stops it:
- **Autonomous mode:** the crew switches to the next model in your fallback chain.
- **Manual mode:** you get a **Switch or upgrade** prompt.

If nothing passes, autonomous work pauses for the week instead of spending more. Unlocking needs you to type `UNLOCK`.

### Works with Claude Code
If you already use Claude Code, keep it. Foundation's Claude Code integration adds:
- **Spend tracking:** a `Stop` hook reports each session's tokens. Foundation prices them at current Claude list prices (including cache reads and writes) and charges your weekly budget. Reports are cumulative, so nothing is double-charged.
- **The same $0 hard stop:** a `UserPromptSubmit` hook asks a SpacetimeDB reducer before every prompt. When the budget says stop, Claude Code blocks the prompt and says why.
- **An MCP server** so Claude Code can work with the crew: `foundation_status`, `foundation_app_audit`, `foundation_recent_changes`, `foundation_ask_chatbot`, `foundation_request_work`.

### Demo
I built a deliberately legacy **Medicare-style claims app, "MediClaim"** (PHP 5, jQuery 1.4, SQL inside page code). It has an SQL injection hole, a claim-total **rounding bug** (the small kind of error that adds up to improper payments), a hardcoded database password, outdated jQuery, dead code and no tests. The crew audits it, patches it on real git branches, tests the patches with real PHP checks, and reports back. Mid-run, a provider runs dry and the Purser switches models live on screen.

## How I built it

- **SpacetimeDB is the crew's office and its rulebook.**
  - 27 tables (employees, tasks, runs, activity, wallets, budgets, fallback chains, reviews, reports, integrations, onboarding, schedules).
  - The React dashboard subscribes to them, so the live panel and spend meters update in real time with no polling and no API server.
  - Every budget, threshold, lock and switch rule runs **inside reducers**, so no client, agent or Claude Code session can get around them.
  - **Scheduled reducers** run each employee's cadence, the weekly budget reset and the reservation timeouts.
  - A **scheduled procedure makes an outbound HTTP call to wake the crew** on Maritime when work is queued.
  - A **per-identity view** hands API keys only to the worker.
- **Maritime hosts the crew.** The worker runs in a Maritime agent box (a persistent micro-VM with PHP and git). Maritime machines sleep when idle, so when work is queued and the crew goes quiet, a SpacetimeDB scheduled procedure calls Maritime's webhook. The crew wakes from its snapshot, reconnects and answers, about 20 seconds from a sleeping start.
- **The worker** (Node/TypeScript) is a SpacetimeDB client. It claims tasks, calls models through provider adapters (one OpenAI-compatible, one on the Anthropic SDK), and reports every step and token back through reducers. Even when every model call fails, the demo still works, because each employee has an offline playbook.
- **Frontend:** React, Vite, Tailwind v4, Radix/shadcn-style components, deployed on Vercel.
- **Claude Code integration:** a small npm package with hooks and an MCP server (official MCP TypeScript SDK) that talks to SpacetimeDB over its HTTP API.
- **Built with Claude Code.** I'm a solo first-year CS student, so I ran my own small crew: parallel Claude Code subagents for the module, the UI and the worker.

## Challenges I ran into

- **Autonomy without chaos.** Letting agents act alone meant designing the guardrails first: branches only, a separate Tester, a full activity log, and a spending limit no agent can override.
- **Thinking in SpacetimeDB.** Logic runs inside the database instead of behind a REST API. Once that clicked, it was the right place for every money rule, and even for waking the crew.
- **Reserving before spending.** Token counts aren't known in advance, so I reserve the worst case, charge the actual cost, and release the rest, with a timeout for crashed workers.
- **Hosting agents that sleep.** Maritime machines sleep when idle, so a long-lived worker kept losing its connection. The fix was making the database wake the crew and having the worker detect a stale socket and reconnect.
- **Keeping keys out of browsers** while still letting the worker use them: a private table plus an identity-checked view.

## Accomplishments I'm proud of

- Real switching on **real** failures: when Maritime said "out of AI credits" and when fake keys were rejected by Hugging Face, Gemini and Claude, the Purser stopped each provider and the crew moved down the chain by itself.
- The $0 hard stop extends to **Claude Code**: an over-budget prompt is blocked before it reaches the model.
- The whole stack is live: Vercel, Maincloud and Maritime.

## What I learned

- The hard part of agentic maintenance is **trust**, not code generation: visibility, review, a clear chain of responsibility and cost control.
- Real-time databases are a natural fit for showing what multi-agent systems are doing.
- How fast "small" AI costs add up across providers, and why non-technical builders need a hard stop.

## What's next

- Private repos and real pull requests (GitHub App), instead of branches in the crew's own clone.
- Reading true balances from provider billing APIs (Anthropic Admin API, AWS Budgets) instead of allowances you set.
- Real authentication (Supabase) and per-user encryption for stored keys.
- One-click Base44 and Lovable connections, and COBOL support.

---

## What's real and what's a prototype

| Real (working end to end) | Prototype (labeled `// MOCK:` in the code) |
|---|---|
| SpacetimeDB module: all budget, threshold, lock and switch rules in reducers; schedules; wake procedure; worker-only key view | Wallet balances are **allowances you set**, not read from each provider's billing |
| Live dashboard (Vercel) on Maincloud subscriptions | Providers without a key run as **simulated** wallets with canned output |
| Crew worker hosted on Maritime; connect a public repo, clone it, scan every file (real findings); real git branches and checks | Email: the weekly update is stored and shown in a mock inbox, not sent |
| Real model adapters: OpenAI-compatible (Maritime, Hugging Face, Gemini, OpenAI, custom) and Claude (Anthropic SDK) | Login is a shared owner passcode (stand-in for Supabase Auth) |
| Onboarding that configures providers, chains, budget and schedule | GitHub, Base44, AWS Budgets and Supabase "Connect" buttons |
| Claude Code hooks (spend tracking, hard stop) and MCP server | "Upgrade" adds $20 of mock credit |

## Built with
`spacetimedb` · `typescript` · `react` · `vite` · `tailwindcss` · `radix-ui` · `node.js` · `maritime` · `vercel` · `anthropic-sdk` · `claude` · `claude-code` · `model-context-protocol` · `openai-api` · `hugging-face` · `gemini` · `php` · `git`

## Links
- GitHub: https://github.com/HarshPenguin/Foundation_HackUTD2026
- Live demo: https://foundation-hackutd.vercel.app (owner passcode for the demo: ask at the table) `[CHECK]`
- Demo video: `[CHECK: add after recording]`
