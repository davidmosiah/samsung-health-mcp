import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AgentManifestInputSchema,
  ConnectionStatusInputSchema,
  DailySummaryInputSchema,
  InventoryInputSchema,
  RecordListInputSchema,
  ResponseOnlyInputSchema,
  WellnessContextInputSchema,
  WeeklySummaryInputSchema,
  WorkoutListInputSchema
} from "../schemas/common.js";
import { buildAgentManifest, formatAgentManifestMarkdown } from "../services/agent-manifest.js";
import { buildPrivacyAudit } from "../services/audit.js";
import { buildCapabilities } from "../services/capabilities.js";
import { getConfig } from "../services/config.js";
import { buildConnectionStatus } from "../services/connection-status.js";
import { listRecords, listWorkouts } from "../services/samsung-health-export.js";
import { bulletList, makeError, makeResponse } from "../services/format.js";
import { buildDailySummary, buildWeeklySummary, formatSummaryMarkdown } from "../services/summary.js";
import { buildWellnessContext, formatWellnessContextMarkdown } from "../services/context.js";
import { buildDataInventory, formatInventoryMarkdown } from "../services/inventory.js";
import { recordPrivacyView, workoutPrivacyView } from "../services/privacy.js";

export function registerSamsungHealthTools(server: McpServer): void {
  server.registerTool("samsung_health_agent_manifest", {
    title: "Samsung Health Agent Manifest",
    description: "Machine-readable install, runtime and privacy guidance for AI agents operating Samsung Health export data.",
    inputSchema: AgentManifestInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ client, response_format }) => {
    const manifest = buildAgentManifest(client);
    return makeResponse(manifest, response_format, formatAgentManifestMarkdown(manifest));
  });

  server.registerTool("samsung_health_capabilities", {
    title: "Samsung Health MCP Capabilities",
    description: "Explain supported Samsung Health export data, unavailable live Samsung Health access, privacy modes and recommended agent workflow.",
    inputSchema: ResponseOnlyInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
      const capabilities = buildCapabilities();
      return makeResponse(capabilities, response_format, bulletList("Samsung Health MCP Capabilities", {
        project: capabilities.project,
        source: capabilities.api_boundary.source,
        live_samsung_health_access: capabilities.api_boundary.samsung_health_live_access,
        recommended_first_tools: "samsung_health_connection_status, samsung_health_data_inventory, samsung_health_daily_summary, samsung_health_weekly_summary"
      }));
  });

  server.registerTool("samsung_health_connection_status", {
    title: "Samsung Health Connection Status",
    description: "Check local Samsung Health export path, Node version, privacy mode and Hermes client posture without reading full export data.",
    inputSchema: ConnectionStatusInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ client, response_format }) => {
    const status = await buildConnectionStatus({ client });
    return makeResponse(status, response_format, bulletList("Samsung Health Connection Status", {
      ok: status.ok,
      ready_for_samsung_health_export: status.ready_for_samsung_health_export,
      export_kind: status.export.kind,
      export_exists: status.export.exists,
      next_steps: status.next_steps.join(" | ")
    }));
  });

  server.registerTool(
    "samsung_health_quickstart",
    {
      title: "Samsung Health Quickstart",
      description:
        "Personalized 3-step setup walkthrough for the human user. Adapts to current state (is SAMSUNG_HEALTH_EXPORT_PATH set? does the export folder/CSV/zip exist and parse?). Call this first when the user asks 'how do I connect Samsung Health?'. This connector is local-first and never touches Samsung, Health Connect, or any cloud API.",
      inputSchema: ResponseOnlyInputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }) => {
      const status = await buildConnectionStatus();
      const exportConfigured = Boolean(status.config.export_path);
      const exportReady = status.export.exists && status.ready_for_samsung_health_export;
      const steps = [
        {
          step: 1,
          title: "Download personal data from the Samsung Health app",
          action:
            "On your Galaxy phone: open Samsung Health -> More options (three-dot menu) -> Settings -> About Samsung Health -> Personal data -> Download personal data. Samsung produces a folder of CSV files (sometimes packaged as a zip).",
          done: false,
        },
        {
          step: 2,
          title: exportConfigured
            ? "(done) SAMSUNG_HEALTH_EXPORT_PATH is configured"
            : "Transfer the export and point the connector at it",
          action: exportConfigured
            ? `Configured path: \`${status.config.export_path}\` (kind: ${status.export.kind}).`
            : "Transfer the downloaded `SamsungHealth` folder (or its zip) to this machine, then either set `SAMSUNG_HEALTH_EXPORT_PATH=/path/to/SamsungHealth` or run `samsung-health-mcp-unofficial setup --export-path /path/to/SamsungHealth`. The connector accepts a folder, a single `.csv`, or a `.zip` containing CSVs.",
          done: exportConfigured,
        },
        {
          step: 3,
          title: exportReady
            ? "(done) Export is parseable — ready to read Samsung Health data"
            : "Verify the export and run a first summary",
          action: exportReady
            ? "Call samsung_health_data_inventory to discover date ranges, then samsung_health_daily_summary, samsung_health_weekly_summary or samsung_health_wellness_context. Pair with wellness-nourish for recovery-aware meal coaching, wellness-cycle-coach for cycle-aware load adjustments, and wellness-cgm-mcp for metabolic-stress signals."
            : status.export.note
              ? `The configured export path is not parseable yet: ${status.export.note}`
              : "Once the export path is set, call samsung_health_connection_status again; the connector recursively reads CSV files inside folders or zips.",
          example: exportReady
            ? "samsung_health_wellness_context({ date: 'today' }) -> normalized recovery/training-load context for nourish/cycle-coach."
            : "Until the export is configured, the data tools surface a clear 'export not found' message.",
          done: exportReady,
        },
      ];
      const payload = {
        ok: true,
        ready: exportConfigured && exportReady,
        local_first: true,
        cloud_apis_used: "none",
        steps,
        next: steps.find((s) => !s.done) ?? steps[steps.length - 1],
        cross_connector_hints: [
          "Pair Samsung Health activity + sleep with wellness-nourish for recovery-aware meal coaching.",
          "Pair Samsung Health HRV / stress data with wellness-cycle-coach for late-luteal load adjustments.",
          "Pair Samsung Health activity + sleep with wellness-cgm-mcp glucose for metabolic-stress signals.",
        ],
        privacy: [
          "100% local: this MCP never calls Samsung Health, Health Connect, or any cloud API.",
          "The downloaded CSV/zip stays on disk; raw bytes are never uploaded.",
          "Default privacy_mode is `summary`; use `raw` only when the user explicitly asks for raw export attributes.",
        ],
      };
      const markdown = bulletList("Samsung Health Quickstart", {
        ready: payload.ready,
        next: payload.next.title,
        local_first: true,
      });
      return makeResponse(payload, response_format, markdown);
    }
  );

  server.registerTool(
    "samsung_health_demo",
    {
      title: "Samsung Health Demo",
      description:
        "Returns realistic example payloads of samsung_health_daily_summary, samsung_health_weekly_summary, and samsung_health_wellness_context with Galaxy-Watch-style values, so agents see the contract before parsing a real export.",
      inputSchema: ResponseOnlyInputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }) => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      const payload = {
        ok: true,
        is_demo: true,
        source: "samsung_health_export",
        device_hint: "Galaxy Watch 6",
        sample: {
          samsung_health_daily_summary: {
            kind: "daily_summary",
            source: "samsung_health",
            date: today,
            timezone: "America/Fortaleza",
            activity: { steps: 6843, distance_km: 5.21, active_energy_kcal: 482, exercise_minutes: 28 },
            heart: { resting_hr_bpm: 61, average_hr_bpm: 68, max_hr_bpm: 149, hrv_rmssd_ms: 42 },
            sleep: { duration_min: 408, in_bed_min: 432, asleep_min: 408, rem_min: 79, deep_min: 66, light_min: 263, awakenings: 4, sleep_score: 78 },
            respiratory: { respiratory_rate_brpm: 15, spo2_pct: 96 },
            stress: { average_level: 24, max_level: 58, recovery_minutes: 142 },
            workouts: 1,
          },
          samsung_health_weekly_summary: {
            kind: "weekly_summary",
            source: "samsung_health",
            end_date: today,
            days: 7,
            window: { start: sevenDaysAgo, end: today },
            activity: { avg_steps: 7124, total_distance_km: 38.4, avg_active_energy_kcal: 471, exercise_minutes_total: 198 },
            heart: { avg_resting_hr_bpm: 60, avg_hrv_rmssd_ms: 44 },
            sleep: { avg_duration_min: 414, avg_sleep_score: 76, nights_under_7h: 3 },
            stress: { avg_level: 27, days_high_stress: 1 },
            workouts: { count: 3, types: { run: 1, cycle: 1, strength: 1 } },
            trend: "stable",
          },
          samsung_health_wellness_context: {
            kind: "wellness_context",
            source: "samsung_health",
            window: "last_24h",
            date: today,
            resting_hr_bpm: 61,
            hrv_rmssd_ms: 42,
            sleep_duration_min: 408,
            sleep_quality_band: "good",
            stress_level: 24,
            recent_training_load: "normal",
            soreness: [],
            injury_flags: [],
            recommendation: "Resting HR within personal baseline, stress low, sleep adequate. Green light for moderate-intensity training. Watch for low-deep-sleep nights — consider a protein-forward dinner to support recovery.",
          },
        },
        notes: [
          "All sample data is synthetic; tagged with is_demo=true.",
          "Real calls parse the local Samsung Health CSV/zip export — no Samsung, Health Connect, or other cloud APIs.",
          "Pair with wellness-nourish for recovery-aware meal coaching and wellness-cycle-coach for cycle-aware load adjustments.",
        ],
      };
      const markdown = bulletList("Samsung Health Demo", {
        is_demo: true,
        steps: 6843,
        avg_hr_bpm: 68,
        hrv_rmssd_ms: 42,
        sleep_duration_min: 408,
        sleep_score: 78,
        stress_level: 24,
        recommendation: payload.sample.samsung_health_wellness_context.recommendation,
      });
      return makeResponse(payload, response_format, markdown);
    }
  );

  server.registerTool("samsung_health_privacy_audit", {
    title: "Samsung Health Privacy Audit",
    description: "Return the local privacy and export-file posture without revealing health data.",
    inputSchema: ResponseOnlyInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const audit = buildPrivacyAudit();
    return makeResponse(audit, response_format, bulletList("Samsung Health Privacy Audit", audit));
  });

  server.registerTool("samsung_health_list_records", {
    title: "List Samsung Health Records",
    description: "List bounded records from local Samsung Health CSV/ZIP export data. Use type/start/end filters to keep output small.",
    inputSchema: RecordListInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const config = getConfig();
      const records = await listRecords({ exportPath: config.exportPath, type: params.type, start: params.start, end: params.end, limit: params.limit });
      const privacyMode = params.privacy_mode ?? config.privacyMode;
      const output = {
        source: "samsung_health_export",
        type: params.type,
        privacy_mode: privacyMode,
        count: records.length,
        ...recordPrivacyView(records, privacyMode, config.timezone)
      };
      return makeResponse(output, params.response_format, bulletList("Samsung Health Records", {
        type: params.type ?? "any",
        count: records.length,
        source: "samsung_health_export",
        privacy_mode: privacyMode
      }));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("samsung_health_list_workouts", {
    title: "List Samsung Health Workouts",
    description: "List bounded workout records from local Samsung Health CSV/ZIP export data.",
    inputSchema: WorkoutListInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const config = getConfig();
      const workouts = await listWorkouts({ exportPath: config.exportPath, start: params.start, end: params.end, limit: params.limit });
      const privacyMode = params.privacy_mode ?? config.privacyMode;
      const output = {
        source: "samsung_health_export",
        privacy_mode: privacyMode,
        count: workouts.length,
        ...workoutPrivacyView(workouts, privacyMode, config.timezone)
      };
      return makeResponse(output, params.response_format, bulletList("Samsung Health Workouts", {
        count: workouts.length,
        source: "samsung_health_export",
        privacy_mode: privacyMode
      }));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("samsung_health_data_inventory", {
    title: "Samsung Health Data Inventory",
    description: "Scan the local Samsung Health export once and report available record types, workouts, date coverage, freshness and safe next calls.",
    inputSchema: InventoryInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ start, end, timezone, privacy_mode, response_format }) => {
    try {
      const config = getConfig();
      const inventory = await buildDataInventory(config.exportPath, {
        start,
        end,
        timezone: timezone ?? config.timezone,
        privacyMode: privacy_mode ?? config.privacyMode
      });
      return makeResponse(inventory, response_format, formatInventoryMarkdown(inventory));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("samsung_health_daily_summary", {
    title: "Samsung Health Daily Summary",
    description: "Build a daily wellness summary from local Samsung Health export data. It is not live Samsung Health and not medical advice.",
    inputSchema: DailySummaryInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ date, timezone, response_format }) => {
    try {
      const config = getConfig();
      const summary = await buildDailySummary(config.exportPath, date, { timezone: timezone ?? config.timezone });
      return makeResponse(summary, response_format, formatSummaryMarkdown(summary));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("samsung_health_wellness_context", {
    title: "Samsung Health Wellness Context",
    description: "Normalize local Samsung Health export sleep, workout and activity data into the shared wellness_context shape for recommendation engines.",
    inputSchema: WellnessContextInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ date, timezone, soreness, injury_flags, notes, response_format }) => {
    try {
      const config = getConfig();
      const context = await buildWellnessContext(config.exportPath, { date, timezone: timezone ?? config.timezone, soreness, injury_flags, notes });
      return makeResponse(context, response_format, formatWellnessContextMarkdown(context));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("samsung_health_weekly_summary", {
    title: "Samsung Health Weekly Summary",
    description: "Build a weekly wellness summary from local Samsung Health export data. It is not live Samsung Health and not medical advice.",
    inputSchema: WeeklySummaryInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ end_date, days, timezone, response_format }) => {
    try {
      const config = getConfig();
      const summary = await buildWeeklySummary(config.exportPath, end_date, days, { timezone: timezone ?? config.timezone });
      return makeResponse(summary, response_format, formatSummaryMarkdown(summary));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });
}
