# Foundation: project handoff

Written 2026-11-10, after HackUTD 2026. Read this first if you are picking the project up (person or AI agent).

---

## 1. What Foundation is

An **AI maintenance team for legacy and vibe-coded software**. The owner connects their app's code. An AI crew explains how the code works, finds risks, and repairs them on a schedule. It also manages every AI key and bill in one place, with a hard spending limit ($0 threshold by default) and automatic backup models, so the work never costs more than the owner approved.

The pitch in four words, from the slides:
- **AGE:** keeps old systems maintained.
- **BREAK:** keeps vibe-coded apps working after launch.
- **LOSE:** never overspends.
- **SLOP:** every change is tested, and underperforming AI employees are replaced.

The crew are "employees". Internal role ids are in brackets.

| Employee | Job |
|---|---|
| Chatbot (`translator`) | The only one the owner talks to. Plain English in and out. |
| Manager | Plans each run from the audit and findings, and assigns work. |
| Auditor | Clones the owner's repo, scans every file, writes "How <app> works". |
| Researcher → Updater | Stack research, then update plans. Mostly seeded or canned today. |
| Developers (Dev-Security, Dev-Upgrades) | Patch on git branches, or write fix plans when no AI key works. |
| Tester | Lints and re-scans each change, then approves or rejects. |
| Purser | Finance. The rules live in the database; insights are written by the LLM. |
| Reviewer | Weekly performance reviews; recommends "fire and replace". |
| Marketer, Communicator | Marketing plan; weekly update by email preview and text. |

---

## 2. Where everything runs (production)

| Part | Where | Identifier |
|---|---|---|
| Website | Vercel (Hobby), project `foundation-hackutd` | https://foundation-hackutd.vercel.app |
| Database + all rules | SpacetimeDB Maincloud | database `foundation-hackutd` (plus a scratch copy, `foundation-hackutd-staging`) |
| AI crew (worker) | Maritime agent box | agent **`foundation-crew-v2`**. The older agent `foundation-crew` is dead and can be deleted from the Maritime dashboard. |
| Code | GitHub | `HarshPenguin/Foundation_HackUTD2026` |

**Accounts and credentials. No secrets are in the repo. Know where each one lives:**
- **SpacetimeDB admin:** whoever published the database. It was published from the hackathon cloud session logged in to *your* spacetimedb.com account. Run `spacetime login` on your machine with the same account to get the same admin identity, which you need for `set_worker_pairing_code`, `set_owner_passcode`, `set_wake_hook` and admin SQL.
- **Worker pairing code:** set on the database with `set_worker_pairing_code`, and given to the Maritime agent as the secret env var `WORKER_PAIRING_CODE`. If you lose it, set a new code (admin) and update the Maritime env var to match.
- **Owner passcode:** `test` (set with `set_owner_passcode`). **Change it** before sharing the app.
- **Maritime account API key (`mk_…`):** the key used in the hackathon lacks the `secrets` scope, so it can't edit agent env vars. Create a key with that scope for automation.
- **Vercel:** deploys were done with a personal token from the CLI. Vercel is *not* connected to GitHub, so pushing doesn't deploy.
- **AI provider keys** (Gemini and so on) are entered by the owner in onboarding and stored in the private `provider_secret` table.
- **Photon:** not configured in production yet (see §5).

---

## 3. Architecture

```
Browser (React on Vercel) ──subscribe + reducers──► SpacetimeDB (Maincloud) ◄──subscribe + reducers── Crew worker (Node on Maritime)
Claude Code ──hooks + MCP over HTTP──────────────►  tables · reducers · schedules ─HTTP wake─► Maritime webhook
Photon Spectrum ──webhook POST /route/photon──────►  views · procedures · HTTP routes          ──► AI models, git, PHP
```

- **SpacetimeDB is the brain and the rulebook.** The UI and the worker only subscribe to tables and call reducers. Every money rule is enforced in reducers:
  - `reserveBudget` reserves the worst case. A task runs only if `balance − reserved − worstCase ≥ threshold`, plus the weekly limit while spending is locked.
  - `commitSpend` charges the actual cost.
  - A reservation that's stuck for 10 minutes is released.
  - Autonomous mode switches models; Manual mode asks the owner. **Chat tasks always switch.**
- **Scheduled reducers:** employee cadences, the weekly budget reset, reservation timeouts.
- **Scheduled procedure `wakeCrew`:** Maritime machines always sleep when idle. When work is queued and the worker has been silent for 70 s or more, the database POSTs to the Maritime webhook. It retries on 503, up to 4 tries 30 s apart.
- **Views:**
  - `worker_secret` and `worker_messaging`: API keys, the Photon secret and the phone number, visible only to the registered worker.
  - `owner_webhook`: the Photon webhook secret, visible only to the owner or admin.
- **HTTP routes:** `GET /route/health`, and `POST /route/photon?secret=…`, where texts come in. The full URL is `https://maincloud.spacetimedb.com/v1/database/foundation-hackutd/route/photon?secret=…`.
- **Worker** (`apps/worker`): one process, registered with the pairing code. It claims reserved tasks and runs each employee's role, with model adapters:
  - `openaiCompat`: Maritime LLM, Hugging Face, Gemini, OpenAI, custom.
  - `anthropic`: Claude via the official SDK, with refusal fallbacks.
  - simulated providers.

  It also clones repos (`git`), runs PHP lint and checks, sends texts (`texter.ts`, Spectrum), and reconnects after Maritime sleep and wake. **When every model fails, roles fall back to canned "offline playbook" text.** That's why answers can look instant (see §5).

### Repo layout

| Path | What |
|---|---|
| `apps/module/src` | `schema.ts` (31 tables), `index.ts` (reducers, views, procedures, routes), `seed.ts` (demo data), `config.ts` (re-applies owner setup after a reset) |
| `apps/web/src` | Pages: `Home`, `Finances`, `Developers`, `Communications`, `Settings`, `Onboarding`. Data: `lib/stdb.tsx` (`useDb`). Calls: `lib/actions.tsx` (`useCall`) |
| `apps/worker/src` | `main.ts` (connect, heartbeat, wake/reconnect, HTTP `/health` and `/chat`), `pipeline.ts` (task loop and run coordination), `roles/*`, `providers/*`, `scanner.ts` (deterministic code scanner), `repoWork.ts`, `texter.ts`, `proxy.ts` (sandbox-only proxy shim) |
| `packages/shared` | Prompts, token estimates, canned outputs, MediClaim known issues |
| `integrations/claude-code` | Standalone npm package: `connect`, `install`, hooks (`preflight`, `stop`), MCP server |
| `legacy-demo` | MediClaim, the deliberately broken PHP 5 demo app |
| `docs` | `DEVPOST.md`, `demo-script.md`, `architecture.md`, `FOUNDATION_KICKOFF.md` (original brief), this file |

---

## 4. Status: what works

**Verified on the live system:**
- The live dashboard; Chatbot; Run now; live panel; reviews and the weekly update; reset demo data; owner passcode.
- **Budget rules:** the $0 threshold, the mid-run switch, the weekly halt, the spending lock, reservation release.
- **Real stops:** Maritime "out of credits" (402), a Gemini 402 (prepaid project at $0), and rejected keys (401/400). Each stops the provider and switches.
- **Sleep and wake:** a chat to a sleeping crew is answered in about 20 s.
- **Connect a repo:** DVWA cloned and scanned on Maritime in 10 s (242 files, 30 findings, health 19/100). The Manager plans from the findings, and Developers write fix plans.
- **Chatbot in Manual mode** answers by auto-switching (fixed after the demo).

**Verified only on staging, or with fakes:**
- Onboarding end to end.
- Claude, Gemini and Hugging Face adapters: each reached the real API and was correctly refused a fake key.
- Claude Code hooks and MCP, with a synthetic transcript.
- Photon webhook commands (`1`, `2`, `UNLOCK`, `FIX`, free text to the Chatbot) with simulated Spectrum payloads.

**Built but never run end to end:**
- Developers patching a connected repo with a **working** AI key, followed by the Tester re-scan.
- A real text sent or received through Photon.

**Mocks (search the code for `// MOCK:`):**
- Wallet balances are allowances, not real billing.
- Providers without a key are simulated.
- The "Upgrade" button adds $20 of pretend credit.
- The email inbox is a preview.
- Login is a shared passcode.
- The GitHub, Base44, AWS Budgets and Supabase "Connect" buttons do nothing.

---

## 5. Backlog: what to fix next

### A. Make the AI real (highest impact)
1. **No working model key in production.** The Gemini key entered after the hackathon belongs to a Google project on prepaid billing with $0 credit (Google returns HTTP 402 "prepayment credits are depleted"). Create a key in a **free-tier** AI Studio project, or use a funded key, and enter it in onboarding → AI keys. Until then every answer is canned, and fast enough that judges noticed.
2. **Maritime LLM** needs prepaid AI credits (separate from the plan; from $5). Without them, the Maritime provider always reports "out of credits". Note: an agent created with "Use Maritime LLM" **refuses to wake at all** at $0 AI credits. That's why the crew runs on `foundation-crew-v2`, created without it.
3. **Make canned answers visible as such.** Label "offline answer" in the UI, so the product never looks like it's pretending.

### B. Items you raised
4. **Email delivery.** The weekly update is stored as a `report`, and shown in a mock inbox (Communications → Email preview). To make it real:
   - Add a `messaging`-style email config (provider, from-address, owner email) in a private table.
   - Queue emails like `text_message` (an `email_message` table).
   - Send from the worker with Resend, Postmark or SES (key via the worker-only view).
   - Wire it to the Communicator's `writeReport('weekly_update')`, mirroring `queueText`.
5. **Owner control over each employee (My Developers).**
   - **Exists:** the employee drawer has cadence editing and **Fire and replace** (`fireAndReplace`: same role, generation + 1, handoff note). The Reviewer's "replace" recommendation shows as a notification and review card.
   - **Missing:**
     - **remove** an employee entirely (`removeEmployee`, keeping history; the Chatbot can't be removed)
     - **re-add or hire** a role, including extra Developers (`hireEmployee(role, displayName)`)
     - **pause and resume** an employee
     - a one-click **"Act on Manager's/Reviewer's flag"** that does fire-and-replace or remove
   - The pipeline already finds developers by name (`developerNamed`) and by role (`byRole`); check that paused or removed employees are skipped there and in `onCadence`.
6. **Chatbot locked to "on demand" in the budget calculator.** The Chatbot (`translator`) has cadence `on_demand`, and the calculator counts `on_demand` as **0 runs a week**, so chat cost is invisible. Fix:
   - Add an "expected chats per week" input (or use the last 7 days of chat tasks).
   - Estimate cost per chat from `spend_event` rows for chat tasks.
   - Show it as its own calculator line. Optionally add `settings.chatBudgetMicros`.

### C. Texting (Photon)
7. **Not configured in production.** `messaging` is empty and no text has ever been sent. To go live:
   - Enter the Spectrum **project ID**, **project secret** and phone number in Communications → Texts.
   - Click "Send me a test text".
   - Register the shown webhook URL in app.photon.codes.

   Expect a first-run fix or two. Look for the `[texts]` lines and the red "Last send failed" message.
8. **Webhook signature.** Inbound texts are authenticated with a secret in the URL, and only the owner's number is accepted. Spectrum also signs webhooks with `X-Spectrum-Signature` (HMAC-SHA256 of `v0:<timestamp>:<rawBody>`). Verify it in the `/photon` route. That needs SHA-256 inside the module, because the module runtime has no Web Crypto by default, so bundle a small implementation.
9. The worker still depends on `@photon-ai/advanced-imessage` (unused since the switch to Spectrum). Remove it.

### D. Product and UX (why it didn't place)
10. **Home screen is too complex for beginners.** Lead with one sentence, one big "Connect your code" button, and the Chatbot. Move finances and the crew into later steps. Make onboarding the first-run experience. Today the seeded demo data shows before any setup.
11. **Separate demo data from real users.** Production still runs `seed_demo()` content (MediClaim, fake history). Add a real empty state, and keep demo mode behind a toggle.

### E. Becoming a real product
12. **Auth and multi-tenancy.** It's one database for one owner today. Add real login (SpacetimeAuth or Supabase), then scope every table by an `ownerId`, or use one database per customer. Replace the shared passcode.
13. **Key storage.** Provider keys, the Photon secret and the phone number sit in private tables in plain text. Encrypt them, or use a secrets vault, and add rotation.
14. **Repos.** Private repos and real pull requests (GitHub App); one-click rollback; more scanner rules and languages (it's tuned for PHP and JS today).
15. **Real billing.** Read provider usage and balances (Anthropic Admin API cost report, OpenAI usage, AWS Budgets) instead of allowances. Make "Upgrade" a real checkout link.
16. **Worker scale.** There's a single registered worker, and a second one steals the slot (the last to register wins). Add worker leases per task, and multiple workers.
17. **Tests.** No automated suite beyond `pnpm selftest` in the worker. Add reducer tests (budget rules first) and an end-to-end Playwright run of the demo.

### F. Housekeeping
- Delete the dead Maritime agent `foundation-crew` and, if unused, the staging database `foundation-hackutd-staging`.
- GitHub may be behind this handoff's commit. Push the latest bundle.
- Commits from the hackathon are authored "Foundation <your Claude account email>" with Claude co-author lines. Rewrite them if you want single-author history.
- `docs/DEVPOST.md` and `README.md` still say "every vibe-coded app becomes a legacy app the day it ships". Remove that line if you no longer want it.

---

## 6. Runbook

```bash
pnpm install
pnpm typecheck
```

Module (publish, then regenerate bindings):

```bash
spacetime publish -s maincloud -p apps/module foundation-hackutd
```

```bash
spacetime generate --lang typescript --out-dir apps/web/src/module_bindings -p apps/module
```

```bash
spacetime generate --lang typescript --out-dir apps/worker/src/module_bindings -p apps/module
```

Web:

```bash
pnpm --filter @foundation/web build
```

Then deploy `apps/web/dist` with `vercel.json` copied in, e.g. `vercel deploy --prod` from `apps/web/dist`.

Worker on Maritime: zip the repo with `apps/worker/Dockerfile` copied to the root (plus `Dockerfile.dockerignore` as `.dockerignore`). Upload it (`POST /api/upload/zip`), then `POST /api/deploy {agentId, source:"zip", uploadS3Key}`. The agent needs `STDB_URI`, `STDB_DB` and `WORKER_PAIRING_CODE`.

Worker locally:

```bash
cd apps/worker && pnpm start
```

It needs the `.env` values from `.env.example`. **A local worker takes the production worker slot if pointed at production.**

Day-to-day operations:
- **Reset the demo:** Settings → Reset demo data (owner passcode), or `spacetime call -s maincloud foundation-hackutd reset_demo` as admin. Owner setup (providers, chains, repo audit) survives a reset.
- **Wake the crew:** send any chat. Check `SELECT worker_last_seen_at FROM settings`.
- **Inspect:** `spacetime sql -s maincloud foundation-hackutd "SELECT … FROM activity"`. SQL rows come back unordered, so sort by id.
- **CLI quirk:** negative numbers in `spacetime call` need `--` before the arguments. Object fields in CLI JSON are snake_case.
