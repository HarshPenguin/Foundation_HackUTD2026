# Foundation for Claude Code

Already using Claude Code? Keep it. Foundation works around it:

| | What happens |
|---|---|
| **Spend tracking** | After every Claude Code reply, a `Stop` hook reports the session's token usage. Foundation prices it (current Claude list prices, including cache reads and writes) and charges it to the **Claude Code** wallet and your weekly budget. Reports are cumulative per session, so a repeated report never double-charges. |
| **$0 hard stop** | Before every prompt, a `UserPromptSubmit` hook asks Foundation. The decision is made inside a SpacetimeDB reducer, using the same rule as the crew (`balance − reserved − estimate ≥ threshold`, and the weekly limit while spending is locked). If the budget says stop, Claude Code blocks the prompt and tells you why. |
| **Crew tools (MCP)** | `foundation_status`, `foundation_app_audit` (the Auditor's map of your legacy app), `foundation_recent_changes`, `foundation_ask_translator`, `foundation_request_work` (hand work to the crew). |

## Setup (about 2 minutes)

```bash
cd integrations/claude-code
npm install
npm run build
node dist/cli.js connect --passcode <owner passcode> --name "My laptop"
node dist/cli.js install --project /path/to/your/app
```

`connect` creates this computer's own Foundation identity and links it with the owner passcode. The connection is saved in `~/.foundation/claude-code.json`. No API key is stored or sent.

`install` adds the `foundation` MCP server to the project's `.mcp.json` and the hooks to the project's `.claude/settings.json`. It merges with existing settings, and running it twice is safe. Start Claude Code in that folder and approve the `foundation` server.

Check the connection at any time:

```bash
node dist/cli.js status
```

## Notes

- **Fails open.** If Foundation is unreachable, prompts are allowed and a note goes to stderr.
- **Configuration:** `FOUNDATION_SERVER` / `FOUNDATION_DB` override the default database (`maincloud.spacetimedb.com` / `foundation-hackutd`). `FOUNDATION_PROMPT_ESTIMATE_MICROS` sets the per-prompt estimate (default $0.05).
- **Behind a corporate proxy:** run Node with `NODE_USE_ENV_PROXY=1`.
- **Disconnect** from Foundation's Settings → Integrations.
- **MOCK:** the Claude Code wallet balance is an allowance you set in Foundation, not your real Anthropic balance. Real: read it from the Anthropic Admin API cost report.
