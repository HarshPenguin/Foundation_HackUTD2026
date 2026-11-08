# Devpost Draft — HackUTD 2026 (v2)

> Working name: **Skeleton Crew** (alternatives: *Upkeep*, *Night Shift*, *Legacy Crew*)
> Tracks: **8090 Solutions — Legacy System Modernization** · **SpacetimeDB**
> `[EDIT LATER]` = confirm or trim before the final 10:30 AM submission.

---

## Project name
Skeleton Crew

## Elevator pitch / tagline (≤ 200 chars)
A full-time AI dev team for people who can't afford one. It maintains your legacy and vibe-coded apps every week, reports back in plain English, and never spends a dollar you didn't approve.

---

## About the project
*(Paste everything between the two lines below into Devpost's "About the project" field. It uses Markdown with LaTeX.)*

---

## Inspiration

The world runs on old software that nobody fully understands. Medicare alone made **\$28.8 billion in improper payments** last year, through claims systems built on decades-old code. Large organizations pay consultants to keep those systems alive. Small businesses, clinics, nonprofits, and solo founders can't.

There's a newer version of the same problem. Vibe-coding tools like Base44 and Lovable let anyone ship an app in an afternoon. Then the dependencies age, security holes open up, and the person who "built" it can't read the code. **Every vibe-coded app becomes a legacy app the day it ships.**

While talking with the 8090 team, two more problems came up:

1. **"Couldn't I just do this with one prompt in Claude Code?"** You can fix a bug with one prompt. You can't get *ongoing ownership* from one prompt: a team that remembers last week, runs on a schedule, reviews its own work, and answers to you.
2. **AI and cloud bills are a minefield.** Non-technical builders juggle API keys for Claude, Gemini, OpenAI, and AWS, each with its own limits and dashboards. They usually find out a key ran dry, or a bill exploded, *after* it happened.

So I built a tool that handles both: a persistent AI dev team for **post-production**, with a finance department that won't let it overspend.

## What it does

Skeleton Crew gives a non-technical owner a **virtual dev team** for an existing or legacy app. Each AI agent is presented as an **employee**:

| Employee | Role |
|---|---|
| **Translator** | The only employee you talk to. Turns plain English into instructions for the Manager and turns technical answers back into plain English. Can't be fired. |
| **Manager** | Plans each work cycle, assigns tasks, and runs **performance reviews**. Can push back on or **replace** underperforming employees. |
| **Researcher** | Pulls current best practices, deprecations, and security advisories for your stack. |
| **Developer** | Patches bugs, upgrades dependencies, and refactors legacy code, always on a separate branch. |
| **Editor** | Reviews and tests the Developer's work and rejects anything that isn't good enough. |
| **Accountant** | Tracks every API key, credit balance, and cloud budget. Enforces spending limits and switches to backup models. |
| **Marketer** | Turns what changed this week into a marketing strategy: release notes, announcement copy, and growth ideas. |
| **Updater** | Sends your **weekly update** and each employee's **performance review**. |

### 1. Weekly upkeep, on your schedule
Pick when your crew works (e.g. **every Wednesday at 12 PM**), or let the Manager decide based on your budget. Choose **Autonomous mode** (the crew acts on its own; changes land on a branch, need Editor approval, and are fully logged) or **Manual mode** (the crew proposes and you approve).

### 2. Always visible
- Ask the **Translator** "how's it going?" at any time.
- Watch the **Live Panel**, which replays the crew's last run step by step, or streams it live while they work.
- Open the **code changes** directly, if you have developer knowledge.

### 3. Weekly update, performance reviews, and marketing strategy
Every cycle ends with a plain-English report, a review card for each employee (what they did, what it cost, and whether the Manager is keeping them), and a short marketing plan based on what shipped.

### 4. The Accountant: a one-stop API and spend manager
- **One wallet for every key.** Claude, Gemini, OpenAI, NVIDIA, AWS, and more, each with remaining credits and uses left.
- **Per-task model choices.** E.g. "use Gemini for research, Claude for code."
- **Hard stop at \$0, on by default.** No task starts if it would push any provider below its limit. You can raise the threshold, or turn the stop off on purpose.
- **Fallback chains.** When a provider hits its threshold, the Accountant either switches to the next model in your chosen order (Autonomous) or asks you to switch, pick a different tool, or upgrade (Manual).
- **API needs analysis.** Recommends which APIs and plans you actually need based on how your crew really works, and flags keys you're paying for but not using.

Before each task the Accountant estimates its cost:

$$\hat{C}_{\text{task}} = \sum_{s \in \text{steps}} \left( t^{\text{in}}_s \, p^{\text{in}}_m + t^{\text{out}}_s \, p^{\text{out}}_m \right)$$

where $t$ are estimated tokens and $p_m$ are model $m$'s prices. A task runs on provider $k$ only if

$$B_k - \hat{C}_{\text{task}} \ge \tau_k$$

where $B_k$ is the remaining balance and $\tau_k$ is your threshold (default $\tau_k = 0$). Otherwise it moves to the next provider in your fallback order $k_1 \rightarrow k_2 \rightarrow \dots$, or stops and asks you.

### Demo
I built a deliberately legacy **Medicare-style claims-intake app** (PHP 5, jQuery 1.x, SQL embedded in page code). It has an SQL injection hole, a claim-amount **rounding bug** (the small kind of error that adds up to improper payments), outdated dependencies, and no tests. Then I let the crew work on it, and drained one API key mid-run to show the Accountant switching to a backup model.

The platform also shows the full journey from **build → ship → maintain**: a Base44-style vibe-coding chat, an agent-optimization workflow, and planned **Base44 and Claude Code integrations**. Those parts already exist in other products and appear here as prototypes. The new part is the post-production crew and its Accountant. `[EDIT LATER: list exactly what is real vs. prototype]`

## How I built it

- **SpacetimeDB is the crew's office.** Employees, tasks, activity logs, reports, reviews, API wallets, budgets, and fallback chains are all SpacetimeDB tables. The React dashboard subscribes to them, so the **Live Panel and spend meters update in real time** with no polling or extra websocket server. Spending limits are enforced **inside reducers**, so no client or agent can get around the hard stop. SpacetimeDB's built-in timed jobs run the weekly schedule.
- **An agent worker** (Node/TypeScript) connects to SpacetimeDB as a client. It claims tasks, runs each employee as an LLM agent with role-specific instructions, and reports every step and every token back through reducers.
- **Maritime** hosts the worker on a persistent machine, so the crew keeps working while your laptop is closed. `[EDIT LATER: confirm]`
- **Frontend:** React, Vite, Tailwind, shadcn/ui. Lovable for early UI prototypes.
- **Developed with Claude Code** using parallel agent sessions. I'm a solo first-year CS student, so I ran my own small crew to build this one.

## Challenges I faced

- **Autonomy without chaos.** Letting agents act on their own means guardrails have to be part of the design: branches only, mandatory review, a full activity log, and a spending limit no agent can override.
- **Thinking in SpacetimeDB.** Logic runs inside the database as reducers instead of behind a REST API. Once that clicked, it was the perfect place to enforce budgets.
- **Estimating cost before spending it.** Token estimates are fuzzy, so the hard stop leaves a safety margin and the Accountant updates its estimates as real usage comes in.
- **Making AI management mean something.** A performance review only matters if it's based on real signals: rejected patches, failed checks, and dollars spent per useful change.
- `[EDIT LATER: add real challenges from the night]`

## What I learned

- The hard part of agentic maintenance is **trust**, not code generation: visibility, review, a clear chain of responsibility, and cost control.
- Real-time databases are a natural fit for showing what multi-agent systems are doing.
- How fast "small" API costs add up across providers, and why non-technical builders need a hard stop.
- `[EDIT LATER]`

## What's next

- Real Base44 and Claude Code integrations (connect an app in one click)
- Real GitHub pull requests with one-click rollback
- Direct billing integrations (AWS Budgets, provider usage APIs) instead of tracked estimates
- Real authentication (Supabase) and encrypted key storage
- Support for mainframe-era code (COBOL) alongside legacy web stacks

---

## Built with
`spacetimedb` · `typescript` · `react` · `vite` · `tailwindcss` · `shadcn-ui` · `node.js` · `claude` · `claude-code` · `maritime` · `github` · `lovable` · `nvidia-brev` · `supabase` `[EDIT LATER: remove anything not actually used]`

## Links
- GitHub repo: `[EDIT LATER]`
- Live demo: `[EDIT LATER]`
- Demo video: `[EDIT LATER]`
