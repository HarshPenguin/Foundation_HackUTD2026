# Foundation

**An AI maintenance team for legacy and vibe-coded software.** It understands, repairs and modernizes outdated code on a schedule you set. It also manages every AI key, limit and bill in one place, with a $0 hard stop and automatic backup models, so the work never costs more than you approved.

HackUTD 2026: 8090 Solutions (legacy modernization) and SpacetimeDB tracks.

- **Live app:** https://foundation-hackutd.vercel.app
- **Write-up:** [docs/DEVPOST.md](docs/DEVPOST.md) · **Demo script:** [docs/demo-script.md](docs/demo-script.md)

## How it fits together

```
 Browser (React, Vercel) ──subscribe/reducers──►  SpacetimeDB module (Maincloud)  ◄──subscribe/reducers── Crew worker (Maritime)
                                                   27 tables · every money rule in reducers               employees as LLM agents
 Claude Code ──hooks + MCP (HTTP)──────────────►   scheduled reducers (cadences, weekly reset)            real git + PHP checks
                                                   scheduled procedure ──HTTP wake──► Maritime webhook    OpenAI-compatible + Claude adapters
```

- **SpacetimeDB is the source of truth.**
  - The UI and the worker only subscribe to tables and call reducers.
  - `reserveBudget` enforces `balance − reserved − worstCase ≥ threshold` and the weekly limit, then switches models or asks you (Switch or upgrade).
  - Keys sit in a private table; only the registered worker can read them, through the `worker_secret` view.
  - When work is queued and the crew is asleep, the `wakeCrew` procedure calls Maritime's webhook.
- **The worker** (`apps/worker`) runs the employees: Chatbot, Manager, Auditor, Researcher, Updater, Developers, Tester, Purser, Reviewer, Marketer and Communicator. It patches `legacy-demo/` (MediClaim) on git branches and tests each change with `php -l` and behavioral checks.
- **Claude Code integration** (`integrations/claude-code`): spend tracking, the same $0 hard stop before each prompt, and an MCP server for the crew.

## Repo layout

| Path | What |
|---|---|
| `apps/module` | SpacetimeDB TypeScript module: tables, reducers, schedules, views, procedures, seed data |
| `apps/web` | React + Vite + Tailwind: Home, My Finances, My Developers, My Communications, Settings, Onboarding |
| `apps/worker` | Node/TS crew runtime and provider adapters; Dockerfile for Maritime |
| `packages/shared` | Prompts, token estimates, canned offline playbooks |
| `integrations/claude-code` | Claude Code hooks and MCP server (standalone npm package) |
| `legacy-demo` | MediClaim: a deliberately legacy PHP 5 claims app with planted bugs |
| `docs` | Devpost write-up, demo script, architecture, original brief |

## Run it locally

Install the dependencies:

```bash
pnpm install
```

Publish the module to a local SpacetimeDB:

```bash
spacetime start
```

```bash
spacetime publish -s local -p apps/module foundation
```

Run the web app:

```bash
pnpm --filter @foundation/web dev
```

Run the worker:

```bash
cd apps/worker && cp .env.example .env && pnpm start
```

The worker needs `WORKER_PAIRING_CODE` to match the code the admin set with `spacetime call set_worker_pairing_code`. The demo works even with every model call failing: seed data drives every screen, and each employee has an offline playbook.

## Deploy

- **Module:** `spacetime publish -s maincloud -p apps/module <db-name>`
- **Web:** `pnpm --filter @foundation/web build`, then deploy `apps/web/dist` (Vercel, with SPA rewrites in `apps/web/vercel.json`)
- **Worker:** Maritime custom agent built from `apps/worker/Dockerfile` (with the build context at the repo root), with "Use Maritime LLM" on and `STDB_URI`, `STDB_DB` and `WORKER_PAIRING_CODE` set

## Honest notes

Anything simulated is marked `// MOCK:` in the code with a note on how to make it real. Examples: simulated wallets for providers without a key, the mock email inbox, the shared owner passcode, and the non-Claude-Code integration buttons. See the table at the end of [docs/DEVPOST.md](docs/DEVPOST.md).
