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
  /** Folder watched for new Samsung Health exports (auto-reimport source). */
  SAMSUNG_HEALTH_WATCH_PATH?: string;
  /** Path of the export most recently promoted from the watch folder. */
  SAMSUNG_HEALTH_LAST_WATCH_IMPORT_PATH?: string;
  /** ISO timestamp of the last successful watch-folder reimport. */
  SAMSUNG_HEALTH_LAST_WATCH_IMPORT_AT?: string;
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

/**
 * Merge a partial patch into the existing local config, preserving any
 * unrelated fields already on disk. `undefined` values in the patch are
 * ignored so callers can pass a sparse update without clobbering state.
 */
export function mergeLocalConfig(patch: Partial<LocalSamsungHealthConfig>, homeDir = homedir()): string {
  const existing = readLocalConfig(homeDir);
  const next: LocalSamsungHealthConfig = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return writeLocalConfig(next, homeDir);
}
