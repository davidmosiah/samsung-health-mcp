import { createHash } from "node:crypto";
import { promises as fs, createReadStream } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { ExportBudget, ExportBudgetError, readBoundedText, type ExportReadLimits } from "./export-budget.js";
import yauzl from "yauzl";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";
import type { SamsungHealthRecord, SamsungHealthWorkout } from "../types.js";
import { samsungDayDate } from "./samsung-day-date.js";
import { sanitizeMetadata } from "./privacy.js";
import { parseFlexibleDate } from "./time.js";
import {
  getLastParsedAt,
  invalidateIfExportChanged,
  loadCache,
  saveCache
} from "./incremental-cache.js";

export interface ExportLocation {
  input_path?: string;
  resolved_path?: string;
  exists: boolean;
  kind: "missing" | "csv" | "directory" | "zip" | "unsupported";
  size_bytes?: number;
  modified_at?: string;
  mtime_ms?: number;
  csv_count?: number;
  note?: string;
}

export interface RecordQuery {
  exportPath?: string;
  type?: string;
  start?: string;
  end?: string;
  limit?: number;
  /**
   * When true, skip records older than the per-category last-parsed timestamp
   * in the incremental cache and persist the newest seen timestamp back. The
   * cache auto-invalidates when the export file mtime changes.
   */
  useIncrementalCache?: boolean;
}

export interface WorkoutQuery {
  exportPath?: string;
  start?: string;
  end?: string;
  limit?: number;
}

export interface SnapshotQuery {
  exportPath?: string;
  start?: string;
  end?: string;
}

export interface SamsungHealthSnapshot {
  source: "samsung_health_export";
  generated_at: string;
  location: ExportLocation;
  range: {
    start?: string;
    end?: string;
  };
  cache: {
    key: string;
    hit: boolean;
  };
  records: SamsungHealthRecord[];
  workouts: SamsungHealthWorkout[];
}

interface CsvSource {
  name: string;
  text: string;
  size_bytes?: number;
  modified_at?: string;
}

interface EntityVisitor {
  onRecord?: (record: SamsungHealthRecord) => boolean;
  onWorkout?: (workout: SamsungHealthWorkout) => boolean;
}

type CsvRow = Record<string, string>;

const SNAPSHOT_CACHE = new Map<string, SamsungHealthSnapshot>();
const MAX_SNAPSHOT_CACHE_ENTRIES = 6;
const MIN_SAMSUNG_HEALTH_TIMESTAMP_MS = Date.UTC(2000, 0, 1);

const DATE_KEYS = {
  start: ["start_time", "starttime", "start_date", "startdate", "start", "from_time", "from", "day_time", "record_time", "measurement_time", "timestamp", "date"],
  end: ["end_time", "endtime", "end_date", "enddate", "end", "to_time", "to"],
  created: ["create_time", "created_time", "creation_time", "update_time", "updated_time", "modify_time", "modified_time"]
};

export async function inspectExportLocation(inputPath?: string): Promise<ExportLocation> {
  if (!inputPath) {
    return {
      exists: false,
      kind: "missing",
      note: "Set SAMSUNG_HEALTH_EXPORT_PATH or run setup with --export-path."
    };
  }

  const resolvedPath = resolve(inputPath.replace(/^~/, process.env.HOME ?? ""));
  try {
    const stat = await fs.stat(resolvedPath);
    if (stat.isDirectory()) {
      const csvCount = await countCsvFiles(resolvedPath);
      return {
        input_path: inputPath,
        resolved_path: resolvedPath,
        exists: csvCount > 0,
        kind: "directory",
        size_bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
        mtime_ms: stat.mtimeMs,
        csv_count: csvCount,
        note: csvCount > 0 ? undefined : "Directory exists, but no Samsung Health CSV files were found."
      };
    }
    if (stat.isFile() && extname(resolvedPath).toLowerCase() === ".csv") {
      return {
        input_path: inputPath,
        resolved_path: resolvedPath,
        exists: true,
        kind: "csv",
        size_bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
        mtime_ms: stat.mtimeMs,
        csv_count: 1
      };
    }
    if (stat.isFile() && extname(resolvedPath).toLowerCase() === ".zip") {
      const csvCount = await countZipCsvEntries(resolvedPath);
      return {
        input_path: inputPath,
        resolved_path: resolvedPath,
        exists: csvCount > 0,
        kind: "zip",
        size_bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
        mtime_ms: stat.mtimeMs,
        csv_count: csvCount,
        note: csvCount > 0 ? "Will read Samsung Health CSV files from the zip." : "Zip exists, but no CSV files were found."
      };
    }
    return {
      input_path: inputPath,
      resolved_path: resolvedPath,
      exists: false,
      kind: "unsupported",
      size_bytes: stat.size,
      note: "Expected a Samsung Health export directory, .csv file, or .zip file containing CSVs."
    };
  } catch (error) {
    if (error instanceof ExportBudgetError) throw error;
    return {
      input_path: inputPath,
      resolved_path: resolvedPath,
      exists: false,
      kind: "missing",
      note: "Path does not exist."
    };
  }
}

export async function listRecords(query: RecordQuery): Promise<SamsungHealthRecord[]> {
  const limit = normalizeLimit(query.limit);
  const location = await inspectExportLocation(query.exportPath);
  if (!location.exists) throw new Error(location.note ?? "Samsung Health export not found.");
  const start = query.start ? parseSamsungDate(query.start) : undefined;
  const end = query.end ? parseSamsungDate(query.end) : undefined;
  const records: SamsungHealthRecord[] = [];

  let incrementalCutoff: Date | undefined;
  let useIncremental = false;
  const cachePath = location.resolved_path ?? location.input_path;
  if (query.useIncrementalCache && query.type && cachePath) {
    useIncremental = true;
    await invalidateIfExportChanged(cachePath, location.mtime_ms);
    const cached = await getLastParsedAt(query.type);
    if (cached) {
      const parsed = parseSamsungDate(cached);
      if (parsed) incrementalCutoff = parsed;
    }
  }

  let newestSeenMs = 0;
  await parseExportEntities(location, {
    onRecord(record) {
      if (query.type && record.type !== query.type) return false;
      if (!overlaps(record.startDate, record.endDate, start, end)) return false;
      if (incrementalCutoff) {
        const recordStart = parseSamsungDate(record.startDate);
        if (recordStart && recordStart <= incrementalCutoff) return false;
      }
      if (useIncremental) {
        const ts = parseSamsungDate(record.startDate);
        if (ts && ts.getTime() > newestSeenMs) newestSeenMs = ts.getTime();
      }
      records.push(record);
      return records.length >= limit;
    }
  }, { start, end });

  if (useIncremental && query.type && newestSeenMs > 0 && cachePath) {
    const cache = await loadCache();
    cache.export_path = cachePath;
    cache.export_mtime_ms = location.mtime_ms;
    cache.categories[query.type] = new Date(newestSeenMs).toISOString();
    await saveCache(cache);
  }

  return records;
}

export async function listWorkouts(query: WorkoutQuery): Promise<SamsungHealthWorkout[]> {
  const limit = normalizeLimit(query.limit);
  const location = await inspectExportLocation(query.exportPath);
  if (!location.exists) throw new Error(location.note ?? "Samsung Health export not found.");
  const start = query.start ? parseSamsungDate(query.start) : undefined;
  const end = query.end ? parseSamsungDate(query.end) : undefined;
  const workouts: SamsungHealthWorkout[] = [];

  await parseExportEntities(location, {
    onWorkout(workout) {
      if (!overlaps(workout.startDate, workout.endDate, start, end)) return false;
      workouts.push(workout);
      return workouts.length >= limit;
    }
  }, { start, end });

  return workouts;
}

export async function getExportSnapshot(query: SnapshotQuery): Promise<SamsungHealthSnapshot> {
  const location = await inspectExportLocation(query.exportPath);
  if (!location.exists) throw new Error(location.note ?? "Samsung Health export not found.");
  const start = query.start ? parseSamsungDate(query.start) : undefined;
  const end = query.end ? parseSamsungDate(query.end) : undefined;
  const key = snapshotCacheKey(location, query);
  const cached = SNAPSHOT_CACHE.get(key);
  if (cached) return { ...cached, cache: { ...cached.cache, hit: true } };

  const records: SamsungHealthRecord[] = [];
  const workouts: SamsungHealthWorkout[] = [];
  await parseExportEntities(location, {
    onRecord(record) {
      if (!overlaps(record.startDate, record.endDate, start, end)) return false;
      records.push(record);
      return false;
    },
    onWorkout(workout) {
      if (!overlaps(workout.startDate, workout.endDate, start, end)) return false;
      workouts.push(workout);
      return false;
    }
  }, { start, end });

  const snapshot: SamsungHealthSnapshot = {
    source: "samsung_health_export",
    generated_at: new Date().toISOString(),
    location,
    range: {
      start: query.start,
      end: query.end
    },
    cache: {
      key,
      hit: false
    },
    records,
    workouts
  };
  cacheSnapshot(key, snapshot);
  return snapshot;
}

export function parseSamsungDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      const parsed = new Date(milliseconds);
      // Samsung's numeric identifiers and schema versions can otherwise look
      // like Unix timestamps from the 1970s when a column alias is missing.
      if (!Number.isNaN(parsed.getTime()) && milliseconds >= MIN_SAMSUNG_HEALTH_TIMESTAMP_MS) return parsed;
    }
  }
  const compact = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(trimmed);
  if (compact) {
    const parsed = new Date(Date.UTC(
      Number(compact[1]),
      Number(compact[2]) - 1,
      Number(compact[3]),
      Number(compact[4] ?? 0),
      Number(compact[5] ?? 0),
      Number(compact[6] ?? 0)
    ));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return parseFlexibleDate(trimmed);
}

export function recordOverlaps(startValue: string | undefined, endValue: string | undefined, start?: Date, end?: Date): boolean {
  return overlaps(startValue, endValue, start, end);
}

/**
 * How far outside the requested range a row is still allowed to be by the
 * cheap pre-filter. The pre-filter reads raw column text and ignores the
 * per-row `time_offset`, so it must never be the thing that decides a row is
 * out of range — it only skips rows that cannot be relevant under any
 * timezone. `overlaps` still makes the real decision on what survives.
 */
const RANGE_PREFILTER_SLACK_MS = 48 * 60 * 60 * 1000;

async function parseExportEntities(
  location: ExportLocation,
  visitor: EntityVisitor,
  range?: { start?: Date; end?: Date }
): Promise<void> {
  const sources = await readCsvSources(location);
  const parseBudget = new ExportBudget();
  const seenExerciseRecords = new Set<string>();
  const slackStart = range?.start ? range.start.getTime() - RANGE_PREFILTER_SLACK_MS : undefined;
  const slackEnd = range?.end ? range.end.getTime() + RANGE_PREFILTER_SLACK_MS : undefined;
  const prefiltering = slackStart !== undefined || slackEnd !== undefined;
  let stopped = false;
  for (const source of sources) {
    if (stopped) break;
    const table = parseCsvTable(source.text, parseBudget);
    if (!table.headers.length) continue;
    // Resolve the date columns once per file rather than once per row:
    // findEntry walks every column of every row, which is most of the parse
    // cost on a minute-level table like sleep_stage or heart_rate.
    const startIndex = prefiltering ? dateColumnIndex(table.headers, DATE_KEYS.start) : -1;
    const endIndex = prefiltering ? dateColumnIndex(table.headers, DATE_KEYS.end) : -1;
    for (const values of table.rows) {
      if (stopped) break;
      if (prefiltering && startIndex >= 0 && !rowNearRange(values, startIndex, endIndex, slackStart, slackEnd)) continue;
      const row = toCsvRow(table.headers, values);
      const workout = rowToWorkout(source.name, row);
      if (workout) {
        const identity = exactSamsungExerciseIdentity(source.name, row);
        if (identity && seenExerciseRecords.has(identity)) continue;
        if (identity) seenExerciseRecords.add(identity);
        stopped = visitor.onWorkout?.(workout) ?? false;
        continue;
      }
      const record = rowToRecord(source.name, row);
      if (record) stopped = visitor.onRecord?.(record) ?? false;
      // Only Samsung's all-device aggregate is a canonical daily distance.
      if (record && !stopped && samsungDataTypeFromFile(normalizeKey(basename(source.name))) === "step_daily_trend"
          && readNumber(row, ["source_type"]) === -2) {
        const meters = readNumber(row, ["distance"]);
        if (meters !== undefined) {
          const km = round(meters / 1000);
          stopped = visitor.onRecord?.({ ...record, type: "samsung_health_distance", unit: "km", value: String(km), numeric_value: km }) ?? false;
        }
      }
    }
  }
}

/**
 * Index of the header `findEntry`/`bestDate` would pick for `aliases`.
 * Exact alias wins; among suffix matches the shortest key wins, matching
 * `findEntry`. Picking a different column than `bestDate` can drop an
 * in-range row when a long prefixed date is years away from a short one.
 */
function dateColumnIndex(headers: string[], aliases: string[]): number {
  const normalizedAliases = aliases.map(normalizeKey);
  const normalizedHeaders = headers.map(normalizeKey);
  for (const alias of normalizedAliases) {
    const exact = normalizedHeaders.indexOf(alias);
    if (exact >= 0) return exact;
    const suffix = normalizedHeaders
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => header.endsWith(`_${alias}`))
      .sort((left, right) => left.header.length - right.header.length)[0];
    if (suffix) return suffix.index;
  }
  return -1;
}

/**
 * Cheap "could this row possibly be in range?" test on raw column text.
 * Returns true whenever it cannot tell, so a missing or unparseable date
 * always falls through to the full row handling.
 */
function rowNearRange(
  values: string[],
  startIndex: number,
  endIndex: number,
  slackStart?: number,
  slackEnd?: number
): boolean {
  const startText = values[startIndex];
  if (!startText) return true;
  const rowStart = parseSamsungDate(startText);
  if (!rowStart) return true;
  const endText = endIndex >= 0 ? values[endIndex] : undefined;
  const rowEnd = (endText ? parseSamsungDate(endText) : undefined) ?? rowStart;
  if (slackEnd !== undefined && rowStart.getTime() > slackEnd) return false;
  if (slackStart !== undefined && rowEnd.getTime() < slackStart) return false;
  return true;
}

function rowToRecord(sourceName: string, row: CsvRow): SamsungHealthRecord | undefined {
  const normalizedFile = normalizeKey(basename(sourceName));
  const type = inferRecordType(normalizedFile, row);
  if (!type) return undefined;

  const samsungSource = samsungDataTypeFromFile(normalizeKey(basename(sourceName))) !== undefined;
  const startDate = bestDate(row, DATE_KEYS.start, samsungSource);
  const endDate = bestDate(row, DATE_KEYS.end, samsungSource) ?? startDate;
  const creationDate = bestDate(row, DATE_KEYS.created, samsungSource);
  const calendarDate = ["step_daily_trend", "calories_burned_details"].includes(samsungDataTypeFromFile(normalizedFile) ?? "") && !readString(row, ["start_time"])
    ? samsungDayDate(readString(row, ["day_time"])) : undefined;
  const metric = metricForRecord(type, normalizedFile, row, startDate, endDate);
  if (metric.value === undefined && !startDate && !endDate) return undefined;
  const textValue = type === "samsung_health_sleep" || type === "samsung_health_sleep_stage"
    ? readString(row, ["sleep_stage", "stage", "sleep_status", "status", "value"]) ?? String(metric.value ?? "")
    : metric.value === undefined ? undefined : String(metric.value);

  return {
    ...(calendarDate ? { calendarDate } : {}),
    type,
    sourceName: inferSourceName(row) ?? sourceName,
    unit: metric.unit,
    value: textValue,
    numeric_value: metric.value,
    creationDate,
    startDate,
    endDate,
    metadata: buildMetadata(row, sourceName)
  };
}

/** Deduplicate only an identical record with an explicit record ID, never a device ID or temporal overlap. */
function exactSamsungExerciseIdentity(sourceName: string, row: CsvRow): string | undefined {
  if (samsungDataTypeFromFile(normalizeKey(basename(sourceName))) !== "exercise") return undefined;
  const identityKeys = new Set(["uuid", "datauuid", "com_samsung_health_exercise_uuid", "com_samsung_health_exercise_datauuid", "com_samsung_shealth_exercise_uuid", "com_samsung_shealth_exercise_datauuid"]);
  const identities = Object.entries(row).filter(([key, value]) => identityKeys.has(normalizeKey(key)) && value.trim()).map(([, value]) => value.trim());
  if (!identities.length || new Set(identities).size !== 1 || !/^[A-Za-z0-9_-]{10,36}$/.test(identities[0])) return undefined;
  // Compare unrounded source fields, not lossy normalized output. File names are
  // excluded so exact copies of a record across export files still collapse.
  const payload = Object.entries(row).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  // Private, per-parse fingerprint: raw identifiers are never added to metadata or output.
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function rowToWorkout(sourceName: string, row: CsvRow): SamsungHealthWorkout | undefined {
  if (!isWorkoutSource(sourceName)) return undefined;
  const samsungSource = samsungDataTypeFromFile(normalizeKey(basename(sourceName))) !== undefined;
  const startDate = bestDate(row, DATE_KEYS.start, samsungSource);
  const endDate = bestDate(row, DATE_KEYS.end, samsungSource) ?? startDate;
  const samsungExercise = samsungDataTypeFromFile(normalizeKey(basename(sourceName))) === "exercise";
  const milliseconds = samsungExercise ? readNumber(row, ["duration"]) : undefined;
  const duration = milliseconds !== undefined ? round(milliseconds / 60_000) : durationMinutes(row, startDate, endDate);
  const distance = readNumber(row, ["distance", "total_distance", "distance_meter", "distance_m", "distance_km"]);
  const energy = readNumber(row, ["calorie", "calories", "calorie_count", "kcal", "total_calorie", "active_calorie"]);
  const workoutActivityType = readString(row, ["exercise_type", "exercise_name", "activity_type", "workout_type", "type", "name"]) ?? "exercise";
  if (!startDate && duration === undefined && distance === undefined && energy === undefined) return undefined;

  return {
    workoutActivityType,
    sourceName: inferSourceName(row) ?? sourceName,
    creationDate: bestDate(row, DATE_KEYS.created, samsungSource),
    startDate,
    endDate,
    duration,
    durationUnit: duration === undefined ? undefined : "min",
    totalDistance: samsungExercise && !readString(row, ["distance_unit", "unit"])
      ? (distance === undefined ? undefined : round(distance / 1000)) : normalizeDistance(distance, row),
    totalDistanceUnit: distance === undefined ? undefined : "km",
    totalEnergyBurned: energy,
    totalEnergyBurnedUnit: energy === undefined ? undefined : "kcal",
    metadata: buildMetadata(row, sourceName)
  };
}

function inferRecordType(normalizedFile: string, row: CsvRow): string | undefined {
  const rowKeys = Object.keys(row).map(normalizeKey).join(" ");
  const samsungType = samsungDataTypeFromFile(normalizedFile);
  if (samsungType) {
    // Exercise sidecars (route, location, weather, recovery heart rate, and
    // similar tables) describe a workout but are not standalone health
    // records. The main exercise CSV is handled by rowToWorkout above.
    if (samsungType.startsWith("exercise_")) return undefined;
    if (samsungType === "step_daily_trend") {
      const sourceType = readNumber(row, ["source_type"]);
      return sourceType === undefined || sourceType === -2
        ? "samsung_health_steps"
        : "samsung_health_step_daily_trend_source";
    }
    if (samsungType === "step_count") return "samsung_health_steps";
    if (samsungType.startsWith("tracker_pedometer_")) return `samsung_health_${samsungType}`;
    if (samsungType === "sleep_stage") return "samsung_health_sleep_stage";
    if (samsungType === "sleep") return "samsung_health_sleep";
    if (samsungType === "resting_heart_rate") return "samsung_health_resting_heart_rate";
    if (samsungType === "hrv" || samsungType === "heart_rate_variability") return "samsung_health_hrv";
    if (samsungType === "heart_rate" || samsungType === "tracker_heart_rate") return "samsung_health_heart_rate";
    if (samsungType === "oxygen_saturation" || samsungType === "tracker_oxygen_saturation") return "samsung_health_oxygen_saturation";
    if (samsungType === "respiratory_rate") return "samsung_health_respiratory_rate";
    if (samsungType === "weight" || samsungType === "body_weight") return "samsung_health_body_weight";
    if (samsungType === "calories_burned_details") return readNumber(row, ["active_calorie"]) === undefined ? undefined : "samsung_health_active_energy";
    if (samsungType === "body_fat") return "samsung_health_body_fat";
    if (samsungType === "distance") return "samsung_health_distance";
    if (samsungType === "calorie" || samsungType === "calories" || samsungType === "active_energy") return "samsung_health_active_energy";
    return `samsung_health_${samsungType}`;
  }
  const haystack = `${normalizedFile} ${rowKeys}`;
  // A Samsung export can contain a daily total, raw pedometer samples, a day
  // summary and recommendation rows at the same time. Only the daily trend is
  // a canonical step total; treating every file containing "step" as steps
  // makes daily summaries count the same activity multiple times.
  if (normalizedFile.includes("step_daily_trend")) return "samsung_health_steps";
  if (normalizedFile.includes("pedometer_")) return `samsung_health_${safeTypeFromFile(normalizedFile)}`;
  // The file name names the data type; column names only describe fields that
  // table happens to carry. Matching both in one pass lets a sibling column
  // outvote the file itself: com.samsung.shealth.tracker.oxygen_saturation
  // carries a heart_rate column and was classified as heart rate. Try the file
  // name alone first, and fall back to column names only when it says nothing.
  const byFileName = matchRecordType(normalizedFile);
  if (byFileName) return byFileName;
  const byColumns = matchRecordType(haystack);
  if (byColumns) return byColumns;
  if (Object.keys(row).length > 0 && normalizedFile.includes("samsung")) return `samsung_health_${safeTypeFromFile(normalizedFile)}`;
  return undefined;
}

/**
 * Ordered keyword match, shared by the file-name pass and the column-name
 * fallback of `inferRecordType`. Order matters: the more specific keyword of
 * an overlapping pair goes first, so `sleep_stage` is not swallowed by
 * `sleep`, `hrv` not by `heart_rate`, and `oxygen_saturation` not by the
 * `heart_rate` column that ships alongside it.
 */
function matchRecordType(haystack: string): string | undefined {
  if (haystack.includes("sleep_stage")) return "samsung_health_sleep_stage";
  if (haystack.includes("sleep")) return "samsung_health_sleep";
  if (haystack.includes("step")) return "samsung_health_steps";
  if (haystack.includes("resting_heart")) return "samsung_health_resting_heart_rate";
  if (haystack.includes("hrv") || haystack.includes("heart_rate_variability")) return "samsung_health_hrv";
  if (haystack.includes("oxygen") || haystack.includes("spo2") || haystack.includes("saturation")) return "samsung_health_oxygen_saturation";
  if (haystack.includes("heart_rate") || haystack.includes("heartrate")) return "samsung_health_heart_rate";
  if (haystack.includes("respiratory")) return "samsung_health_respiratory_rate";
  if (haystack.includes("weight") || haystack.includes("body_weight")) return "samsung_health_body_weight";
  if (haystack.includes("body_fat")) return "samsung_health_body_fat";
  if (haystack.includes("distance")) return "samsung_health_distance";
  if (haystack.includes("calorie") || haystack.includes("energy")) return "samsung_health_active_energy";
  return undefined;
}

function metricForRecord(type: string, normalizedFile: string, row: CsvRow, startDate?: string, endDate?: string): { value?: number; unit?: string } {
  switch (type) {
    case "samsung_health_steps":
      return { value: readNumber(row, ["count", "step_count", "steps", "value"]), unit: "count" };
    case "samsung_health_heart_rate":
      return { value: readNumber(row, ["heart_rate", "bpm", "rate", "value"]), unit: "bpm" };
    case "samsung_health_resting_heart_rate":
      return { value: readNumber(row, ["resting_heart_rate", "resting_hr", "heart_rate", "bpm", "value"]), unit: "bpm" };
    case "samsung_health_hrv":
      return { value: readNumber(row, ["hrv", "rmssd", "sdnn", "value"]), unit: "ms" };
    case "samsung_health_oxygen_saturation":
      return { value: readNumber(row, ["spo2", "oxygen_saturation", "saturation", "value"]), unit: "%" };
    case "samsung_health_respiratory_rate":
      return { value: readNumber(row, ["respiratory_rate", "breathing_rate", "average", "value"]), unit: "breaths/min" };
    case "samsung_health_body_weight":
      return { value: readNumber(row, ["weight", "body_weight", "value"]), unit: readString(row, ["unit"]) ?? "kg" };
    case "samsung_health_body_fat":
      return { value: readNumber(row, ["body_fat", "body_fat_percentage", "fat", "value"]), unit: "%" };
    case "samsung_health_distance":
      return { value: normalizeDistance(readNumber(row, ["distance", "distance_meter", "distance_m", "distance_km", "value"]), row), unit: "km" };
    case "samsung_health_active_energy":
      return { value: readNumber(row, samsungDataTypeFromFile(normalizedFile) === "calories_burned_details"
        ? ["active_calorie"] : ["calorie", "calories", "calorie_count", "kcal", "value"]), unit: "kcal" };
    case "samsung_health_sleep":
    case "samsung_health_sleep_stage":
      return { value: durationMinutes(row, startDate, endDate), unit: "min" };
    default:
      return { value: firstUsefulNumber(row), unit: readString(row, ["unit"]) ?? normalizedFile };
  }
}

function overlaps(startValue: string | undefined, endValue: string | undefined, start?: Date, end?: Date): boolean {
  if (!start && !end) return true;
  const itemStart = parseSamsungDate(startValue);
  const itemEnd = parseSamsungDate(endValue) ?? itemStart;
  if (!itemStart && !itemEnd) return false;
  if (start && itemEnd && itemEnd < start) return false;
  if (end && itemStart && itemStart > end) return false;
  return true;
}

function normalizeLimit(value: number | undefined): number {
  if (!value || Number.isNaN(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

/** Exported for small-limit integration fixtures; MCP handlers use fixed defaults. */
export async function readCsvSources(location: ExportLocation, limits?: ExportReadLimits): Promise<CsvSource[]> {
  const budget = new ExportBudget(limits);
  if (location.kind === "csv" && location.resolved_path) {
    budget.entry();
    const stat = await fs.stat(location.resolved_path);
    budget.file(stat.size);
    return [{ name: basename(location.resolved_path), text: await readBoundedText(createReadStream(location.resolved_path), budget), size_bytes: stat.size, modified_at: location.modified_at }];
  }
  if (location.kind === "directory" && location.resolved_path) {
    const files = await listCsvFiles(location.resolved_path, budget);
    const sources: CsvSource[] = [];
    // Sequential reads avoid one pending full-file buffer per directory entry.
    for (const file of files) {
      const stat = await fs.stat(file);
      budget.file(stat.size);
      sources.push({ name: file.slice(location.resolved_path.length + 1), text: await readBoundedText(createReadStream(file), budget), size_bytes: stat.size, modified_at: stat.mtime.toISOString() });
    }
    return sources;
  }
  if (location.kind === "zip" && location.resolved_path) return visitZipCsv(location.resolved_path, budget, true);
  throw new Error(location.note ?? "Unsupported Samsung Health export location.");
}

function visitZipCsv(zipPath: string, budget: ExportBudget, read: boolean): Promise<CsvSource[]> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (openError, zipfile) => {
      if (openError || !zipfile) { reject(openError ?? new Error("Unable to open Samsung Health export zip.")); return; }
      const sources: CsvSource[] = [];
      let settled = false;
      let activeStream: Readable | undefined;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        activeStream?.destroy(error instanceof Error ? error : new Error("Samsung export read failed."));
        zipfile.close();
        reject(error);
      };
      zipfile.on("error", fail);
      zipfile.on("entry", (entry) => {
        if (settled) return;
        try {
          budget.entry(); // Includes ignored sidecars: metadata enumeration is bounded.
          if (!entry.fileName.toLowerCase().endsWith(".csv") || entry.fileName.endsWith("/")) { zipfile.readEntry(); return; }
          budget.file(entry.uncompressedSize);
          if (!read) { sources.push({ name: entry.fileName, text: "", size_bytes: entry.uncompressedSize }); zipfile.readEntry(); return; }
          zipfile.openReadStream(entry, (error, stream) => {
            if (error || !stream) { fail(error ?? new Error("Unable to read Samsung export zip entry.")); return; }
            if (settled) { stream.destroy(); return; }
            activeStream = stream;
            readBoundedText(stream, budget).then((text) => {
              activeStream = undefined;
              if (settled) return;
              sources.push({ name: entry.fileName, text, size_bytes: entry.uncompressedSize });
              zipfile.readEntry();
            }, fail);
          });
        } catch (error) { fail(error); }
      });
      zipfile.on("end", () => {
        if (settled) return;
        settled = true;
        zipfile.close();
        resolvePromise(sources.sort((left, right) => left.name.localeCompare(right.name)));
      });
      zipfile.readEntry();
    });
  });
}

async function countCsvFiles(root: string): Promise<number> { return (await listCsvFiles(root, new ExportBudget())).length; }

async function listCsvFiles(root: string, budget: ExportBudget): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 6) return;
    // opendir avoids allocating a complete unbounded readdir array first.
    const entries = await fs.opendir(directory);
    for await (const entry of entries) {
      budget.entry();
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) files.push(fullPath);
    }
  }
  await visit(root, 0);
  return files.sort();
}

async function countZipCsvEntries(zipPath: string): Promise<number> {
  return (await visitZipCsv(zipPath, new ExportBudget(), false)).length;
}

function parseCsv(text: string): CsvRow[] {
  const table = parseCsvTable(text);
  return table.rows.map((values) => toCsvRow(table.headers, values));
}

/**
 * Builds a row object from a header list and one raw value row. Split out of
 * `parseCsvTable` so a caller that only needs a couple of columns to decide
 * whether a row is in range can skip materializing the whole object.
 */
function toCsvRow(headers: string[], values: string[]): CsvRow {
  const row: CsvRow = {};
  for (let index = 0; index < headers.length; index += 1) row[headers[index]] = values[index] ?? "";
  return row;
}

interface CsvTable {
  headers: string[];
  rows: string[][];
}

export function parseCsvTable(text: string, budget = new ExportBudget()): CsvTable {
  const trimmed = text.replace(/^\uFEFF/, "");
  const sampleLines = trimmed.split(/\r?\n/, 5).filter(Boolean);
  const delimiter = sampleLines
    .map((line) => { const counts = delimiterCounts(line); return { delimiter: detectDelimiter(line), separators: Math.max(...Object.values(counts)) }; })
    .sort((left, right) => right.separators - left.separators)[0]?.delimiter ?? ",";
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    const next = trimmed[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === delimiter) {
      budget.cell();
      row.push(field.trim());
      field = "";
    } else if (char === "\n") {
      budget.cell();
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  budget.cell();
  row.push(field.trim());
  rows.push(row);

  const firstNonEmptyIndex = rows.findIndex((candidate) => candidate.some(Boolean));
  if (firstNonEmptyIndex < 0) return { headers: [], rows: [] };
  const firstNonEmptyRow = rows[firstNonEmptyIndex];
  // Samsung Health exports written by recent app versions start each CSV with
  // a data-type/version preamble, for example:
  //   com.samsung.shealth.step_daily_trend,7006003,6.30.2
  // The actual column names are on the following non-empty row.
  const headerRow = isSamsungExportPreamble(firstNonEmptyRow)
    ? rows.slice(firstNonEmptyIndex + 1).find((candidate) => candidate.some(Boolean))
    : firstNonEmptyRow;
  if (!headerRow) return { headers: [], rows: [] };
  const headerIndex = rows.indexOf(headerRow);
  const headers = headerRow.map((value, index) => value || `column_${index + 1}`);
  return { headers, rows: rows.slice(headerIndex + 1).filter((values) => values.some(Boolean)) };
}

function isSamsungExportPreamble(row: string[]): boolean {
  return row.length >= 3
    && /^com\.samsung\.(?:shealth|health)\./i.test(row[0]?.trim() ?? "")
    && /^\d+$/.test(row[1]?.trim() ?? "")
    && /^\d+(?:\.\d+)*$/.test(row[2]?.trim() ?? "");
}

function isWorkoutSource(sourceName: string): boolean {
  const fileName = basename(sourceName);
  if (/^com\.samsung\.(?:shealth|health)\.exercise(?:\.\d+)?\.csv$/i.test(fileName)) return true;
  return /(?:^|[._-])workouts?(?:[._-]|$)/i.test(fileName);
}

function delimiterCounts(line: string): Record<"," | ";" | "\t", number> {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const char of line) if (char === "," || char === ";" || char === "\t") counts[char] += 1;
  return counts;
}

function detectDelimiter(line: string): "," | ";" | "\t" {
  const counts = delimiterCounts(line);
  return Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] as "," | ";" | "\t" ?? ",";
}

function bestDate(row: CsvRow, aliases: string[], samsungSource = false): string | undefined {
  const value = readString(row, aliases);
  const parsed = parseSamsungDate(samsungSource ? value : combineDateAndOffset(value, readString(row, ["time_offset"])));
  return parsed?.toISOString();
}

function combineDateAndOffset(value: string | undefined, offset: string | undefined): string | undefined {
  if (!value || !offset) return value;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed) || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) return value;
  const match = /^UTC([+-])(\d{2}):?(\d{2})?$/i.exec(offset.trim());
  if (!match) return value;
  const isoBase = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  return `${isoBase}${match[1]}${match[2]}:${match[3] ?? "00"}`;
}

function readString(row: CsvRow, aliases: string[]): string | undefined {
  const entry = findEntry(row, aliases);
  const value = entry?.[1]?.trim();
  return value ? value : undefined;
}

function readNumber(row: CsvRow, aliases: string[]): number | undefined {
  const value = readString(row, aliases);
  return parseNumber(value);
}

function findEntry(row: CsvRow, aliases: string[]): [string, string] | undefined {
  const normalizedAliases = aliases.map(normalizeKey);
  const entries = Object.entries(row).filter(([, value]) => value?.trim());
  for (const alias of normalizedAliases) {
    const exact = entries.find(([key]) => normalizeKey(key) === alias);
    if (exact) return exact;
    const suffix = entries
      .filter(([key]) => normalizeKey(key).endsWith(`_${alias}`))
      .sort(([left], [right]) => normalizeKey(left).length - normalizeKey(right).length)[0];
    if (suffix) return suffix;
  }
  return undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized || /^(null|nan|none|unknown)$/i.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstUsefulNumber(row: CsvRow): number | undefined {
  for (const [key, value] of Object.entries(row)) {
    if (DATE_KEYS.start.concat(DATE_KEYS.end, DATE_KEYS.created).some((alias) => normalizeKey(key).includes(alias))) continue;
    const parsed = parseNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function durationMinutes(row: CsvRow, startDate?: string, endDate?: string): number | undefined {
  const explicit = readNumber(row, ["duration", "duration_ms", "duration_millis", "elapsed_time", "sleep_duration"]);
  if (explicit !== undefined) {
    if (explicit > 100_000) return round(explicit / 60_000);
    if (explicit > 1_000) return round(explicit / 60);
    return round(explicit);
  }
  const start = parseSamsungDate(startDate);
  const end = parseSamsungDate(endDate);
  if (!start || !end) return undefined;
  return round(Math.max(0, end.getTime() - start.getTime()) / 60_000);
}

function normalizeDistance(value: number | undefined, row: CsvRow): number | undefined {
  if (value === undefined) return undefined;
  const unit = readString(row, ["distance_unit", "unit"])?.toLowerCase();
  if (unit?.includes("mile")) return round(value * 1.609344);
  if (unit === "km" || unit?.includes("kilometer")) return round(value);
  if (unit?.includes("meter") || unit === "m" || value > 100) return round(value / 1000);
  return round(value);
}

/**
 * Columns that identify a device or a row rather than naming a data source.
 * `deviceuuid` matches the `device` alias below, so without this guard a stable
 * hardware identifier was promoted into `sourceName` and shipped in raw mode.
 */
const IDENTIFIER_KEY_PATTERN = /uuid|(^|_)id$|serial|imei|mac_address/;

function inferSourceName(row: CsvRow): string | undefined {
  const named = Object.fromEntries(
    Object.entries(row).filter(([key]) => !IDENTIFIER_KEY_PATTERN.test(normalizeKey(key)))
  );
  return readString(named, ["source", "source_name", "device", "device_name", "pkg_name", "package_name"]);
}

/**
 * Build record/workout metadata from a CSV row. Columns are allowlisted by
 * `sanitizeMetadata`, so geolocation, hardware identifiers and free-text user
 * fields never enter the parsed snapshot — not even for `privacy_mode: "raw"`.
 */
function buildMetadata(row: CsvRow, sourceName: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!value) continue;
    metadata[key] = value;
  }
  return { source_file: sourceName, ...sanitizeMetadata(metadata) };
}

function safeTypeFromFile(normalizedFile: string): string {
  return normalizedFile
    .replace(/^.*com_samsung_(shealth|health)_?/, "")
    .replace(/_csv$/, "")
    .split("_")
    .filter(Boolean)
    .slice(0, 4)
    .join("_") || "record";
}

function samsungDataTypeFromFile(normalizedFile: string): string | undefined {
  const match = /^com_samsung_(?:shealth|health)_(.+?)(?:_\d{6,})?$/.exec(normalizedFile);
  return match?.[1];
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.csv$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function snapshotCacheKey(location: ExportLocation, query: SnapshotQuery): string {
  return [
    location.resolved_path ?? location.input_path ?? "unknown",
    location.size_bytes ?? 0,
    location.mtime_ms ?? 0,
    location.csv_count ?? 0,
    query.start ?? "",
    query.end ?? ""
  ].join("|");
}

function cacheSnapshot(key: string, snapshot: SamsungHealthSnapshot): void {
  SNAPSHOT_CACHE.set(key, snapshot);
  while (SNAPSHOT_CACHE.size > MAX_SNAPSHOT_CACHE_ENTRIES) {
    const oldest = SNAPSHOT_CACHE.keys().next().value;
    if (!oldest) break;
    SNAPSHOT_CACHE.delete(oldest);
  }
}

/**
 * Drop the in-memory snapshot cache so the next summary/inventory call re-parses
 * the export from disk. Call this after a reimport/promotion of a fresh export so
 * long-running transports (HTTP) immediately reflect the new data. Stdio one-shot
 * processes do not need this, but it is harmless there.
 */
export function clearSnapshotCache(): void {
  SNAPSHOT_CACHE.clear();
}

function round(value: number | undefined): number | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  return Math.round(value * 100) / 100;
}
