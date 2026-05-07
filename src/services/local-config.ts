import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PrivacyMode } from "../types.js";

export interface LocalSamsungHealthConfig {
  SAMSUNG_HEALTH_EXPORT_PATH?: string;
  SAMSUNG_HEALTH_PRIVACY_MODE?: PrivacyMode;
  SAMSUNG_HEALTH_TIMEZONE?: string;
  SAMSUNG_HEALTH_LAST_IMPORT_AT?: string;
  SAMSUNG_HEALTH_LAST_IMPORT_SOURCE_PATH?: string;
}

export function localConfigPath(homeDir = homedir()): string {
  return join(homeDir, ".samsung-health-mcp", "config.json");
}

export function readLocalConfig(homeDir = homedir()): LocalSamsungHealthConfig {
  const path = localConfigPath(homeDir);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LocalSamsungHealthConfig;
  } catch {
    return {};
  }
}

export function writeLocalConfig(config: LocalSamsungHealthConfig, homeDir = homedir()): string {
  const path = localConfigPath(homeDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}
