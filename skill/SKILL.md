---
name: samsung-health
description: >
  Unofficial Samsung Health export MCP for AI agents. Prefer MCP tools if connected; otherwise the package CLI.
  Use when the user wants Samsung Health data or actions through an agent.
---

# Samsung Health — skill or MCP

Same binary either way. Do not duplicate the API client.

## Choose a surface

**MCP** — tools appear natively after stdio/HTTP config:

```json
{ "mcpServers": { "samsung-health": { "command": "npx", "args": ["-y", "samsung-health-mcp-unofficial"] } } }
```

Do not put mutation flags in that snippet.

**Skill / CLI** — no MCP client required. Same tools:

```bash
npx -y samsung-health-mcp-unofficial call samsung_health_connection_status --json '{}'
```

If MCP tools named `samsung_*` are already available, use them. Do not also shell out.

## Loop

1. Call `samsung_health_connection_status` (or `doctor --json` when that exists).
2. Use read tools as asked.
3. Stop on `USER_ACTION_REQUIRED`. Do not invent env flags. Do not enable mutations from this skill.

## Never

- Paste tokens into git, chat logs, or the prompt
- Copy a mutations-enabled assignment into config
