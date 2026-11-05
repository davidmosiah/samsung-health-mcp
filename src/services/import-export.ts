import { chmodSync, constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { inspectExportLocation } from "./samsung-health-export.js";

export interface ImportResult {
  imported_path: string;
  source_path: string;
  source_kind: string;
  size_bytes?: number;
  imported_at: string;
}

export interface DiscoveredExport {
  path: string;
  kind: string;
  size_bytes?: number;
  modified_at?: string;
  score: number;
}

export async function importSamsungHealthExport(sourcePath: string, homeDir: string): Promise<ImportResult> {
  const source = resolve(sourcePath.replace(/^~/, process.env.HOME ?? homeDir));
  // Preflight before reading/copying the export or changing any permissions.
  // These checks reject existing links/special files, not concurrent path swaps.
  assertSafePath(source);
  assertSafeTree(source);
  const exportsDir = resolve(homeDir, ".samsung-health-mcp", "exports");
  assertSafePath(exportsDir, true);
  const location = await inspectExportLocation(source);
  if (!location.exists) throw new Error(location.note ?? "Samsung Health export not found.");
  const importedAt = new Date().toISOString();
  mkdirSync(exportsDir, { recursive: true, mode: 0o700 });
  const stamp = importedAt.replace(/[-:]/g, "").replace(/\..+/, "Z");
  const extension = location.kind === "zip" ? ".zip" : location.kind === "csv" ? ".csv" : "";
  const destination = join(exportsDir, `samsung-health-export-${stamp}-${randomUUID()}${extension}`);
  if (location.kind === "directory") cpSync(source, destination, { recursive: true, dereference: false, force: false, errorOnExist: true, filter: (sourcePath) => !sourcePath.includes("node_modules") });
  else copyFileSync(source, destination, constants.COPYFILE_EXCL);
  assertSafeTree(destination);
  chmodRecursive(destination);
  return {
    imported_path: destination,
    source_path: sourcePath,
    source_kind: location.kind,
    size_bytes: location.size_bytes,
    imported_at: importedAt
  };
}

export async function discoverLatestExport(homeDir: string): Promise<DiscoveredExport | undefined> {
  const roots = [
    join(homeDir, "Downloads"),
    join(homeDir, "Desktop"),
    join(homeDir, "Documents")
  ].filter((path) => existsSync(path));
  const candidates: DiscoveredExport[] = [];

  for (const root of roots) {
    scanDirectory(root, 0, candidates);
  }

  const verified: DiscoveredExport[] = [];
  for (const candidate of candidates) {
    try {
      assertSafePath(candidate.path);
      assertSafeTree(candidate.path);
    } catch {
      continue;
    }
    const location = await inspectExportLocation(candidate.path);
    if (!location.exists) continue;
    verified.push({
      ...candidate,
      kind: location.kind,
      size_bytes: location.size_bytes,
      modified_at: location.modified_at,
      score: candidate.score + (location.mtime_ms ?? 0)
    });
  }
  return verified.sort((left, right) => right.score - left.score)[0];
}

function scanDirectory(path: string, depth: number, candidates: DiscoveredExport[]): void {
  if (depth > 3) return;
  let entries;
  try {
    assertSafePath(path);
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      if (/samsung.?health/i.test(entry.name) || hasSamsungCsvFiles(fullPath)) {
        candidates.push(candidate(fullPath, 100));
      }
      scanDirectory(fullPath, depth + 1, candidates);
      continue;
    }
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".csv") && lower.includes("samsung")) candidates.push(candidate(fullPath, 80));
    else if (lower === "samsunghealth.zip" || lower === "samsung_health.zip" || lower === "samsung-health.zip") candidates.push(candidate(fullPath, 95));
    else if (lower.includes("samsung") && lower.includes("health") && extname(lower) === ".zip") candidates.push(candidate(fullPath, 90));
  }
}

function hasSamsungCsvFiles(path: string): boolean {
  try {
    return readdirSync(path, { withFileTypes: true }).some((entry) => entry.isFile() && /samsung/i.test(entry.name) && entry.name.toLowerCase().endsWith(".csv"));
  } catch {
    return false;
  }
}

function chmodRecursive(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error("Export import refuses symbolic links and special files.");
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      chmodRecursive(join(path, entry.name));
    }
    return;
  }
  chmodSync(path, 0o600);
}

/** Reject existing symlinks/special files in the selected path and its ancestors. */
function assertSafePath(path: string, allowMissing = false): void {
  const paths = [];
  for (let current = resolve(path); ; current = dirname(current)) {
    paths.unshift(current);
    if (dirname(current) === current) break;
  }
  for (const current of paths) {
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error("Export import refuses symbolic links and special files.");
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

/** Inspect the complete selected tree without following directory or file links. */
function assertSafeTree(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error("Export import refuses symbolic links and special files.");
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true })) assertSafeTree(join(path, entry.name));
  }
}

function candidate(path: string, baseScore: number): DiscoveredExport {
  let size_bytes: number | undefined;
  let modified_at: string | undefined;
  try {
    const stat = lstatSync(path);
    size_bytes = stat.isFile() ? stat.size : undefined;
    modified_at = stat.mtime.toISOString();
  } catch {
    // Verification will ignore unreadable candidates.
  }
  return {
    path,
    kind: basename(path),
    size_bytes,
    modified_at,
    score: baseScore
  };
}
