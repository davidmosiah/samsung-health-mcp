import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { NPM_PACKAGE_NAME, PINNED_NPM_PACKAGE } from "../constants.js";
import { hermesConfigSnippet, hermesSkillMarkdown, parseAgentClientName, type AgentClientName } from "../services/agent-manifest.js";
import { discoverLatestExport, importSamsungHealthExport, type ImportResult } from "../services/import-export.js";
import { writeLocalConfig } from "../services/local-config.js";
import { parsePrivacyMode } from "../services/config.js";

interface SetupOptions {
  client: AgentClientName;
  exportPath?: string;
  importData: boolean;
  autoImport: boolean;
  privacyMode: "summary" | "structured" | "raw";
  timezone?: string;
  json: boolean;
  homeDir: string;
}

export async function runSetupCommand(args: string[]): Promise<number> {
  const options = parseSetupOptions(args);
  let exportPath = options.exportPath;
  let importResult: ImportResult | undefined;
  if (options.autoImport && !exportPath) {
    const discovered = await discoverLatestExport(options.homeDir);
    if (!discovered) throw new Error("No Samsung Health export was found in Downloads, Desktop or Documents. Transfer export.zip to this machine or pass --export-path.");
    exportPath = discovered.path;
  }
  if (options.importData) {
    if (!exportPath) throw new Error("Use --import <path>, --auto-import, or --export-path <path> with --import.");
    importResult = await importSamsungHealthExport(exportPath, options.homeDir);
    exportPath = importResult.imported_path;
  }
  const configPath = writeLocalConfig({
    SAMSUNG_HEALTH_EXPORT_PATH: exportPath,
    SAMSUNG_HEALTH_PRIVACY_MODE: options.privacyMode,
    SAMSUNG_HEALTH_TIMEZONE: options.timezone,
    SAMSUNG_HEALTH_LAST_IMPORT_AT: importResult?.imported_at,
    SAMSUNG_HEALTH_LAST_IMPORT_SOURCE_PATH: importResult?.source_path
  }, options.homeDir);
  const clientConfig = writeClientConfig(options.client, options.homeDir);
  const output = {
    ok: true,
    config_path: configPath,
    client: options.client,
    export_path: exportPath,
    timezone: options.timezone,
    import: importResult,
    client_config_path: clientConfig.path,
    hermes_skill_path: clientConfig.hermes_skill_path,
    hermes_config_backup_path: clientConfig.hermes_config_backup_path,
    warnings: clientConfig.warnings,
    next_step: options.client === "hermes"
      ? "Run `samsung-health-mcp-server doctor --client hermes`, then use `/reload-mcp` or `hermes mcp test samsung_health`."
      : "Run `samsung-health-mcp-server doctor`."
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log("Samsung Health MCP · Setup");
    console.log("");
    console.log(`  ✓  Local config       ${configPath}`);
    if (exportPath) console.log(`  ✓  Export path        ${exportPath}`);
    if (importResult) console.log(`  ✓  Imported export    ${importResult.imported_path}`);
    if (options.timezone) console.log(`  ✓  Timezone           ${options.timezone}`);
    console.log(`  ✓  MCP client config  ${clientConfig.path}`);
    if (clientConfig.hermes_skill_path) console.log(`  ✓  Hermes skill       ${clientConfig.hermes_skill_path}`);
    console.log("");
    console.log(`→ Next: ${output.next_step}`);
  }
  return 0;
}

function parseSetupOptions(args: string[]): SetupOptions {
  const flags = parseFlags(args);
  const importFlag = flags.get("import");
  const importPath = importFlag && importFlag !== "true" ? importFlag : undefined;
  return {
    client: parseAgentClientName(flags.get("client")),
    exportPath: flags.get("export-path") ?? importPath,
    importData: flags.has("import") || flags.has("auto-import"),
    autoImport: flags.has("auto-import"),
    privacyMode: parsePrivacyMode(flags.get("privacy-mode")) as "summary" | "structured" | "raw",
    timezone: flags.get("timezone") ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    json: flags.has("json"),
    homeDir: flags.get("home-dir") ?? homedir()
  };
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) flags.set(name, "true");
    else {
      flags.set(name, next);
      index += 1;
    }
  }
  return flags;
}

interface ClientConfigResult {
  path: string;
  hermes_skill_path?: string;
  hermes_config_backup_path?: string;
  warnings?: string[];
}

function writeClientConfig(client: AgentClientName, homeDir: string): ClientConfigResult {
  if (client === "hermes") return writeHermesClientConfig(homeDir);
  const path = client === "claude"
    ? join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json")
    : join(homeDir, ".samsung-health-mcp", "mcp-configs", `${client}.json`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(mcpConfigSnippet(), null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { path };
}

function mcpConfigSnippet() {
  return {
    mcpServers: {
      samsung_health: {
        command: "npx",
        args: ["-y", NPM_PACKAGE_NAME]
      }
    }
  };
}

function writeHermesClientConfig(homeDir: string): ClientConfigResult {
  const configPath = join(homeDir, ".hermes", "config.yaml");
  const skillPath = join(homeDir, ".hermes", "skills", "samsung-health-mcp", "SKILL.md");
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(skillPath), { recursive: true, mode: 0o700 });

  const backupPath = mergeHermesConfig(configPath);
  writeFileSync(skillPath, `${hermesSkillMarkdown()}\n`, { mode: 0o600 });
  chmodSync(skillPath, 0o600);
  return {
    path: configPath,
    hermes_skill_path: skillPath,
    hermes_config_backup_path: backupPath,
    warnings: [
      "After editing Hermes MCP config, use `/reload-mcp` or `hermes mcp test samsung_health`; do not restart the Hermes gateway for normal Samsung Health export access.",
      `Hermes config pins ${PINNED_NPM_PACKAGE} to avoid stale npx cache behavior.`
    ]
  };
}

function mergeHermesConfig(configPath: string): string | undefined {
  const snippet = hermesConfigSnippet();
  if (!existsSync(configPath)) {
    writeFileSync(configPath, `${snippet}\n`, { mode: 0o600 });
    chmodSync(configPath, 0o600);
    return undefined;
  }

  const existing = readFileSync(configPath, "utf8");
  if (/samsung-health-mcp-unofficial|samsung-health-mcp-server|samsung-health-mcp/.test(existing) && /^\s*samsung_health\s*:/m.test(existing)) {
    if (existing.includes(PINNED_NPM_PACKAGE)) return undefined;
    const backupPath = backupConfig(configPath);
    const updated = existing.replace(/samsung-health-mcp-unofficial(?:@\d+\.\d+\.\d+)?/g, PINNED_NPM_PACKAGE);
    writeFileSync(configPath, ensureReloadHint(updated), { mode: 0o600 });
    chmodSync(configPath, 0o600);
    return backupPath;
  }

  const backupPath = backupConfig(configPath);
  const next = existing.trimEnd().length ? addHermesBlock(existing) : snippet;
  writeFileSync(configPath, ensureReloadHint(next), { mode: 0o600 });
  chmodSync(configPath, 0o600);
  return backupPath;
}

function addHermesBlock(existing: string): string {
  const serverBlock = [
    "  samsung_health:",
    "    command: npx",
    "    args:",
    "      - -y",
    `      - ${PINNED_NPM_PACKAGE}`
  ].join("\n");
  const trimmed = existing.trimEnd();
  if (/^mcp_servers:\s*$/m.test(trimmed)) {
    return `${trimmed.replace(/^mcp_servers:\s*$/m, `mcp_servers:\n${serverBlock}`)}\n`;
  }
  return `${trimmed}\n\n# Added by ${NPM_PACKAGE_NAME} setup.\nmcp_servers:\n${serverBlock}\n`;
}

function backupConfig(path: string): string {
  const backupPath = `${path}.bak-samsung-health-mcp-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z")}`;
  renameSync(path, backupPath);
  chmodSync(backupPath, 0o600);
  writeFileSync(path, readFileSync(backupPath, "utf8"), { mode: 0o600 });
  chmodSync(path, 0o600);
  return backupPath;
}

function ensureReloadHint(text: string): string {
  if (/mcp_reload_confirm\s*:\s*false/.test(text)) return text.endsWith("\n") ? text : `${text}\n`;
  if (/^approvals:\s*$/m.test(text)) return `${text.trimEnd()}\n  mcp_reload_confirm: false\n`;
  return `${text.trimEnd()}\n\napprovals:\n  mcp_reload_confirm: false\n`;
}
