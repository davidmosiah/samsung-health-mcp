---
name: samsung-health-mcp
description: >-
  Read the user's Samsung Health personal-data export (steps, exercise, heart rate, sleep) through the local samsung-health MCP server. Use when the user asks about Samsung Health or Galaxy Watch records, daily or weekly summaries, or trends from their Samsung Health download. Starts with connection status and data inventory, uses synthetic demo data before an export is imported.
---

# Samsung Health

MCP server `samsung-health` from the `samsung-health-mcp-unofficial@0.8.0` npm package, run locally through `npx`. It reads steps, exercise, heart rate, sleep and other records from the Samsung Health data download. Data source: no network service: it parses the user's own Samsung Health personal-data CSV/ZIP export on disk.

## Workflow

1. Start with `samsung_health_connection_status`. Then pick what fits the question: `samsung_health_data_inventory`, `samsung_health_daily_summary`, `samsung_health_weekly_summary`.
2. If `samsung_health_connection_status` reports the connector is not ready, call `samsung_health_demo` for clearly labelled synthetic data so the user sees the shape of the answer, then give them the setup commands below to run in their own terminal.
3. Lead with the answer to the user's question, then the two or three numbers that support it, with dates. Say when data is missing or stale instead of filling gaps.

## Setup (the user runs this in a terminal, not in chat)

```bash
npx -y samsung-health-mcp-unofficial@0.8.0 setup --import /absolute/path/to/SamsungHealth-export.zip --timezone <IANA-zone>
npx -y samsung-health-mcp-unofficial@0.8.0 doctor
```

Download the data first in the Samsung Health app (Settings → Download personal data) and copy only that export to this machine. Use an explicit file or dedicated export folder, not a broad personal folder. Do not use `setup --client hermes`: the portable plugin already supplies the MCP entry and skill. Keep Hermes approval settings unchanged. The pinned npm 0.8.0 is held from catalog submission pending safety fixes; see this package’s README.

## Safety

- Health summaries and local paths returned to Hermes may reach its configured model/provider; local parsing alone is not a no-egress guarantee.
- State is HOME-based and shared across Hermes profiles: exports/config/cache under `~/.samsung-health-mcp/`, wellness profile under `~/.delx-wellness/`. In npm 0.8.0, profile reads may migrate a legacy file and write shared state.
- A previously configured watch folder can automatically import/promote exports. Do not configure it without the user asking.
- Never ask the user to paste client secrets, passwords, tokens or MFA codes into the chat; setup happens in their terminal.
- Tools that change local state: samsung_health_profile_update (local profile only), samsung_health_reimport (re-reads the local export). Use them only when the user asks.
- Destructive: samsung_health_clear_incremental_cache (clears the local parsed cache). Confirm with the user first.
- No live sync: data is as fresh as the last export the user imported.
- Not medical advice: the data supports personal reflection and planning, not diagnosis or treatment. Point the user to a clinician for symptoms, medication or anything urgent.
