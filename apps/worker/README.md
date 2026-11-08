# Foundation worker

The Node runtime for Foundation's AI crew. It connects to the SpacetimeDB module as the registered
worker, watches the `task` table, and runs each employee: Manager, Developers, Tester, Reviewer,
Communicator, Translator, plus the scheduled single-employee runs (Researcher, Marketer, Auditor,
Updater, Purser). The worker never decides money: every task goes through `reserveBudget` and the
worker obeys the status the module sets.

## Run locally

```bash
cd apps/worker
cp .env.example .env      # fill in STDB_URI, STDB_DB, WORKER_PAIRING_CODE, MARITIME_LLM_KEY
pnpm install
pnpm start                # tsx src/main.ts
```

The admin must set the same pairing code once: `spacetime call <db> set_worker_pairing_code '"<code>"'`.
The worker calls `registerWorker` on every connect and saves its identity token in
`$WORKSPACE_DIR/worker-token`, so it keeps the same identity across restarts. Run one worker at a time.

Other scripts:

| Command | What it does |
|---|---|
| `pnpm reset` | Calls `resetDemo` as the worker (wipe + reseed) and deletes the agent's MediClaim copy. Use this instead of the CLI when the CLI identity is not the admin. `--keep-workspace` keeps the copy. |
| `pnpm selftest` | Runs the Tester's PHP checks on `legacy-demo` (should fail) and on the playbook fixes (should pass), then tries one Maritime call. No database needed. |
| `pnpm typecheck` | `tsc --noEmit` |

Trigger work from the CLI (or the web app):

```bash
spacetime call -s local --anonymous foundation start_run '"manual"'
spacetime call -s local --anonymous foundation send_chat '"Is my app safe?"'
```

## How a run flows

1. `startRun` creates a Manager task. The Manager plans from the latest audit (LLM, JSON) and falls back to the
   standard plan: Dev-Security fixes SQL injection in `public/search.php`, Dev-Upgrades fixes claim total rounding in `lib/totals.php`.
2. Each Developer task: reserve, claim, ask the model for the full corrected file, commit it on
   `foundation/<slug>` in `$WORKSPACE_DIR/mediclaim` (a git copy of `legacy-demo/`, never the original), and store the diff.
3. A Tester task per change: checks out the branch, runs `php -l` and a PHP check (cent-exact totals, no SQL
   built from request data, ...), plus a model review. Approve, or reject and the Developer gets one more try.
4. When all changes are reviewed: the Reviewer writes `review` rows and a performance report, the Communicator
   writes the update email report, then the run is finished.
5. Translator chat tasks answer from a database snapshot and attach a directive JSON. "Fix/upgrade ..." starts a run.
   A `blocked` chat task (no budget) is answered from the database with no model call.

All state is read from subscribed tables, so a restarted worker resumes: tasks it was running are failed (which
releases their reservations) and redone once.

## Providers

- **Maritime** (real): OpenAI-compatible, `MARITIME_LLM_KEY` / `MARITIME_BASE_URL`, falling back to the
  `OPENAI_API_KEY` / `OPENAI_BASE_URL` Maritime injects. Real token usage is committed. `402` marks the provider stopped.
  Any other failure logs "Maritime was unreachable, so X used its offline playbook", commits 0 tokens, and the step
  continues with the canned output.
- **Gemini, OpenAI, NVIDIA Nemotron** (simulated, `// MOCK:`): canned output after 1.5-3 s with plausible token
  counts, so balances drain. Gemini's seeded 7,000 micros covers one code task, so the next one switches to Maritime.

## Deploy on Maritime

The image builds with the repo root as context:

```bash
docker build -f apps/worker/Dockerfile -t foundation-worker .
```

Maritime builds `Dockerfile` at the repo root. Either copy `apps/worker/Dockerfile` to `/Dockerfile` (and
`apps/worker/Dockerfile.dockerignore` to `/.dockerignore`), then `maritime create foundation-worker --repo <github url>`,
or push the image to a public registry and create the agent with `"framework": "custom", "imageName": "..."`.

Then on the agent:

- Press **Use Maritime LLM** on the Env tab (injects `OPENAI_API_KEY` and `OPENAI_BASE_URL`), and restart.
- Set env vars: `STDB_URI=wss://maincloud.spacetimedb.com`, `STDB_DB=<database name>`, `WORKER_PAIRING_CODE` (secret).
  `WORKSPACE_DIR` defaults to `/data/workspace` in the image, which survives restarts.
- Do not set `PORT`. The worker serves `GET /health` (status JSON) and `POST /chat` (`{"message": "..."}` is sent to
  the Translator and its reply returned within 25 s) on Maritime's `$PORT`.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `STDB_URI` | `ws://127.0.0.1:3000` | |
| `STDB_DB` | `foundation` | |
| `WORKER_PAIRING_CODE` | | required, 16+ chars, must match `set_worker_pairing_code` |
| `MARITIME_LLM_KEY` / `MARITIME_BASE_URL` | `OPENAI_API_KEY` / `OPENAI_BASE_URL` | never logged |
| `WORKSPACE_DIR` | `./.workspace` | MediClaim copy, worktrees, token |
| `PORT` | `8788` | health + chat endpoint |
| `PACE` | `1.6` | multiplier for pauses between visible steps (`0` for fast tests) |
| `WORKER_CONCURRENCY` | `2` | parallel non-chat tasks; chat always runs right away |
| `LLM_TIMEOUT_MS` | `45000` | |
