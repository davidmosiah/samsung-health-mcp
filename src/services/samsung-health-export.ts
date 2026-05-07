import { promises as fs } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import yauzl from "yauzl";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";
import type { SamsungHealthRecord, SamsungHealthWorkout } from "../types.js";
import { parseFlexibleDate } from "./time.js";

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
  } catch {
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

  await parseExportEntities(location, {
    onRecord(record) {
      if (query.type && record.type !== query.type) return false;
      if (!overlaps(record.startDate, record.endDate, start, end)) return false;
      records.push(record);
      return records.length >= limit;
    }
  });

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
  });

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
  });

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
      if (!Number.isNaN(parsed.getTime())) return parsed;
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

async function parseExportEntities(location: ExportLocation, visitor: EntityVisitor): Promise<void> {
  const sources = await readCsvSources(location);
  let stopped = false;
  for (const source of sources) {
    if (stopped) break;
    const rows = parseCsv(source.text);
    for (const row of rows) {
      if (stopped) break;
      const workout = rowToWorkout(source.name, row);
      if (workout) {
        stopped = visitor.onWorkout?.(workout) ?? false;
        continue;
      }
      const record = rowToRecord(source.name, row);
      if (record) stopped = visitor.onRecord?.(record) ?? false;
    }
  }
}

function rowToRecord(sourceName: string, row: CsvRow): SamsungHealthRecord | undefined {
  const normalizedFile = normalizeKey(sourceName);
  const type = inferRecordType(normalizedFile, row);
  if (!type) return undefined;

  const startDate = bestDate(row, DATE_KEYS.start);
  const endDate = bestDate(row, DATE_KEYS.end) ?? startDate;
  const creationDate = bestDate(row, DATE_KEYS.created);
  const metric = metricForRecord(type, normalizedFile, row, startDate, endDate);
  if (metric.value === undefined && !startDate && !endDate) return undefined;
  const textValue = type === "samsung_health_sleep" || type === "samsung_health_sleep_stage"
    ? readString(row, ["sleep_stage", "stage", "sleep_status", "status", "value"]) ?? String(metric.value ?? "")
    : metric.value === undefined ? undefined : String(metric.value);

  return {
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

function rowToWorkout(sourceName: string, row: CsvRow): SamsungHealthWorkout | undefined {
  const normalizedFile = normalizeKey(sourceName);
  if (!normalizedFile.includes("exercise") && !normalizedFile.includes("workout")) return undefined;
  const startDate = bestDate(row, DATE_KEYS.start);
  const endDate = bestDate(row, DATE_KEYS.end) ?? startDate;
  const duration = durationMinutes(row, startDate, endDate);
  const distance = readNumber(row, ["distance", "total_distance", "distance_meter", "distance_m", "distance_km"]);
  const energy = readNumber(row, ["calorie", "calories", "calorie_count", "kcal", "total_calorie", "active_calorie"]);
  const workoutActivityType = readString(row, ["exercise_type", "exercise_name", "activity_type", "workout_type", "type", "name"]) ?? "exercise";
  if (!startDate && duration === undefined && distance === undefined && energy === undefined) return undefined;

  return {
    workoutActivityType,
    sourceName: inferSourceName(row) ?? sourceName,
    creationDate: bestDate(row, DATE_KEYS.created),
    startDate,
    endDate,
    duration,
    durationUnit: duration === undefined ? undefined : "min",
    totalDistance: normalizeDistance(distance, row),
    totalDistanceUnit: distance === undefined ? undefined : "km",
    totalEnergyBurned: energy,
    totalEnergyBurnedUnit: energy === undefined ? undefined : "kcal",
    metadata: buildMetadata(row, sourceName)
  };
}

function inferRecordType(normalizedFile: string, row: CsvRow): string | undefined {
  const rowKeys = Object.keys(row).map(normalizeKey).join(" ");
  const haystack = `${normalizedFile} ${rowKeys}`;
  if (haystack.includes("step")) return "samsung_health_steps";
  if (haystack.includes("sleep_stage")) return "samsung_health_sleep_stage";
  if (haystack.includes("sleep")) return "samsung_health_sleep";
  if (haystack.includes("resting_heart")) return "samsung_health_resting_heart_rate";
  if (haystack.includes("hrv") || haystack.includes("heart_rate_variability")) return "samsung_health_hrv";
  if (haystack.includes("heart_rate") || haystack.includes("heartrate")) return "samsung_health_heart_rate";
  if (haystack.includes("oxygen") || haystack.includes("spo2") || haystack.includes("saturation")) return "samsung_health_oxygen_saturation";
  if (haystack.includes("respiratory")) return "samsung_health_respiratory_rate";
  if (haystack.includes("weight") || haystack.includes("body_weight")) return "samsung_health_body_weight";
  if (haystack.includes("body_fat")) return "samsung_health_body_fat";
  if (haystack.includes("distance")) return "samsung_health_distance";
  if (haystack.includes("calorie") || haystack.includes("energy")) return "samsung_health_active_energy";
  if (Object.keys(row).length > 0 && normalizedFile.includes("samsung")) return `samsung_health_${safeTypeFromFile(normalizedFile)}`;
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
      return { value: readNumber(row, ["respiratory_rate", "breathing_rate", "value"]), unit: "breaths/min" };
    case "samsung_health_body_weight":
      return { value: readNumber(row, ["weight", "body_weight", "value"]), unit: readString(row, ["unit"]) ?? "kg" };
    case "samsung_health_body_fat":
      return { value: readNumber(row, ["body_fat", "body_fat_percentage", "fat", "value"]), unit: "%" };
    case "samsung_health_distance":
      return { value: normalizeDistance(readNumber(row, ["distance", "distance_meter", "distance_m", "distance_km", "value"]), row), unit: "km" };
    case "samsung_health_active_energy":
      return { value: readNumber(row, ["calorie", "calories", "calorie_count", "kcal", "value"]), unit: "kcal" };
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

async function readCsvSources(location: ExportLocation): Promise<CsvSource[]> {
  if (location.kind === "csv" && location.resolved_path) {
    return [{
      name: basename(location.resolved_path),
      text: await fs.readFile(location.resolved_path, "utf8"),
      size_bytes: location.size_bytes,
      modified_at: location.modified_at
    }];
  }
  if (location.kind === "directory" && location.resolved_path) return readDirectoryCsvSources(location.resolved_path);
  if (location.kind === "zip" && location.resolved_path) return readZipCsvSources(location.resolved_path);
  throw new Error(location.note ?? "Unsupported Samsung Health export location.");
}

async function readDirectoryCsvSources(root: string): Promise<CsvSource[]> {
  const files = await listCsvFiles(root);
  return Promise.all(files.map(async (file) => {
    const stat = await fs.stat(file);
    return {
      name: file.slice(root.length + 1),
      text: await fs.readFile(file, "utf8"),
      size_bytes: stat.size,
      modified_at: stat.mtime.toISOString()
    };
  }));
}

function readZipCsvSources(zipPath: string): Promise<CsvSource[]> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipfile) => {
      if (openError || !zipfile) {
        reject(openError ?? new Error("Unable to open Samsung Health export zip."));
        return;
      }
      const sources: CsvSource[] = [];
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        const name = entry.fileName.replace(/\\/g, "/");
        if (!name.toLowerCase().endsWith(".csv") || /\/$/.test(name)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zipfile.close();
            reject(streamError ?? new Error(`Unable to read ${name} from zip.`));
            return;
          }
          streamToString(stream).then((text) => {
            sources.push({ name, text, size_bytes: entry.uncompressedSize });
            zipfile.readEntry();
          }, (error) => {
            zipfile.close();
            reject(error);
          });
        });
      });
      zipfile.on("end", () => {
        zipfile.close();
        resolvePromise(sources.sort((left, right) => left.name.localeCompare(right.name)));
      });
      zipfile.on("error", reject);
    });
  });
}

async function countCsvFiles(root: string): Promise<number> {
  return (await listCsvFiles(root)).length;
}

async function listCsvFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) files.push(fullPath);
    }
  }
  await visit(root, 0);
  return files.sort();
}

function countZipCsvEntries(zipPath: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipfile) => {
      if (openError || !zipfile) {
        reject(openError ?? new Error("Unable to open Samsung Health export zip."));
        return;
      }
      let count = 0;
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        const name = entry.fileName.replace(/\\/g, "/").toLowerCase();
        if (name.endsWith(".csv") && !name.endsWith("/")) count += 1;
        zipfile.readEntry();
      });
      zipfile.on("end", () => {
        zipfile.close();
        resolvePromise(count);
      });
      zipfile.on("error", reject);
    });
  });
}

function parseCsv(text: string): CsvRow[] {
  const trimmed = text.replace(/^\uFEFF/, "");
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
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
      row.push(field.trim());
      field = "";
    } else if (char === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field.trim());
  rows.push(row);

  const headerRow = rows.find((candidate) => candidate.some(Boolean));
  if (!headerRow) return [];
  const headerIndex = rows.indexOf(headerRow);
  const headers = headerRow.map((value, index) => value || `column_${index + 1}`);
  return rows.slice(headerIndex + 1)
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function detectDelimiter(line: string): "," | ";" | "\t" {
  const counts = {
    ",": (line.match(/,/g) ?? []).length,
    ";": (line.match(/;/g) ?? []).length,
    "\t": (line.match(/\t/g) ?? []).length
  };
  return Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] as "," | ";" | "\t" ?? ",";
}

function bestDate(row: CsvRow, aliases: string[]): string | undefined {
  const value = readString(row, aliases);
  const parsed = parseSamsungDate(value);
  return parsed?.toISOString();
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
  return Object.entries(row).find(([key, value]) => {
    if (!value?.trim()) return false;
    const normalized = normalizeKey(key);
    return normalizedAliases.some((alias) => normalized === alias || normalized.endsWith(`_${alias}`) || normalized.includes(alias));
  });
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
  const explicit = readNumber(row, ["duration", "duration_ms", "duration_millis", "elapsed_time", "sleep_duration", "time"]);
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
  if (unit?.includes("meter") || unit === "m" || value > 100) return round(value / 1000);
  return round(value);
}

function inferSourceName(row: CsvRow): string | undefined {
  return readString(row, ["source", "source_name", "device", "device_name", "pkg_name", "package_name"]);
}

function buildMetadata(row: CsvRow, sourceName: string): Record<string, string> {
  const metadata: Record<string, string> = { source_file: sourceName };
  for (const [key, value] of Object.entries(row)) {
    if (!value) continue;
    metadata[key] = value;
  }
  return metadata;
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

function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
  });
}

function round(value: number | undefined): number | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  return Math.round(value * 100) / 100;
}
