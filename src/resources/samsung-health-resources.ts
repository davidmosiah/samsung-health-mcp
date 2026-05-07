import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildAgentManifest, formatAgentManifestMarkdown } from "../services/agent-manifest.js";
import { buildCapabilities } from "../services/capabilities.js";
import { getConfig } from "../services/config.js";
import { buildDataInventory } from "../services/inventory.js";
import { buildDailySummary, buildWeeklySummary } from "../services/summary.js";

function jsonResource(uri: URL, data: unknown) {
  return {
    contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(data, null, 2) }]
  };
}

function textResource(uri: URL, text: string) {
  return {
    contents: [{ uri: uri.toString(), mimeType: "text/markdown", text }]
  };
}

export function registerSamsungHealthResources(server: McpServer): void {
  server.registerResource("samsung_health_agent_manifest", "samsung-health://agent-manifest", {
    title: "Samsung Health Agent Manifest",
    description: "Machine-readable install and operating instructions for AI agents.",
    mimeType: "text/markdown"
  }, async (uri) => textResource(uri, formatAgentManifestMarkdown(buildAgentManifest("generic"))));

  server.registerResource("samsung_health_capabilities", "samsung-health://capabilities", {
    title: "Samsung Health MCP Capabilities",
    description: "Static capabilities, data boundary, privacy modes and recommended agent workflow.",
    mimeType: "application/json"
  }, async (uri) => jsonResource(uri, buildCapabilities()));

  server.registerResource("samsung_health_data_inventory_resource", "samsung-health://inventory", {
    title: "Samsung Health Data Inventory",
    description: "Available record types, workouts, date coverage and data freshness for the configured export.",
    mimeType: "application/json"
  }, async (uri) => {
    const config = getConfig();
    return jsonResource(uri, await buildDataInventory(config.exportPath, { timezone: config.timezone, privacyMode: config.privacyMode }));
  });

  server.registerResource("samsung_health_daily_summary_resource", "samsung-health://summary/daily", {
    title: "Samsung Health Daily Summary",
    description: "Daily Samsung Health export summary for the current UTC day.",
    mimeType: "application/json"
  }, async (uri) => {
    const config = getConfig();
    return jsonResource(uri, await buildDailySummary(config.exportPath, undefined, { timezone: config.timezone }));
  });

  server.registerResource("samsung_health_weekly_summary_resource", "samsung-health://summary/weekly", {
    title: "Samsung Health Weekly Summary",
    description: "Weekly Samsung Health export summary for the current UTC week window.",
    mimeType: "application/json"
  }, async (uri) => {
    const config = getConfig();
    return jsonResource(uri, await buildWeeklySummary(config.exportPath, undefined, undefined, { timezone: config.timezone }));
  });
}
