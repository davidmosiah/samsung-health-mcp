import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PINNED_NPM_PACKAGE } from "../constants.js";
import type { SamsungHealthConfig } from "../types.js";
import { HERMES_DIRECT_TOOLS, type AgentClientName } from "./agent-manifest.js";
import { getConfig } from "./config.js";
import { inspectExportLocation } from "./samsung-health-export.js";
import { localConfigPath } from "./local-config.js";

export async function buildConnectionStatus(options: { client?: AgentClientName; env?: NodeJS.ProcessEnv; homeDir?: string } = {}) {
  const homeDir = options.homeDir ?? homedir();
  const config: SamsungHealthConfig = getConfig(options.env ?? process.env, homeDir);
  const location = await inspectExportLocation(config.exportPath);
  const nodeSupported = Number(process.versions.node.split(".")[0] ?? 0) >= 20;
  const clientChecks = options.client === "hermes" ? { hermes: await inspectHermesClient(homeDir) } : undefined;
  const ok = nodeSupported && location.exists;
  return {
    ok,
    ready_for_samsung_health_export: location.exists,
    client: options.client,
    node: {
      version: process.versions.node,
      supported: nodeSupported
    },
    config: {
      path: localConfigPath(homeDir),
      export_path: config.exportPath,
      privacy_mode: config.privacyMode,
      timezone: config.timezone,
      last_import_at: config.lastImportAt,
      last_import_source_path: config.lastImportSourcePath
    },
    export: location,
    client_checks: clientChecks,
    next_steps: buildNextSteps({ nodeSupported, location })
  };
}

async function inspectHermesClient(homeDir: string) {
  const configPath = join(homeDir, ".hermes", "config.yaml");
  const skillPath = join(homeDir, ".hermes", "skills", "samsung-health-mcp", "SKILL.md");
  const [config, skillExists] = await Promise.all([readOptionalText(configPath), existsFile(skillPath)]);
  const text = config.text ?? "";
  const check = {
    config_path: configPath,
    config_exists: config.exists,
    samsung_health_server_configured: /samsung-health-mcp-unofficial|samsung-health-mcp-server|samsung-health-mcp/.test(text) && /^\s*samsung_health\s*:/m.test(text),
    package_pinned: /samsung-health-mcp-unofficial@\d+\.\d+\.\d+/.test(text),
    mcp_reload_confirmation_disabled: config.exists ? /mcp_reload_confirm\s*:\s*false/.test(text) : undefined,
    skill_path: skillPath,
    skill_installed: skillExists,
    direct_tool_prefix: "mcp_samsung_health_",
    expected_direct_tools: HERMES_DIRECT_TOOLS
  };
  return { ...check, recommendations: buildHermesRecommendations(check) };
}

async function readOptionalText(path: string): Promise<{ exists: boolean; text?: string }> {
  try {
    return { exists: true, text: await fs.readFile(path, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    throw error;
  }
}

async function existsFile(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function buildHermesRecommendations(check: { config_exists: boolean; samsung_health_server_configured: boolean; package_pinned: boolean; skill_installed: boolean; mcp_reload_confirmation_disabled?: boolean }) {
  const recommendations: string[] = [];
  if (!check.config_exists) recommendations.push("Run `samsung-health-mcp-server setup --client hermes --export-path /path/to/SamsungHealth` to create Hermes config and a local Hermes skill.");
  else if (!check.samsung_health_server_configured) recommendations.push("Add an `samsung_health` MCP server block to `~/.hermes/config.yaml`.");
  if (check.config_exists && check.samsung_health_server_configured && !check.package_pinned) recommendations.push(`Pin Hermes MCP command to \`${PINNED_NPM_PACKAGE}\` to avoid stale npx cache behavior.`);
  if (!check.skill_installed) recommendations.push("Install the Hermes skill at `~/.hermes/skills/samsung-health-mcp/SKILL.md`.");
  if (check.config_exists && check.mcp_reload_confirmation_disabled !== true) recommendations.push("Optional for lower friction: set `approvals.mcp_reload_confirm: false` if your Hermes policy allows MCP reload without confirmation.");
  recommendations.push("After Hermes config changes, use `/reload-mcp` or `hermes mcp test samsung_health`; do not restart the gateway for normal Samsung Health export access.");
  return recommendations;
}

function buildNextSteps(input: { nodeSupported: boolean; location: Awaited<ReturnType<typeof inspectExportLocation>> }) {
  const steps: string[] = [];
  if (!input.nodeSupported) steps.push("Install Node.js 20 or newer.");
  if (!input.location.exists) {
    steps.push("Set SAMSUNG_HEALTH_EXPORT_PATH to a Samsung Health personal-data folder, .csv file, or .zip containing CSV files.");
    steps.push("For lower-friction local setup, run `samsung-health-mcp-server setup --auto-import` after downloading Samsung Health personal data to Downloads, Desktop or Documents.");
    steps.push("On Android: Samsung Health > More options > Settings > Download personal data, then transfer the downloaded Samsung Health folder or zip to this machine.");
  }
  if (steps.length === 0) steps.push("Ready. Start with samsung_health_daily_summary or samsung_health_weekly_summary.");
  return steps;
}
