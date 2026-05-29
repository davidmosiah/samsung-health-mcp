/**
 * Watch-folder auto-reimport for the local Samsung Health export.
 *
 * Samsung Health is a manual export: the user opens Samsung Health -> Settings ->
 * Download personal data on a Galaxy phone and drops the resulting folder of CSV
 * files (sometimes packaged as a zip) somewhere on disk. Without a watch folder
 * this connector only ever reads a single fixed path, so a fresh export is
 * invisible until the user re-runs `setup`.
 *
 * The watch folder turns that into a recurring workflow: point the connector at
 * a directory (via `SAMSUNG_HEALTH_WATCH_PATH`, local config, or
 * `setup --watch-path <dir>`). Whenever a newer Samsung Health export shows up in
 * that folder, `reconcileWatchFolder` promotes it to be the active export
 * (`SAMSUNG_HEALTH_EXPORT_PATH`), drops the in-memory snapshot cache, and
 * invalidates the incremental cache so the next summary call reflects the new
 * data. Reconciliation is poll-on-demand (cheap, just a directory stat scan) and
 * is also exposed as the `samsung_health_reimport` MCP tool for an explicit
 * manual re-scan.
 *
 * This is the cross-platform path. The native Android Health Connect bridge
 * (live, no manual export) genuinely needs an Android device and is out of scope
 * here.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { clearSnapshotCache, inspectExportLocation, type ExportLocation } from "./samsung-health-export.js";
import { getConfig } from "./config.js";
import { clearCache } from "./incremental-cache.js";
import { mergeLocalConfig } from "./local-config.js";

const MAX_SCAN_DEPTH = 2;

export interface WatchCandidate {
  /** The path that would be set as SAMSUNG_HEALTH_EXPORT_PATH. */
  path: string;
  resolved_path?: string;
  kind: ExportLocation["kind"];
  size_bytes?: number;
  modified_at?: string;
  mtime_ms?: number;
  csv_count?: number;
}

export type ReconcileReason =
  | "no_watch_folder"
  | "watch_folder_missing"
  | "no_export_in_folder"
  | "already_current"
  | "promoted_new_export"
  | "promoted_updated_export";

export interface ReconcileResult {
  changed: boolean;
  reason: ReconcileReason;
  watch_path?: string;
  /** Export that is active after reconciliation (may be unchanged). */
  active_export_path?: string;
  /** The newest export found in the watch folder, if any. */
  candidate?: WatchCandidate;
  /** Path that was active before this reconcile run. */
  previous_export_path?: string;
  message: string;
  reimported_at?: string;
}

/**
 * Resolve a watch folder path (expanding a leading `~`). Returns undefined when
 * no watch folder is configured.
 */
export function resolveWatchPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = homedir()
): string | undefined {
  const config = getConfig(env, homeDir);
  if (!config.watchPath) return undefined;
  return resolve(config.watchPath.replace(/^~/, env.HOME ?? homeDir));
}

/**
 * Scan the watch folder for the freshest Samsung Health export. Supports the
 * same shapes as `inspectExportLocation`: a SamsungHealth export directory of
 * CSV files, a single `*.csv`, or a `*samsung*health*.zip`. The newest by file
 * mtime wins.
 */
export async function findLatestExportInFolder(watchPath: string): Promise<WatchCandidate | undefined> {
  if (!existsSync(watchPath)) return undefined;
  const rawCandidatePaths: string[] = [];
  collectCandidatePaths(watchPath, 0, rawCandidatePaths);

  const verified: WatchCandidate[] = [];
  for (const candidatePath of rawCandidatePaths) {
    const location = await inspectExportLocation(candidatePath);
    if (!location.exists) continue;
    verified.push({
      path: candidatePath,
      resolved_path: location.resolved_path,
      kind: location.kind,
      size_bytes: location.size_bytes,
      modified_at: location.modified_at,
      mtime_ms: location.mtime_ms,
      csv_count: location.csv_count
    });
  }

  return verified.sort((left, right) => (right.mtime_ms ?? 0) - (left.mtime_ms ?? 0))[0];
}

function collectCandidatePaths(path: string, depth: number, out: string[]): void {
  if (depth > MAX_SCAN_DEPTH) return;
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      // A SamsungHealth export folder, or any directory that directly holds CSVs.
      if (/samsung.?health/i.test(entry.name) || hasCsvFiles(fullPath)) out.push(fullPath);
      collectCandidatePaths(fullPath, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".csv") && lower.includes("samsung")) out.push(fullPath);
    else if (lower.includes("samsung") && lower.includes("health") && extname(lower) === ".zip") out.push(fullPath);
  }
  // Also treat the watch folder itself as a candidate if it directly holds CSVs
  // (e.g. the user points the watch folder straight at an unpacked export dir).
  if (depth === 0 && hasCsvFiles(path)) out.push(path);
}

function hasCsvFiles(path: string): boolean {
  try {
    return readdirSync(path, { withFileTypes: true }).some(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv")
    );
  } catch {
    return false;
  }
}

/**
 * Check the watch folder for a newer export than the currently-active one and,
 * if found, promote it: persist the new `SAMSUNG_HEALTH_EXPORT_PATH`, record the
 * reimport in local config, clear the in-memory snapshot cache, and invalidate
 * the incremental cache. Idempotent — running it again with no folder change
 * reports `already_current`.
 *
 * `force` re-promotes the newest folder export even when it already matches the
 * active path (used by the manual reimport tool to guarantee a cache refresh).
 */
export async function reconcileWatchFolder(
  options: { env?: NodeJS.ProcessEnv; homeDir?: string; force?: boolean } = {}
): Promise<ReconcileResult> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const config = getConfig(env, homeDir);
  const previousExportPath = config.exportPath;

  if (!config.watchPath) {
    return {
      changed: false,
      reason: "no_watch_folder",
      active_export_path: previousExportPath,
      previous_export_path: previousExportPath,
      message: "No watch folder configured. Set SAMSUNG_HEALTH_WATCH_PATH or run `setup --watch-path <dir>`."
    };
  }

  const watchPath = resolveWatchPath(env, homeDir);
  if (!watchPath || !existsSync(watchPath)) {
    return {
      changed: false,
      reason: "watch_folder_missing",
      watch_path: config.watchPath,
      active_export_path: previousExportPath,
      previous_export_path: previousExportPath,
      message: `Watch folder does not exist: ${config.watchPath}. Create it or update SAMSUNG_HEALTH_WATCH_PATH.`
    };
  }

  const candidate = await findLatestExportInFolder(watchPath);
  if (!candidate) {
    return {
      changed: false,
      reason: "no_export_in_folder",
      watch_path: watchPath,
      active_export_path: previousExportPath,
      previous_export_path: previousExportPath,
      message: `No Samsung Health export (SamsungHealth folder, *.csv, or *samsung*health*.zip) found in ${watchPath}.`
    };
  }

  const activeLocation = await inspectExportLocation(previousExportPath);
  const samePath =
    activeLocation.resolved_path !== undefined &&
    candidate.resolved_path !== undefined &&
    activeLocation.resolved_path === candidate.resolved_path;
  const candidateIsNewer = (candidate.mtime_ms ?? 0) > (activeLocation.mtime_ms ?? 0);

  const shouldPromote = options.force || !activeLocation.exists || !samePath || candidateIsNewer;
  if (!shouldPromote) {
    return {
      changed: false,
      reason: "already_current",
      watch_path: watchPath,
      active_export_path: previousExportPath,
      previous_export_path: previousExportPath,
      candidate,
      message: `Active export already matches the newest export in the watch folder (${candidate.path}).`
    };
  }

  const reimportedAt = new Date().toISOString();
  mergeLocalConfig(
    {
      SAMSUNG_HEALTH_EXPORT_PATH: candidate.path,
      SAMSUNG_HEALTH_LAST_WATCH_IMPORT_PATH: candidate.path,
      SAMSUNG_HEALTH_LAST_WATCH_IMPORT_AT: reimportedAt
    },
    homeDir
  );

  // Refresh derived state so summaries reflect the new export immediately.
  clearSnapshotCache();
  await clearCache(homeDir);

  const reason: ReconcileReason = !activeLocation.exists || !samePath ? "promoted_new_export" : "promoted_updated_export";
  return {
    changed: true,
    reason,
    watch_path: watchPath,
    active_export_path: candidate.path,
    previous_export_path: previousExportPath,
    candidate,
    reimported_at: reimportedAt,
    message:
      reason === "promoted_new_export"
        ? `Promoted new Samsung Health export from watch folder: ${candidate.path}. Summaries now reflect this export.`
        : `Re-imported updated Samsung Health export: ${candidate.path}. Summaries refreshed.`
  };
}

/**
 * Lightweight, read-only view of the watch-folder configuration and the newest
 * export currently sitting in it. Used by connection-status and the reimport
 * tool. Does not mutate any state.
 */
export interface WatchStatus {
  configured: boolean;
  watch_path?: string;
  watch_path_exists: boolean;
  latest_export?: WatchCandidate;
  active_export_path?: string;
  active_export_is_latest?: boolean;
  last_watch_import_at?: string;
  last_watch_import_path?: string;
}

export async function getWatchStatus(
  options: { env?: NodeJS.ProcessEnv; homeDir?: string } = {}
): Promise<WatchStatus> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const config = getConfig(env, homeDir);
  if (!config.watchPath) {
    return {
      configured: false,
      watch_path_exists: false,
      active_export_path: config.exportPath,
      last_watch_import_at: config.lastWatchImportAt,
      last_watch_import_path: config.lastWatchImportPath
    };
  }
  const watchPath = resolveWatchPath(env, homeDir);
  const exists = Boolean(watchPath && existsSync(watchPath));
  const latest = exists && watchPath ? await findLatestExportInFolder(watchPath) : undefined;
  let activeIsLatest: boolean | undefined;
  if (latest) {
    const activeLocation = await inspectExportLocation(config.exportPath);
    activeIsLatest =
      activeLocation.exists &&
      activeLocation.resolved_path === latest.resolved_path &&
      (activeLocation.mtime_ms ?? 0) >= (latest.mtime_ms ?? 0);
  }
  return {
    configured: true,
    watch_path: watchPath,
    watch_path_exists: exists,
    latest_export: latest,
    active_export_path: config.exportPath,
    active_export_is_latest: activeIsLatest,
    last_watch_import_at: config.lastWatchImportAt,
    last_watch_import_path: config.lastWatchImportPath
  };
}
