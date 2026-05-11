# Changelog

## 0.3.0 - 2026-05-11

- Add `samsung_health_quickstart` tool — personalized 3-step setup walkthrough adapted to current state (is `SAMSUNG_HEALTH_EXPORT_PATH` set? does the export folder/CSV/zip exist and parse?). Returns cross-connector hints to pair with wellness-nourish, wellness-cycle-coach, and wellness-cgm-mcp, and emphasizes the local-first / no-cloud-API privacy posture.
- Add `samsung_health_demo` tool — realistic Galaxy-Watch-style example payloads of `samsung_health_daily_summary`, `samsung_health_weekly_summary`, and `samsung_health_wellness_context` so agents see the contract before parsing a real export (heart rate 68, steps 6843, stress 24, sleep score 78, HRV 42 ms).
- `recommended_first_calls` on the agent manifest now leads with `samsung_health_quickstart` and `samsung_health_demo`.
- Tool count: 10 → 12.

## 0.1.0

- Initial public release of `samsung-health-mcp-unofficial`.
- Local-first MCP server for Samsung Health personal-data exports (folder of CSVs, single `.csv`, or `.zip`).
- `samsung_health_connection_status`, `samsung_health_data_inventory`, `samsung_health_daily_summary`, `samsung_health_weekly_summary`, `samsung_health_wellness_context`.
- `samsung_health_list_records` and `samsung_health_list_workouts` with bounded type/start/end filters.
- Privacy modes: `summary`, `structured`, `raw` with summary as the default.
- Hermes client-aware connection-status checks for `~/.hermes/config.yaml` and skill posture.
- MCP resources for agent manifest, capabilities, inventory and daily/weekly summaries.
- Local-config under `~/.samsung-health-mcp/` with managed-exports directory.
