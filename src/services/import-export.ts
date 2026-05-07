import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
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
  const location = await inspectExportLocation(sourcePath);
  if (!location.exists) throw new Error(location.note ?? "Samsung Health export not found.");
  const importedAt = new Date().toISOString();
  const exportsDir = join(homeDir, ".samsung-health-mcp", "exports");
  mkdirSync(exportsDir, { recursive: true, mode: 0o700 });
  const stamp = importedAt.replace(/[-:]/g, "").replace(/\..+/, "Z");
  const extension = location.kind === "zip" ? ".zip" : location.kind === "csv" ? ".csv" : "";
  const destination = join(exportsDir, `samsung-health-export-${stamp}${extension}`);
  const source = location.resolved_path;
  if (!source) throw new Error("Samsung Health export source could not be resolved.");
  if (location.kind === "directory") cpSync(source, destination, { recursive: true, filter: (sourcePath) => !sourcePath.includes("node_modules") });
  else copyFileSync(source, destination);
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
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      if (/samsung.?health/i.test(entry.name) || hasCsvFiles(fullPath)) {
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

function hasCsvFiles(path: string): boolean {
  try {
    return readdirSync(path, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"));
  } catch {
    return false;
  }
}

function chmodRecursive(path: string): void {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      chmodRecursive(join(path, entry.name));
    }
    return;
  }
  chmodSync(path, 0o600);
}

function candidate(path: string, baseScore: number): DiscoveredExport {
  let size_bytes: number | undefined;
  let modified_at: string | undefined;
  try {
    const stat = statSync(path);
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
