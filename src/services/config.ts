import { homedir } from "node:os";
import type { SamsungHealthConfig, PrivacyMode } from "../types.js";
import { readLocalConfig } from "./local-config.js";

export function getConfig(env: NodeJS.ProcessEnv = process.env, homeDir = homedir()): SamsungHealthConfig {
  const local = readLocalConfig(homeDir);
  return {
    exportPath: env.SAMSUNG_HEALTH_EXPORT_PATH ?? local.SAMSUNG_HEALTH_EXPORT_PATH,
    privacyMode: parsePrivacyMode(env.SAMSUNG_HEALTH_PRIVACY_MODE ?? local.SAMSUNG_HEALTH_PRIVACY_MODE),
    timezone: env.SAMSUNG_HEALTH_TIMEZONE ?? local.SAMSUNG_HEALTH_TIMEZONE ?? process.env.TZ ?? "UTC",
    lastImportAt: local.SAMSUNG_HEALTH_LAST_IMPORT_AT,
    lastImportSourcePath: local.SAMSUNG_HEALTH_LAST_IMPORT_SOURCE_PATH
  };
}

export function parsePrivacyMode(value: string | undefined): PrivacyMode {
  if (value === "summary" || value === "structured" || value === "raw") return value;
  return "summary";
}
