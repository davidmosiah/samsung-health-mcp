# Changelog

## 0.7.0 - 2026-08-01

### Fixed — the 0.6.0 privacy gate could not fail on the resource path

- **`scripts/privacy-leak-test.mjs` asserted nothing for `samsung-health://summary/daily` and `summary/weekly`.** Both resources take no arguments: daily is always "today" and weekly is always "the last 7 days". The fixture is dated 2026-05-01, so the resources read an empty window and the leak assertions passed against *any* code — including the 0.5.1 build that really did leak. Measured: reading the daily resource on the pre-fix build with the committed fixture finds **zero** of the 11 forbidden needles; the same read against a fixture dated today leaks `-11.111111`, `-22.222222`, `FAKE-DEVICE-UUID`, `SYNTHETIC-FREE-TEXT-NOTE`, `999.9`, `latitude`, `longitude` and `deviceuuid` in all four privacy modes. **The 0.6.0 fix was correct; only the gate protecting it was blind**, and it was getting worse with time — a weekly window can never reach back to May 2026.
  - The gate now writes a synthetic export dated *today* (rows at 12:00Z for yesterday/today/tomorrow, obviously fake coordinates) and reads the resources against it.
  - Every resource check asserts **non-vacuity first** — the workout carrying the sensitive columns is really inside the window that was read — and only then asserts the payload is clean. A future change that stops exercising the path fails loudly instead of going quietly green.
  - Same treatment for `samsung_health_daily_summary` called with **no `date`**, the default an agent actually sends, which the May fixture could never cover either. `samsung_health_weekly_summary` is now in the leak sweep as well.

### Changed (output contract) — `samsung_health_weekly_summary` no longer echoes a privacy mode it did not apply

- The weekly rollup accepted `privacy_mode` and silently discarded it: asking for `raw` returned `privacy_mode: "summary"` with no explanation, so an agent could not tell an override from an export with no workouts. The aggregation itself is correct and stays — honouring `raw` here would open a 30-day path to raw workout records — but the answer now says so:
  - **`requested_privacy_mode`** — what the caller asked for (falls back to `SAMSUNG_HEALTH_PRIVACY_MODE`).
  - **`privacy_mode`** — what was actually applied. Always `summary`.
  - **`privacy_disclosure`** — names the override explicitly (`weekly_summary_always_aggregates_requested_privacy_mode_raw_was_not_applied_use_samsung_health_daily_summary_or_samsung_health_list_workouts_for_record_level_access`) and points at the tools that do serve record-level access.
- The weekly tool and the `samsung-health://summary/weekly` resource now pass the requested/configured mode through instead of dropping it on the floor. Per-day `daily[].workouts.privacy_mode` still reports the applied mode, which is now true rather than divergent.

## 0.6.0 - 2026-08-01

### Fixed — privacy (high severity)

- **`samsung_health_daily_summary` and the `samsung-health://summary/daily` resource leaked location and device identity.** Both returned the raw workout objects, whose `metadata` carried every column of the exercise CSV verbatim: `start_latitude`, `start_longitude`, `end_latitude`, `end_longitude`, `max_altitude`, the stable hardware id `deviceuuid`, and free-text user fields such as `com.samsung.health.exercise.custom`. In practice an agent asking "how was my day?" received the exact GPS coordinates of the user's home and running route, plus an identifier that follows the device across exports.
  - `SAMSUNG_HEALTH_PRIVACY_MODE` was ignored on this path: `summary`, `structured` and `raw` all returned the same full dump, contradicting the documented default.
  - With the default `response_format: "markdown"` the rendered text did not show the workouts, but `structuredContent` still carried the whole object — so the leak was invisible to a human reading the reply while the host and the model received the coordinates anyway.
- **Root cause:** `buildDailySummary` never accepted a privacy mode, so `summarizeDay` fell through to the "include raw workouts" branch (the weekly summary already suppressed them), and `buildMetadata` copied every CSV column with no filtering.

### Changed (output contract)

- `samsung_health_daily_summary` accepts `privacy_mode` (`summary` | `structured` | `raw`, default from `SAMSUNG_HEALTH_PRIVACY_MODE`, itself defaulting to `summary`). The daily-summary resource now follows the server privacy mode.
- `workouts` in daily and weekly summaries gained `privacy_mode` and `disclosure` fields, matching `samsung_health_list_workouts`. In the default `summary` mode `workouts.records` is now `[]` (aggregates — `count`, `total_duration_minutes`, `activity_counts` — are unchanged); individual records require an explicit `structured` or `raw` request. `samsung_health_weekly_summary` never returns individual workout records.
- **Record and workout `metadata` is now allowlisted instead of copied wholesale**, at parse time, so no consumer — including `raw` mode, the inventory's `metadata_keys`, and any future caller — can reach coordinates, altitude, hardware identifiers or free-text fields. An allowlist rather than a denylist because Samsung adds export columns whenever the app changes; a denylist only covers the leaks already known. Dropped columns are reported as a `withheld_metadata_count`.
- `deviceuuid` is no longer promoted into `sourceName` (it matched the `device` alias used for source inference).

### Added

- `npm run test:privacy` (`scripts/privacy-leak-test.mjs`), wired into `npm test`. The `exercise` fixture now carries synthetic GPS/device columns (obviously fake: `-11.111111`, `FAKE-DEVICE-UUID-…`) — no fixture had a latitude column before, which is why every gate stayed green through this bug. The test asserts that neither the sensitive values nor their column names appear in `content` **or** `structuredContent`, across tools and resources, in every privacy mode.

## 0.5.1 - 2026-07-30

### Added / Fixed

- clear/reimport mutation gate wording for scorecard 100.

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
