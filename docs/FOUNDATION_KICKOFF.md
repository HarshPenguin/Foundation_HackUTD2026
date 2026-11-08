# Foundation: Kickoff Brief for Claude Code

> **To the Claude Code session reading this:** this is the full brief for a HackUTD 2026 project. Read all of it before acting. Then do **Phase 0 (ADE setup)** and **Phase 1 (architecture)**, in that order, and ask for approval at each checkpoint marked 🛑. Ask the user for the current time first. The whole plan is time-boxed against the deadline.

---

## 0. The product in two sentences

**Foundation is an AI dev team that maintains and modernizes old or vibe-coded software you can't maintain yourself.** It also manages every AI API key it runs on, with spending limits, automatic model switching, and a hard stop at $0, so it never spends a dollar you didn't approve.

Tagline: *"Legacy code, modernized. APIs, managed. Budget, protected."*

---

## 1. Context and constraints

| Item | Value |
|---|---|
| Event | HackUTD 2026, **8090 Solutions** track (legacy system modernization) + **SpacetimeDB** track |
| Team | Solo, first-year CS student. Explain unfamiliar concepts briefly, then keep going. |
| Final deadline | **Submit by 10:30 AM** (hard deadline 12 PM) on 2026-11-08 |
| Devpost | A v2 draft exists in `DEVPOST.md`. Update it at the end to match this brief (§9). |
| Credits | **Maritime** ($500, user has an API key; see §2.3), **Lovable** (105 credits, UI prototyping only), **NVIDIA Brev** ($60, optional), **GitHub Student Pack** |
| Machine | Windows 11. Node 24, pnpm 10, git installed. **Not installed: `gh`, `spacetime` CLI** |
| Judging priorities | 8090: does it help *understand, improve, or replace* legacy software? SpacetimeDB: is SpacetimeDB central (real-time state, logic in reducers, scheduling)? |

**Working rules for this session**
- Use the user's words in UI copy: "employees," "My Developers," "My Finances," "switch or upgrade."
- Never put API keys in chat, code, or git. Use `.env` files (gitignored) and typed env vars.
- Ask before outward-facing actions: creating the GitHub repo, pushing, deploying, sending email.
- Prefer faking with a polished UI over half-building a backend. Every fake is labeled in code with `// MOCK:` so it can be upgraded later.
- The demo must work **even if every LLM call fails**. Seed data in SpacetimeDB drives every screen, and real agent runs add on top.

---

## 2. Phase 0: ADE setup (do first, ~30 min) 🛑 approve before Phase 1

### 2.1 Install CLIs (ask before running each)
```powershell
winget install GitHub.cli
iwr https://windows.spacetimedb.com -useb | iex   # SpacetimeDB CLI. Confirm the current command at spacetimedb.com/install first.
```
Then `gh auth login` and `spacetime login`. The user runs both themselves, since they're interactive.

### 2.2 Repo and folder
- Ask the user for a permanent folder (not a scratch folder). Call `propose_branch` before the first edit.
- Create the GitHub repo with `gh repo create foundation --private` **only after asking**. Make it public before submitting.
- pnpm workspace monorepo (layout in §4.1).

### 2.3 Maritime key: the first unknown to resolve
Maritime (maritime.sh) is known as **agent hosting** (persistent micro-VMs, $1/agent/month). It's unclear whether the user's key also gives **LLM inference**.
1. Ask the user to check the Maritime dashboard and docs: is there a model endpoint (Anthropic- or OpenAI-compatible base URL)?
2. **If it includes inference:** write a `maritime` provider adapter (§5.4) pointed at that base URL.
3. **If it's hosting only:** use Maritime to host `apps/worker`, and ask the user which LLM key to use for agents.
4. Either way, every provider except one real one is **simulated** (fake balances, canned responses), so the switching demo always works.

### 2.4 Claude Code configuration (create these files)
- **`CLAUDE.md`** at the repo root: use the template in Appendix A.
- **`.claude/settings.json`**:
  - Allowlist: `pnpm *`, `spacetime *`, `git status/diff/log/add/commit`, `node *`, `npx tsc *`.
  - Deny: reading `.env*`.
  - A **PostToolUse hook** that runs `pnpm -s typecheck` after edits to `*.ts`/`*.tsx`.
- **Skills:**
  - Official Clockwork Labs SpacetimeDB skills from `skills.sh/clockworklabs/spacetimedb`. Read each SKILL.md before installing, and use only the official `clockworklabs` ones.
  - The built-in `claude-api` skill, for model IDs and pricing. Don't hardcode prices from memory.
- **MCP servers:** Context7 (current library docs, especially SpacetimeDB and shadcn), GitHub, Playwright (UI screenshots and checks).
- **Custom subagents** in `.claude/agents/`:
  - `stdb-module.md`: writes and changes the SpacetimeDB TypeScript module only. Knows reducers are deterministic, can't do network I/O, and can't read clocks or randomness outside the reducer context.
  - `web-ui.md`: React/shadcn pages only. Consumes generated bindings and never edits the module.
  - `worker-agents.md`: the Node agent worker and LLM provider adapters.
  - `demo-reviewer.md`: read-only. Walks the demo script (§8) with Playwright and reports anything broken or ugly.
- **Parallel sessions:** once the schema is frozen (end of Phase 1), run **web** and **module + worker** in separate worktree sessions. They touch different folders. Bindings are regenerated by the module session and pulled by the web session.

---

## 3. The employees (agents)

Every agent is an "employee" in the UI. **Deterministic rules are code, not LLMs.** The hard stop and budget checks must be enforced in SpacetimeDB reducers, never left to an agent's judgment.

| Employee | Kind | Default cadence | Job |
|---|---|---|---|
| **Translator** | LLM | On every chat message | The only employee the user talks to. Turns plain English into a structured `directive` for the Manager, and turns status back into plain English. **Can't be fired.** |
| **Manager** | LLM | Every run | Turns directives and the Updater's update plans into tasks, assigns them, and **tunes each employee's cadence** within the budget. Acts on Reviewer recommendations (fire and replace). |
| **Auditor** *(added)* | LLM | When an app is connected, then monthly | Maps the legacy codebase: stack, risks, dead code, a plain-English "how your app works." Covers the 8090 "understand" requirement. |
| **Researcher** | LLM | Monthly (weekly / monthly / quarterly) | Gathers raw research on the stack: deprecations, CVEs, current best practices. Sends it to the Updater. |
| **Updater** | LLM | After each research drop | Judges which research findings matter and writes **update plans** for the Developers, routed through the Manager. |
| **Developer(s)** | LLM | Weekly | Carry out tasks on a branch. Can be several instances (e.g. `Dev-Security`, `Dev-Upgrades`). |
| **Tester** *(added)* | LLM + scripts | After each Developer change | Runs checks and reviews the diff, then approves or rejects. Required for safe autonomy. Rejection counts feed the Reviewer. |
| **Purser** | **Code + LLM** | Code: every task. LLM: weekly | **Gatekeeper (code, in reducers):** reserves budget before each task, enforces thresholds, runs switch-or-upgrade. **Analyst (LLM):** spending insights, unused keys, "which APIs you need." |
| **Reviewer** | LLM | Weekly, after the run | Writes **performance reviews** from metrics (tasks done, rejections, $ per accepted change, failures). Recommends that the Manager **fire and replace** an employee: same role, fresh context, revised prompt or model. |
| **Marketer** | LLM | Monthly | Turns what shipped into a marketing strategy (release notes, announcement copy, growth ideas). |
| **Communicator** | LLM + code | Per user preference (weekly default) | Sends the update (progress, performance reviews, marketing strategy) by the user's preferred channel. Also sends **Manual-mode prompts** whenever user input is needed. |

**Breakdowns:**
- The Purser is split into deterministic **Gatekeeper** code and an LLM **Analyst**.
- The Developer role can scale to multiple instances.
- Code review went to a separate **Tester**, so Developers never approve their own work.

**Fire and replace:** set `employee.status = 'fired'`, create a new `employee` row with the same role, `generation + 1`, a fresh context (no carried memory except a short handoff note), and an optionally different model. Log it in `activity`. The live panel shows "Researcher #2 hired."

---

## 4. Architecture

### 4.1 Repo layout
```
foundation/
├─ CLAUDE.md
├─ .claude/            settings.json, agents/, skills/
├─ apps/
│  ├─ web/             React + Vite + Tailwind + shadcn/ui (5 pages)
│  ├─ worker/          Node/TS agent runtime (employees, provider adapters)
│  └─ module/          SpacetimeDB TypeScript module (tables, reducers, schedules)
├─ legacy-demo/        fake "MediClaim" PHP 5 app with planted bugs
├─ packages/shared/    shared types, cost estimator, agent prompts
└─ docs/               DEVPOST.md, demo-script.md, architecture.md
```

### 4.2 Data flow
```
 [web] ──subscribe──► [SpacetimeDB module on Maincloud] ◄──subscribe── [worker]
   │   ◄─live rows──    tables + reducers + schedules     ──reducers──►   │
   │                    (budget enforced HERE)                            │
   └─ reducer calls: chat, settings, unlock spend         LLM providers ◄─┘
                                                     (1 real + simulated others)
                                                          legacy-demo/ repo ◄─ git branches
```
- **Schedules:** SpacetimeDB scheduled reducers fire `start_run(agent_role)` at each employee's cadence. They create `task` rows, which the worker claims.
- **Worker loop:**
  1. Claim a task.
  2. `reserve_budget(task, est_cost)`. The reducer approves, switches provider, or blocks.
  3. Call the LLM.
  4. `commit_spend(actual)`, then log activity and write the result.
- **Why SpacetimeDB:** live panel, spend meters, and notifications are just table subscriptions, and budget rules live inside the database where no client can get around them.

### 4.3 Tables (draft; finalize in Phase 1) 🛑 approve the schema
| Table | Key fields |
|---|---|
| `user_profile` | identity, display_name, mode (`autonomous`/`manual`), comm_channel, comm_frequency |
| `project` | id, name, repo_path, stack_summary, health_score |
| `employee` | id, role, generation, status (`active`/`on_review`/`fired`), model, provider_id, cadence, last_run_at, prompt_version |
| `provider` | id, name, is_simulated, balance_usd, threshold_usd (default 0), price_in, price_out, status (`healthy`/`low`/`stopped`) |
| `fallback_chain` | task_type, ordered provider_ids |
| `budget` | period (`week`), limit_usd, spent_usd, reserved_usd, **spend_locked** (default true), autonomous_halted |
| `spend_event` | task_id, provider_id, est_usd, actual_usd, at |
| `task` | id, run_id, employee_id, type, status, input, output, branch, cost_usd |
| `run` | id, trigger (`schedule`/`manual`/`chat`), started_at, ended_at, total_cost |
| `activity` | run_id, employee_id, kind, message, at (feeds the live panel) |
| `notification` | kind (`needs_input`/`switch_or_upgrade`/`budget_halt`/`info`), payload, resolved |
| `chat_message` | role (`user`/`translator`), text, directive_json |
| `report` | kind (`weekly_update`/`performance_review`/`marketing_strategy`/`audit`/`research`), author_employee_id, body_md, period |
| `review` | employee_id, period, score, metrics_json, recommendation (`keep`/`coach`/`replace`) |
| `schedule_*` | SpacetimeDB schedule tables, one per cadence job |

### 4.4 Key reducers
- `reserve_budget(task_id, est_usd, task_type)`: the core rule (§5.1).
- `commit_spend(task_id, actual_usd)`
- `resolve_switch_or_upgrade(notification_id, choice)`: `switch` or `upgrade`. Upgrade is a mock that adds balance.
- `unlock_spending(confirm_phrase)` / `lock_spending()`
- `set_mode`, `set_threshold`, `set_cadence`, `set_weekly_budget`, `set_fallback_chain`
- `send_chat(text)` creates a task for the Translator.
- `fire_and_replace(employee_id, reason)`
- `start_run(trigger)`, `claim_task`, `log_activity`, `complete_task`, `write_report`
- `seed_demo()`: fills a convincing past run, reports, reviews, and provider balances.

---

## 5. Finance logic (the Purser)

### 5.1 Budget rule (enforced in `reserve_budget`)
```
For provider k picked for this task type:
  allowed if  balance_k − est_cost ≥ threshold_k   (threshold default $0)
          and weekly.spent + weekly.reserved + est_cost ≤ weekly.limit   (unless spend unlocked)
If provider fails:
  AUTONOMOUS → switch to next provider in fallback_chain; log "switched"
  MANUAL     → create notification(switch_or_upgrade); task waits
If no provider passes OR weekly limit hit:
  AUTONOMOUS → set autonomous_halted = true for the rest of the week; notify
  MANUAL     → notify; task waits
```

### 5.2 "Switch or upgrade"
- Shown as two buttons side by side wherever a provider is low or stopped: **Switch** (next in chain) and **Upgrade** (mock: "add $20 credit" or "raise plan").
- Autonomous mode always picks **Switch** automatically. Manual mode asks.

### 5.3 Spending lock
- **Locked by default.** Spending beyond the weekly budget is impossible.
- Unlocking needs an "Are you sure?" dialog where the user types `UNLOCK`. It re-locks automatically at the end of the week.

### 5.4 Provider adapters (`apps/worker/providers/`)
- Interface: `estimateCost(prompt, maxOut)`, `complete(...)`, `name`, `isSimulated`.
- **Real:** one provider (Maritime if it serves models, otherwise whatever key the user provides).
- **Simulated:** Gemini, OpenAI, and Nemotron (Brev). Each returns canned but plausible output and drains its fake balance.

### 5.5 Budget calculator (on My Finances and in Settings)
- Weekly cost = Σ over employees of (runs per week × average cost per run).
- Compare against the weekly budget. If it's over, warn: *"At this schedule your crew will spend $X/week. Autonomous runs will stop for the week once your $Y budget is used."*
- Includes sliders for each employee's cadence and suggests a cadence that fits.

---

## 6. The five pages (UI spec)

Global UI:
- Left sidebar: **Home, My Finances, My Developers, My Communications**, and a **settings gear** at the bottom for page 5.
- A notification bell (Manual-mode prompts, switch-or-upgrade, budget halts).
- Visual style: clean, light, friendly (Base44-like). Navy with an amber accent. Red appears only for "stopped."

### Page 1: Home
- Greeting plus a one-line status ("All spending within limits. Your crew runs Wednesday at 12 PM.").
- **At-a-glance cards**, each linking to its page:
  - Finances: spent vs. budget, runway, lock state
  - Developers: next run, Autonomous/Manual, anyone on review
  - Communications: the latest update preview
- **Chat with the Translator** directly under the greeting, styled like the ChatGPT or Base44 opening screen (big centered input with suggestion chips: "Is my app safe?", "Why did my bill go up?", "Upgrade my login page").

### Page 2: My Finances
Tabs or sections:
- **Overview:** consumption vs. limits, weekly budget meter, projection, saved-by-switching.
- **API keys and wallets:** a card per provider with a balance gauge, threshold, status, and the **Switch or upgrade** buttons. "Add API key" (mock form).
- **Limits and lock:** editable thresholds (default $0), weekly budget, and the **spending lock** with its "Are you sure?" unlock.
- **Fallback chains:** drag-to-reorder providers for each task type (research, code, review, marketing).
- **Budget calculator:** see §5.5.
- **Insights** (Purser Analyst): unused keys, cheaper model suggestions, "APIs you actually need."

### Page 3: My Developers
- **Autonomous (default) / Manual** toggle at the top.
- **Org chart** of employees: Translator → Manager → everyone else. Each card shows role, generation, model, cadence, status, and last run.
- **Live panel:** streams the current run's `activity` rows, or replays the last run with a "▶ Replay" button.
- **Employee drawer:** recent tasks, cost, review score, and buttons to change cadence, change model, or **fire and replace**.
- **"Run now"** button, needed for the demo.
- Code view: a branch name with "View changes" (shows a simple diff from `task.output`, or links to GitHub).

### Page 4: My Communications
- Three feeds: **Weekly updates**, **Performance reviews**, **Marketing strategies**, plus Audit and Research reports.
- Every item shows its **author employee chip**. Clicking it jumps to that employee on My Developers.
- An "Email preview" view showing exactly what the Communicator sent (a mock inbox).
- Delivery preferences shortcut (channel and frequency).

### Page 5: Settings (gear)
- **Account:** fake username/password login form ("Secured with Supabase Auth," labeled `// MOCK:`).
- **Defaults:** mode, thresholds, weekly budget, spending lock behavior.
- **Cadences:** one row per employee (daily / weekly / monthly / quarterly), with "Let the Manager optimize" on by default.
- **Budget calculator:** the same component as on My Finances.
- **Communications:** channel (email / in-app / SMS mock) and frequency.
- **Integrations** (all mock "Connect" buttons): GitHub, Base44, Claude Code, AWS Budgets, Supabase.

---

## 7. Development plan (time-boxed, real vs. fake)

**Rule:** finish each tier before starting the next. Within a tier, go top to bottom.

### Tier 0: setup (~0:30)
1. Phase 0 ADE setup (§2) 🛑
2. Scaffold with `spacetime dev --template basic-react`, then restructure into the monorepo in §4.1.

### Tier 1: MVP, real (~4–5 h). This is what gets judged.
3. **Module:** tables, reducers, budget rule, and `seed_demo()` 🛑 schema approval, then **freeze the schema and split into parallel sessions**
4. **legacy-demo/ "MediClaim":** PHP 5 + jQuery 1.x + inline SQL, with planted bugs:
   - SQL injection in the claim search
   - a float rounding bug in claim totals
   - an outdated jQuery
   - a hardcoded DB password
   - no tests
5. **Web shell:** sidebar, routing, the 5 pages populated from seed data via subscriptions.
6. **My Finances (real logic):** wallets, thresholds, spending lock, switch or upgrade, fallback chains, calculator.
7. **Worker:** provider adapters (1 real + simulated), the task claim loop, `reserve_budget`/`commit_spend`.
8. **Real run path:** Manager → Developer → Tester on MediClaim, with activity streamed to the live panel. A simulated provider drains mid-run, so the switch shows on screen.
9. **Translator chat (real):** answers from the Manager's state and creates directives.
10. **Reviewer (real):** reviews from metrics, plus fire and replace.
11. **Communicator:** writes the weekly update to `report`, with a mock email preview.
12. **Deploy:** module to Maincloud, web to Vercel or Netlify. Record a backup demo video.

### Tier 2: prototypes with a polished UI (~1–2 h)
13. Fake auth screen and Settings polish
14. Marketer strategy card (seeded)
15. Purser Insights (seeded)
16. Auditor "How your app works" report (seeded, or real if time allows)
17. Researcher → Updater flow (seeded reports)
18. Integration "Connect" buttons

### Tier 3: make real, first to last, as time allows
19. Real email via Resend
20. Real GitHub branches and PRs on a public MediClaim repo
21. Real scheduled cadences (rather than only "Run now")
22. Manager auto-tuning cadences against the calculator
23. Real Researcher (web search) → Updater → Developer chain
24. Real Marketer and Auditor
25. Worker hosted on Maritime
26. Real Supabase auth
27. Brev/Nemotron as a real cheap provider

### Final hour (by 10:30 AM)
- Run `demo-reviewer` through §8. Fix whatever breaks.
- Update `DEVPOST.md` per §9.
- Make the repo public. Submit.

---

## 8. Demo script (2 minutes, build toward this)
1. **Home:** greeting, at-a-glance cards. Type "Is my app safe?" to the Translator.
2. **My Developers:** the Auditor's findings on MediClaim (SQL injection, rounding bug). Click **Run now**. The live panel streams the Manager planning, the Developer patching, and the Tester approving.
3. Mid-run, **Gemini hits its $0 threshold**. The Purser auto-switches to Claude (Autonomous). The banner shows *Switch or upgrade*.
4. **My Finances:** the meters moved live. Show the spending lock and the "Are you sure?" dialog, then the calculator warning about an over-budget cadence.
5. **My Communications:** the weekly update, and a Reviewer card: *"Researcher placed on review. Recommend replacing."* Click through to see "Researcher #2 hired."
6. Close: "Legacy code, modernized. APIs, managed. Budget, protected."

---

## 9. Devpost updates to make at the end
- Rename to **Foundation** and use the two-sentence summary from §0.
- Update the employee list to match §3, add the Purser's switch-or-upgrade logic and the LaTeX budget rule (already drafted in `DEVPOST.md` v2), and describe the 5 pages.
- Remove anything in "Built with" that wasn't actually used. Say which parts are prototypes.

---

## Appendix A: `CLAUDE.md` template
```markdown
# Foundation
AI dev team that maintains legacy/vibe-coded software, plus an API credit manager
with thresholds ($0 default), switch-or-upgrade, and a weekly spending lock.
HackUTD 2026 — 8090 + SpacetimeDB tracks. Deadline: submit 10:30 AM 2026-11-08.

## Layout
apps/module (SpacetimeDB TS module) · apps/web (React/Vite/shadcn) · apps/worker (Node agents)
legacy-demo/ (fake PHP app, planted bugs — do NOT fix outside agent runs) · packages/shared

## Rules
- Budget/threshold/lock rules live ONLY in module reducers. Never trust the worker or web for them.
- Reducers: deterministic, no network, no Date.now()/Math.random() — use reducer context.
- LLM calls happen only in apps/worker via provider adapters. Simulated providers are fine.
- Every fake is marked `// MOCK:` with a one-line note on how to make it real.
- UI copy: "employees", "My Finances", "My Developers", "My Communications", "Switch or upgrade".
  Sentence case, no exclamation marks.
- After changing module tables/reducers: regenerate bindings (`spacetime generate ...`) and typecheck web.
- Never read or print .env files. Never commit secrets.
- The demo must work with all LLM calls failing (seed data via seed_demo()).

## Commands
pnpm dev · pnpm typecheck · spacetime publish · spacetime generate · spacetime logs
(verify exact flags against the official SpacetimeDB skills/docs)
```

## Appendix B: opening message to paste into the new chat
> Read `FOUNDATION_KICKOFF.md` fully. Ask me the current time and the open questions in §2.3. Then start Phase 0 (ADE setup) and stop for my approval at each 🛑 checkpoint. Don't build anything outside the current phase without asking.
