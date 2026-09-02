import { promises as fs, chmodSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Incremental import cache for Samsung Health export parsing.
 *
 * Samsung Health personal-data exports can contain thousands of CSV rows
 * spanning years; re-reading every CSV on each `samsung_health_list_records`
 * call is wasteful. This cache persists the latest parsed timestamp per
 * record category at `~/.samsung-health-mcp/incremental-cache.json`
 * (chmod 600).
 *
 * The cache is automatically invalidated when the export file/directory
 * mtime changes, which signals a fresh export from the Samsung Health app.
 */
export interface IncrementalCacheData {
  /** Parser/cache schema version used to invalidate results after upgrades. */
  schema_version?: number;
  /** Export path tracked by this cache. */
  export_path?: string;
  /** Export file/dir mtime (ms since epoch) at the time of last write. */
  export_mtime_ms?: number;
  /** ISO timestamp of when the cache was last updated. */
  updated_at?: string;
  /** Per-category last-parsed timestamps (ISO). Keyed by samsung_health_* type. */
  categories: Record<string, string>;
}

const INCREMENTAL_CACHE_SCHEMA_VERSION = 2;
const DEFAULT_CACHE: IncrementalCacheData = {
  schema_version: INCREMENTAL_CACHE_SCHEMA_VERSION,
  categories: {}
};

export function incrementalCachePath(homeDir = homedir()): string {
  return join(homeDir, ".samsung-health-mcp", "incremental-cache.json");
}

export async function loadCache(homeDir = homedir()): Promise<IncrementalCacheData> {
  const path = incrementalCachePath(homeDir);
  try {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<IncrementalCacheData>;
    return {
      schema_version: parsed.schema_version,
      export_path: parsed.export_path,
      export_mtime_ms: parsed.export_mtime_ms,
      updated_at: parsed.updated_at,
      categories: parsed.categories ?? {}
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_CACHE };
    return { ...DEFAULT_CACHE };
  }
}

export function loadCacheSync(homeDir = homedir()): IncrementalCacheData {
  const path = incrementalCachePath(homeDir);
  if (!existsSync(path)) return { ...DEFAULT_CACHE };
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<IncrementalCacheData>;
    return {
      schema_version: parsed.schema_version,
      export_path: parsed.export_path,
      export_mtime_ms: parsed.export_mtime_ms,
      updated_at: parsed.updated_at,
      categories: parsed.categories ?? {}
    };
  } catch {
    return { ...DEFAULT_CACHE };
  }
}

export async function saveCache(data: IncrementalCacheData, homeDir = homedir()): Promise<string> {
  const path = incrementalCachePath(homeDir);
  const payload: IncrementalCacheData = {
    schema_version: INCREMENTAL_CACHE_SCHEMA_VERSION,
    export_path: data.export_path,
    export_mtime_ms: data.export_mtime_ms,
    updated_at: new Date().toISOString(),
    categories: data.categories ?? {}
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export async function getLastParsedAt(category: string, homeDir = homedir()): Promise<string | null> {
  const cache = await loadCache(homeDir);
  const value = cache.categories[category];
  return value ?? null;
}

export async function setLastParsedAt(category: string, timestamp: string, homeDir = homedir()): Promise<void> {
  const cache = await loadCache(homeDir);
  cache.categories[category] = timestamp;
  await saveCache(cache, homeDir);
}

export async function clearCache(homeDir = homedir()): Promise<{ existed: boolean; path: string }> {
  const path = incrementalCachePath(homeDir);
  if (!existsSync(path)) return { existed: false, path };
  await saveCache({ categories: {} }, homeDir);
  return { existed: true, path };
}

/**
 * If the export mtime no longer matches the cached `export_mtime_ms`, the
 * cache is stale (a fresh export was generated). Returns the cleared cache
 * + a flag indicating whether invalidation occurred.
 */
export async function invalidateIfExportChanged(
  exportPath: string | undefined,
  exportMtimeMs: number | undefined,
  homeDir = homedir()
): Promise<{ invalidated: boolean; cache: IncrementalCacheData }> {
  const cache = await loadCache(homeDir);
  if (!exportPath || exportMtimeMs === undefined) return { invalidated: false, cache };

  const schemaMismatch = cache.schema_version !== INCREMENTAL_CACHE_SCHEMA_VERSION;
  const pathMismatch = cache.export_path !== undefined && cache.export_path !== exportPath;
  const mtimeMismatch = cache.export_mtime_ms !== undefined && cache.export_mtime_ms !== exportMtimeMs;
  if (schemaMismatch || pathMismatch || mtimeMismatch) {
    const fresh: IncrementalCacheData = {
      schema_version: INCREMENTAL_CACHE_SCHEMA_VERSION,
      export_path: exportPath,
      export_mtime_ms: exportMtimeMs,
      categories: {}
    };
    await saveCache(fresh, homeDir);
    return { invalidated: true, cache: fresh };
  }

  if (cache.export_path === undefined || cache.export_mtime_ms === undefined) {
    const seeded: IncrementalCacheData = {
      schema_version: INCREMENTAL_CACHE_SCHEMA_VERSION,
      export_path: exportPath,
      export_mtime_ms: exportMtimeMs,
      categories: cache.categories
    };
    await saveCache(seeded, homeDir);
    return { invalidated: false, cache: seeded };
  }

  return { invalidated: false, cache };
}

/** Summary used by connection-status. */
export interface IncrementalCacheStats {
  exists: boolean;
  path: string;
  size_bytes?: number;
  export_path?: string;
  export_mtime_ms?: number;
  updated_at?: string;
  categories: Array<{ category: string; last_parsed_at: string }>;
  category_count: number;
}

export async function getIncrementalCacheStats(homeDir = homedir()): Promise<IncrementalCacheStats> {
  const path = incrementalCachePath(homeDir);
  const exists = existsSync(path);
  let sizeBytes: number | undefined;
  if (exists) {
    try {
      sizeBytes = statSync(path).size;
    } catch {
      // ignore
    }
  }
  const cache = await loadCache(homeDir);
  const categories = Object.entries(cache.categories ?? {})
    .map(([category, last_parsed_at]) => ({ category, last_parsed_at }))
    .sort((a, b) => a.category.localeCompare(b.category));
  return {
    exists,
    path,
    size_bytes: sizeBytes,
    export_path: cache.export_path,
    export_mtime_ms: cache.export_mtime_ms,
    updated_at: cache.updated_at,
    categories,
    category_count: categories.length
  };
}
