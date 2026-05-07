import { REDACTED_KEY_PATTERNS } from "./redaction.js";
import { getConfig } from "./config.js";
import { localConfigPath } from "./local-config.js";

export function buildPrivacyAudit() {
  const config = getConfig();
  return {
    project: "samsung-health-mcp-unofficial",
    unofficial: true,
    local_first: true,
    data_source: "User-provided Samsung Health personal-data download CSV/ZIP",
    live_samsung_health_access: false,
    local_config_path: localConfigPath(),
    export_path_configured: Boolean(config.exportPath),
    privacy_mode_default: config.privacyMode,
    timezone: config.timezone,
    managed_import: Boolean(config.lastImportAt),
    last_import_at: config.lastImportAt,
    raw_export_opt_in: config.privacyMode === "raw",
    stdout_safe: true,
    secret_env_vars: [],
    sensitive_env_vars: ["SAMSUNG_HEALTH_EXPORT_PATH"],
    redacted_key_patterns: REDACTED_KEY_PATTERNS,
    notes: [
      "Samsung Health exports can contain sensitive health data and should stay local.",
      "Default summary privacy mode omits individual records from low-level list tools.",
      "Use setup --auto-import to copy the newest local export into ~/.samsung-health-mcp/exports with 0600 permissions.",
      "Tools return bounded records only when structured/raw mode is selected; do not paste raw CSV exports into chat.",
      "This connector is not a medical device and does not provide diagnosis or treatment."
    ]
  };
}
