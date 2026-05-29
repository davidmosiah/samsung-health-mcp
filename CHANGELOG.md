# Changelog

## 0.5.0 - 2026-05-29

### Added

- **Watch-folder auto-reimport (no Android device required).** Point the connector at a folder via `SAMSUNG_HEALTH_WATCH_PATH`, `~/.samsung-health-mcp/config.json`, or `setup --watch-path <dir>`. When a newer Samsung Health export appears there — a `SamsungHealth` export directory of CSVs, a single `*.csv`, or any `*samsung*health*.zip` — it is auto-promoted to the active export and the snapshot + incremental caches are cleared so the next summary reflects the new data. Reconciliation runs on server startup, live via filesystem events on long-running transports, and on demand. Turns the one-shot manual-export reader into a recurring-refresh workflow.
- **`samsung_health_reimport` tool** for an explicit re-scan of the watch folder (`check_only: true` previews without promoting; `force: true` re-promotes the newest export to force a cache refresh). Tool count: 17 → 18.
- **`watch_folder` block + warning in `samsung_health_connection_status`** reporting the watch path, whether the active export is the latest, the last watch-import timestamp, and a warning when a newer export is waiting to be imported.
- **`setup --watch-path <dir>`** persists the watch folder and immediately promotes any export already sitting in it.

### Note

- The native Android Health Connect bridge (live, no manual export) genuinely requires an Android device + native component and remains out of scope for this Node MCP server.

## 0.4.3 - 2026-05-20

### Added

- **Incremental import cache** at `~/.samsung-health-mcp/incremental-cache.json` (chmod 600). Persists the latest parsed timestamp per Samsung Health record category so repeated `samsung_health_list_records` calls can skip already-seen records on large CSV/ZIP exports. Opt-in per call via `incremental_cache: true` (requires `type` filter). The cache is automatically invalidated when the export file/directory mtime changes (signaling a fresh export from the Samsung Health app).
- **`samsung_health_clear_incremental_cache` tool** for manual cache invalidation when you want to force a full re-parse without re-exporting from Samsung Health. Tool count: 16 → 17.
- **`incremental_cache` block in `samsung_health_connection_status`** showing cache existence, file size, last-update timestamp, tracked export mtime, and per-category last-parsed entries.

## 0.4.2 - 2026-05-19

### Added

- **`samsung_health_export_freshness` workflow tool.** Returns the local export file/directory mtime, `days_since_export`, an `is_stale` flag, and a `recommendation` string. Considered stale when the export is older than 30 days, or older than 7 days with no recent records (the inventory's latest-record date also older than 7 days). Useful before relying on summary/wellness-context calls. Tool count: 15 → 16.
- **Stale-export warning surfaced inside `samsung_health_connection_status`.** When the export is stale, `connection_status` now returns an `export_freshness` block (`days_since_export`, `is_stale`, `stale_reason`, `recommendation`) and a `warnings: [...]` array so agents can flag this without an extra round-trip.

## 0.4.1 - 2026-05-11

### Fixed

- **Profile-store regex no longer false-positives on common wellness words.** Split `SECRET_PATTERNS` into `SECRET_KEY_PATTERNS` (broad, for field names like `oauth_token`) and `SECRET_VALUE_PATTERNS` (high-specificity, only credential shapes: JWTs, `Bearer <token>`, `sk_live_`, `sk-proj-`, `xoxb-`, `github_pat_`, raw `Authorization:` headers). Previously legitimate text like "5 training sessions per week", "limit cookies", "I need to refresh my approach", or "secret sauce: more sleep" was rejected.
- **Partial-profile reads no longer crash downstream.** `readProfileFile` now structurally merges with `DEFAULT_PROFILE` when legacy Hermes/OpenClaw files lacked sub-objects. Previously `buildProfileSummary` and `missingCriticalFields` would throw.
- **Onboarding `privacy_note` no longer hard-codes a single connector path.** Lists multiple example paths so the message reads correctly from every connector.

## 0.4.0 - 2026-05-11

- Add shared Delx Wellness profile support. Vendored copy of the canonical `profile-store` (delx-wellness commit ab83d1a) at `src/services/profile-store.ts` reads and writes `~/.delx-wellness/profile.json` — a single source of truth for preferred name, goals, devices, training/nutrition/exercise/agent preferences and safety flags shared across every Delx Wellness MCP connector. Local-export connector: this profile is the only piece of cross-connector context — neither cloud tokens nor health data leave disk.
- Add `samsung_health_profile_get` — read-only return of the current shared profile plus a summary and missing-critical fields.
- Add `samsung_health_profile_update` — partial-patch writer. Requires `explicit_user_intent=true` (otherwise returns USER_ACTION_REQUIRED). Rejects secret-like fields at write time.
- Add `samsung_health_onboarding` — read-only 11-question onboarding flow (en / pt-BR) plus current profile state and cross-connector hint.
- Add `samsung-health-mcp-server onboarding` CLI command — emits flow JSON to stdout and a TTY-gated Markdown summary to stderr.
- `recommended_first_calls` on the agent manifest now leads with `samsung_health_profile_get`.
- Tool count: 12 → 15.

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
