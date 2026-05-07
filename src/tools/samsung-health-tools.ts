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
