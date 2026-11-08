# Demo script (2 minutes)

**Before you start (5 minutes ahead):**
1. Open https://foundation-hackutd.vercel.app, go to **Settings → Reset demo data**, and enter the owner passcode.
2. Check that the header pill says **Crew online**. If it says offline, send any chat message: SpacetimeDB wakes the crew on Maritime, which takes a few seconds.
3. Optional: have a Claude Code window open in a project where you ran `node dist/cli.js install`.

---

**1. The problem (15 s): Home.**
"Every vibe-coded app becomes a legacy app the day it ships, and the people who built it can't maintain it. Foundation is an AI maintenance team that does it for them, and it never spends a dollar they didn't approve."
Type **"Is my app safe?"** to the Chatbot. It answers in plain English.

**2a. Connect your code (20 s): My Developers.**
In the "Connect your code" card, click "Try it with DVWA", enter the owner passcode, and click **Connect and audit**. The live panel shows the Auditor cloning it and reading 242 files, and real risks appear with their `file:line`. "How DVWA works" shows up with a health score.

**2b. Understand (15 s): My Developers.**
Show the Auditor's "How MediClaim works": an SQL injection in claim search, and claim totals that drift by cents ("the kind of error behind Medicare's $28.8B in improper payments").

**3. Repair (30 s): Run now.**
Click **Run now**. The live panel streams the Manager planning, the Developers patching on real git branches, and the Tester running real PHP checks and approving.
Mid-run, **Gemini hits its $0 threshold**, and the Purser switches to the next model by itself (the amber line).
"That rule runs inside a SpacetimeDB reducer, so no agent can get around it."

**4. Finances (25 s): My Finances.**
- The meters moved live as the crew spent.
- Show the **spending lock**: "Are you sure?" requires typing UNLOCK.
- Show the **budget calculator** warning when a schedule would go over budget.
- Show the **onboarding**: bring any model (Hugging Face, Claude, Gemini, OpenAI or any OpenAI-compatible API). Keys sit in a private table only the crew can read.

**5. Claude Code (20 s).**
"If you already use Claude Code, keep it."
Show **Settings → Integrations → Claude Code**: its spend appears in My Finances, and when the budget is used up, Claude Code's prompt gets blocked by the same rule. In Claude Code, ask "use foundation_status".

**6. People (10 s): My Communications.**
Show the weekly update and the Reviewer's card: *"Researcher placed on review. Recommend replacing."* Fire and replace, and "Researcher #2 hired" appears.

**Close (5 s).**
"Legacy code, modernized. APIs, managed. Budget, protected. Foundation runs on SpacetimeDB, with the crew on Maritime."

---

**If something breaks:** every screen is driven by seed data, and each employee has an offline playbook, so the run still completes even if every model call fails. Reset demo data to start clean.
