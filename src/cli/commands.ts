import { SERVER_VERSION } from "../constants.js";
import { parseAgentClientName } from "../services/agent-manifest.js";
import { buildConnectionStatus } from "../services/connection-status.js";
import {
  buildProfileSummary,
  getOnboardingFlow,
  getProfile,
  missingCriticalFields
} from "../services/profile-store.js";
import { runSetupCommand } from "./setup.js";

const COMMANDS = ["setup", "doctor", "status", "onboarding", "version", "help"] as const;

export async function runCliCommand(args: string[]): Promise<number | undefined> {
  const [command, ...rest] = args;
  if (!command || command === "--http") return undefined;
  if (command === "setup") return runSetupCommand(rest);
  if (command === "doctor" || command === "status") return runDoctor(rest);
  if (command === "onboarding") return runOnboarding(rest);
  if (command === "version" || command === "--version" || command === "-v") {
    console.log(SERVER_VERSION);
    return 0;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (!command.startsWith("--")) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }
  return undefined;
}

async function runOnboarding(args: string[]): Promise<number> {
  const locale = args.includes("--pt-BR") || args.includes("--pt-br") ? "pt-BR" : "en";
  const flow = getOnboardingFlow(locale);
  const profile = await getProfile();
  const payload = {
    ok: true,
    flow,
    current_profile: profile,
    missing_critical: missingCriticalFields(profile),
    summary: buildProfileSummary(profile),
    cross_connector_hint:
      "This profile is shared across every Delx Wellness MCP connector (whoop, garmin, oura, fitbit, strava, polar, withings, apple-health, samsung-health, google-health, nourish, cycle-coach, cgm, air)."
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  if (process.stderr.isTTY) {
    process.stderr.write(`\n# Delx Wellness Onboarding (${flow.locale})\n`);
    process.stderr.write(`Storage: ${flow.storage_path}\n`);
    process.stderr.write(`Profile summary: ${payload.summary}\n`);
    process.stderr.write(`Missing critical: ${payload.missing_critical.join(", ") || "none"}\n`);
    process.stderr.write(`\n${flow.privacy_note}\n\nQuestions:\n`);
    for (const q of flow.questions) {
      process.stderr.write(`  - [${q.category}${q.required ? "*" : ""}] ${q.prompt}\n`);
    }
    process.stderr.write(`\n${payload.cross_connector_hint}\n`);
  }
  return 0;
}

export { COMMANDS };

async function runDoctor(args: string[]): Promise<number> {
  const options = parseDoctorOptions(args);
  const status = await buildConnectionStatus({ client: options.client });
  if (options.json) console.log(JSON.stringify(status, null, 2));
  else printDoctor(status);
  return options.strict && !status.ok ? 1 : 0;
}

function parseDoctorOptions(args: string[]) {
  let client: ReturnType<typeof parseAgentClientName> | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--client") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --client.");
      client = parseAgentClientName(value);
      index += 1;
    }
  }
  return {
    json: args.includes("--json"),
    strict: args.includes("--strict"),
    client
  };
}

function printDoctor(status: Awaited<ReturnType<typeof buildConnectionStatus>>): void {
  const ok = "✓";
  const fail = "✗";
  const info = "·";
  const check = (passed: boolean) => (passed ? ok : fail);
  const line = (mark: string, label: string, detail?: string) => {
    const labelCol = label.padEnd(28);
    console.log(`  ${mark}  ${labelCol}${detail ? `  ${detail}` : ""}`);
  };

  console.log("Samsung Health MCP · Doctor");
  console.log(`Status: ${status.ok ? `READY ${ok}` : `NEEDS EXPORT ${fail}`}`);
  if (status.client) console.log(`Client: ${status.client}`);
  console.log("");
  console.log("Checks");
  line(check(status.node.supported), "Node.js >=20", status.node.supported ? undefined : `version ${status.node.version}`);
  line(check(status.export.exists), "Export path", status.export.exists ? `${status.export.kind} at ${status.export.resolved_path}` : "missing");
  line(info, "Privacy mode", status.config.privacy_mode);
  if (status.client_checks?.hermes) {
    const hermes = status.client_checks.hermes;
    console.log("");
    console.log("Hermes");
    line(info, "config path", hermes.config_path);
    line(check(hermes.samsung_health_server_configured), "configured");
    line(check(hermes.package_pinned), "pinned package");
    line(check(hermes.skill_installed), "skill", hermes.skill_installed ? hermes.skill_path : "missing");
  }
  console.log("");
  console.log("Next steps");
  status.next_steps.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
}

function printHelp(): void {
  console.log(`Samsung Health MCP Server

Usage:
  samsung-health-mcp-server                                Start MCP stdio server
  samsung-health-mcp-server --http                         Start local HTTP MCP server
  samsung-health-mcp-server setup --export-path <path>     Save local CSV/ZIP/folder export path and client config
  samsung-health-mcp-server setup --import <path>          Copy export into managed local storage
  samsung-health-mcp-server setup --auto-import            Find latest local export and copy it into managed storage
  samsung-health-mcp-server setup --timezone <iana>        Save local-day timezone for daily/weekly summaries
  samsung-health-mcp-server setup --client hermes          Save Hermes config and skill
  samsung-health-mcp-server doctor                         Check setup and next steps
  samsung-health-mcp-server doctor --client hermes --json  Check Hermes setup as JSON
  samsung-health-mcp-server onboarding                     Print the shared Delx Wellness onboarding flow as JSON (+ TTY summary on stderr)
  samsung-health-mcp-server onboarding --pt-BR             Onboarding flow in Brazilian Portuguese

Required data:
  SAMSUNG_HEALTH_EXPORT_PATH=/path/to/SamsungHealth
  SAMSUNG_HEALTH_TIMEZONE=America/Fortaleza

This connector reads Samsung Health personal-data CSV/ZIP exports. It does not provide live Samsung Health access.
`);
}
