import { NPM_PACKAGE_NAME, PINNED_NPM_PACKAGE, SERVER_VERSION, SUPPORTED_RECORD_TYPES } from "../constants.js";

export const AGENT_CLIENTS = ["generic", "claude", "cursor", "windsurf", "hermes", "openclaw"] as const;
export type AgentClientName = typeof AGENT_CLIENTS[number];

export const HERMES_DIRECT_TOOLS = [
  "mcp_samsung_health_samsung_health_agent_manifest",
  "mcp_samsung_health_samsung_health_connection_status",
  "mcp_samsung_health_samsung_health_data_inventory",
  "mcp_samsung_health_samsung_health_daily_summary",
  "mcp_samsung_health_samsung_health_weekly_summary",
  "mcp_samsung_health_samsung_health_wellness_context",
  "mcp_samsung_health_samsung_health_list_records",
  "mcp_samsung_health_samsung_health_list_workouts"
];

const STANDARD_TOOLS = [
  "samsung_health_agent_manifest",
  "samsung_health_capabilities",
  "samsung_health_connection_status",
  "samsung_health_data_inventory",
  "samsung_health_daily_summary",
  "samsung_health_demo",
  "samsung_health_list_records",
  "samsung_health_list_workouts",
  "samsung_health_onboarding",
  "samsung_health_privacy_audit",
  "samsung_health_profile_get",
  "samsung_health_profile_update",
  "samsung_health_quickstart",
  "samsung_health_weekly_summary",
  "samsung_health_wellness_context"
];

export function parseAgentClientName(value: string | undefined): AgentClientName {
  return AGENT_CLIENTS.includes(value as AgentClientName) ? value as AgentClientName : "generic";
}

export function buildAgentManifest(client: AgentClientName = "generic") {
  return {
    project: "samsung-health-mcp-unofficial",
    mcp_name: "io.github.davidmosiah/samsung-health-mcp",
    client,
    unofficial: true,
    samsung_health_live_access: false,
    package: {
      name: NPM_PACKAGE_NAME,
      version: SERVER_VERSION,
      install_command: `npx -y ${NPM_PACKAGE_NAME}`,
      pinned_install_command: `npx -y ${PINNED_NPM_PACKAGE}`,
      binary: "samsung-health-mcp-server"
    },
    data_model: {
      source: "Samsung Health personal-data download CSV files from the Samsung Health app",
      live_samsung_health_bridge: "planned Android bridge via Samsung Health Data SDK or Health Connect; not available in this Node MCP server",
      export_path_env: "SAMSUNG_HEALTH_EXPORT_PATH",
      timezone_env: "SAMSUNG_HEALTH_TIMEZONE",
      local_config: "~/.samsung-health-mcp/config.json",
      managed_exports_dir: "~/.samsung-health-mcp/exports",
      supported_record_types: SUPPORTED_RECORD_TYPES
    },
    recommended_first_calls: ["samsung_health_profile_get", "samsung_health_quickstart", "samsung_health_demo", "samsung_health_connection_status", "samsung_health_data_inventory", "samsung_health_wellness_context", "samsung_health_daily_summary", "samsung_health_weekly_summary"],
    standard_tools: STANDARD_TOOLS,
    resources: ["samsung-health://agent-manifest", "samsung-health://capabilities", "samsung-health://inventory", "samsung-health://summary/daily", "samsung-health://summary/weekly"],
    hermes: {
      config_path: "~/.hermes/config.yaml",
      skill_path: "~/.hermes/skills/samsung-health-mcp/SKILL.md",
      tool_name_prefix: "mcp_samsung_health_",
      common_tool_names: HERMES_DIRECT_TOOLS,
      recommended_config: hermesConfigSnippet(),
      use_direct_tools: true,
      avoid_terminal_workarounds: true,
      no_gateway_restart_for_data_access: true,
      reload_after_config_change: "/reload-mcp or hermes mcp test samsung_health",
      doctor_command: "npx -y samsung-health-mcp-unofficial doctor --client hermes --json"
    },
    agent_rules: [
      "Start with samsung_health_connection_status and do not assume an export exists.",
      "Use samsung_health_data_inventory before detailed questions to learn available date ranges, record types and stale export risk.",
      "Ask the user for a local Samsung Health export directory, CSV file, or zip, not raw health data pasted into chat.",
      "Treat Samsung Health CSV exports as sensitive health data and never print full raw exports.",
      "Default to summary privacy mode. Use raw only when the user explicitly requests raw export attributes.",
      "Do not claim live Samsung Health access from Node. This connector reads Samsung Health exports; Android live bridge is a separate future component.",
      "For Hermes, do not restart the gateway for normal Samsung Health data access; reload MCP instead.",
      "Do not provide medical diagnosis or treatment instructions. Frame outputs as wellness, activity and recovery context."
    ],
    troubleshooting: [
      { symptom: "missing SAMSUNG_HEALTH_EXPORT_PATH", action: "Run `samsung-health-mcp-server setup --export-path /path/to/SamsungHealth` or set SAMSUNG_HEALTH_EXPORT_PATH." },
      { symptom: "user wants automatic import", action: "Run `samsung-health-mcp-server setup --auto-import`; it scans common local folders, copies the newest export into ~/.samsung-health-mcp/exports and stores that managed path." },
      { symptom: "export path points to a directory", action: "Use the downloaded Samsung Health folder; the connector recursively reads CSV files." },
      { symptom: "export path points to a zip", action: "The connector reads CSV files inside the zip without extracting it." },
      { symptom: "agent asks for live Samsung Health data", action: "Explain that live access requires Android bridge work through Samsung Health Data SDK or Health Connect, not this Node-only MCP." }
    ],
    links: {
      github: "https://github.com/davidmosiah/samsung-health-mcp",
      samsung_health_data_sdk: "https://developer.samsung.com/health/data/overview.html",
      samsung_personal_data_export: "https://www.samsung.com/us/support/answer/ANS10001379/",
      health_connect: "https://support.google.com/android/answer/12201227",
      delx_wellness: "https://github.com/davidmosiah/delx-wellness"
    }
  };
}

export function formatAgentManifestMarkdown(manifest: ReturnType<typeof buildAgentManifest>): string {
  return `# Samsung Health MCP Agent Manifest

Unofficial: ${manifest.unofficial}
Package: \`${manifest.package.name}\` v${manifest.package.version}
Install: \`${manifest.package.install_command}\`
Pinned install: \`${manifest.package.pinned_install_command}\`

## Data Boundary
Source: ${manifest.data_model.source}
Live Samsung Health: ${manifest.samsung_health_live_access ? "available" : "not available in this Node connector"}
Export env: \`${manifest.data_model.export_path_env}\`
Timezone env: \`${manifest.data_model.timezone_env}\`

## First Calls
${manifest.recommended_first_calls.map((tool) => `- \`${tool}\``).join("\n")}

## Hermes
Config: \`${manifest.hermes.config_path}\`
Skill: \`${manifest.hermes.skill_path}\`
Reload: \`${manifest.hermes.reload_after_config_change}\`
Direct tools:
${manifest.hermes.common_tool_names.map((tool) => `- \`${tool}\``).join("\n")}

## Agent Rules
${manifest.agent_rules.map((rule) => `- ${rule}`).join("\n")}
`;
}

export function hermesConfigSnippet(): string {
  return `mcp_servers:\n  samsung_health:\n    command: npx\n    args:\n      - -y\n      - ${PINNED_NPM_PACKAGE}\n    timeout: 120\n    connect_timeout: 60\n    sampling:\n      enabled: false`;
}

export function hermesSkillMarkdown(): string {
  return `# Samsung Health MCP Skill

Use this skill whenever a user asks Hermes to inspect Samsung Health or Galaxy Watch export data: activity, sleep, heart-rate, HRV, workouts, daily summaries or weekly summaries through the Samsung Health MCP.

## Rules
- Start with \`mcp_samsung_health_samsung_health_connection_status\`.
- Use \`mcp_samsung_health_samsung_health_data_inventory\` to discover available data before detailed analysis.
- Prefer \`mcp_samsung_health_samsung_health_daily_summary\` and \`mcp_samsung_health_samsung_health_weekly_summary\` before low-level record calls.
- Treat Samsung Health exports as sensitive. Do not request raw export text in chat.
- Default to summary privacy mode. Use raw only when the user explicitly requests raw export attributes.
- This connector reads Samsung Health export files. Do not claim live Samsung Health access from Node.
- Do not diagnose or treat medical conditions.
- Reload MCP with \`/reload-mcp\` or \`hermes mcp test samsung_health\`; do not restart the gateway for normal data access.
`;
}
