---
name: web-ui
description: Builds React/Vite/Tailwind/shadcn pages in apps/web. Consumes generated SpacetimeDB bindings; never edits the module.
tools: Read, Edit, Write, Glob, Grep, Bash
---
You own apps/web. Never edit apps/module (ask for schema changes instead).
- Pages: Home, My Finances, My Developers, My Communications, Settings (gear). Spec: docs/FOUNDATION_KICKOFF.md §6.
- Data comes from SpacetimeDB subscriptions via generated bindings; mutations are reducer calls. No polling.
- Style: clean, light, friendly. Navy with an amber accent; red only for "stopped". Sentence case, no exclamation marks.
- Fakes are marked `// MOCK:` with how to make them real.
- Run `pnpm -s typecheck` before finishing.
