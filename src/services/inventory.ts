import type { PrivacyMode } from "../types.js";
import { getExportSnapshot, parseSamsungDate } from "./samsung-health-export.js";
import { dateRange } from "./privacy.js";
import { diffDays, dateOnlyInTimezone } from "./time.js";

export async function buildDataInventory(exportPath: string | undefined, options: {
  start?: string;
  end?: string;
  timezone?: string;
  privacyMode?: PrivacyMode;
} = {}) {
  const timezone = options.timezone ?? "UTC";
  const privacyMode = options.privacyMode ?? "summary";
  const snapshot = await getExportSnapshot({ exportPath, start: options.start, end: options.end });
  const allDates = [
    ...snapshot.records.flatMap((record) => [record.startDate, record.endDate]),
    ...snapshot.workouts.flatMap((workout) => [workout.startDate, workout.endDate])
  ];
  const latestDataDate = latestDate(allDates);

  return {
    kind: "data_inventory",
    generated_at: snapshot.generated_at,
    source: snapshot.source,
    privacy_mode: privacyMode,
    timezone,
    export: {
      kind: snapshot.location.kind,
      exists: snapshot.location.exists,
      size_bytes: snapshot.location.size_bytes,
      modified_at: snapshot.location.modified_at,
      days_since_file_modified: snapshot.location.modified_at ? diffDays(new Date(snapshot.location.modified_at)) : undefined
    },
    query_range: snapshot.range,
    data_range: dateRange(allDates, timezone),
    freshness: {
      latest_data_at: latestDataDate?.toISOString(),
      latest_data_date: latestDataDate ? dateOnlyInTimezone(latestDataDate.toISOString(), timezone) : undefined,
      days_since_latest_data: latestDataDate ? diffDays(latestDataDate) : undefined
    },
    totals: {
      records: snapshot.records.length,
      workouts: snapshot.workouts.length,
      record_types: new Set(snapshot.records.map((record) => record.type)).size,
      workout_activity_types: new Set(snapshot.workouts.map((workout) => workout.workoutActivityType)).size
    },
    record_types: Object.fromEntries(
      [...snapshot.records.reduce((map, record) => {
        const item = map.get(record.type) ?? {
          count: 0,
          unit: record.unit,
          first_at: record.startDate,
          last_at: record.endDate ?? record.startDate,
          metadata_keys: new Set<string>()
        };
        item.count += 1;
        item.unit = item.unit ?? record.unit;
        item.first_at = earlier(item.first_at, record.startDate);
        item.last_at = later(item.last_at, record.endDate ?? record.startDate);
        Object.keys(record.metadata ?? {}).forEach((key) => item.metadata_keys.add(key));
        map.set(record.type, item);
        return map;
      }, new Map<string, { count: number; unit?: string; first_at?: string; last_at?: string; metadata_keys: Set<string> }>())]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([type, item]) => [type, {
          count: item.count,
          unit: item.unit,
          first_date: dateOnlyInTimezone(item.first_at, timezone),
          last_date: dateOnlyInTimezone(item.last_at, timezone),
          metadata_keys: privacyMode === "raw" ? [...item.metadata_keys].sort() : undefined
        }])
    ),
    workout_activity_types: Object.fromEntries(
      [...snapshot.workouts.reduce((map, workout) => {
        const key = workout.workoutActivityType || "unknown";
        const item = map.get(key) ?? { count: 0, first_at: workout.startDate, last_at: workout.endDate ?? workout.startDate };
        item.count += 1;
        item.first_at = earlier(item.first_at, workout.startDate);
        item.last_at = later(item.last_at, workout.endDate ?? workout.startDate);
        map.set(key, item);
        return map;
      }, new Map<string, { count: number; first_at?: string; last_at?: string }>())]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([type, item]) => [type, {
          count: item.count,
          first_date: dateOnlyInTimezone(item.first_at, timezone),
          last_date: dateOnlyInTimezone(item.last_at, timezone)
        }])
    ),
    sources: privacyMode === "raw" ? sourceCounts(snapshot.records, snapshot.workouts) : {
      record_source_count: new Set(snapshot.records.map((record) => record.sourceName).filter(Boolean)).size,
      workout_source_count: new Set(snapshot.workouts.map((workout) => workout.sourceName).filter(Boolean)).size
    },
    cache: {
      hit: snapshot.cache.hit,
      records_indexed: snapshot.records.length,
      workouts_indexed: snapshot.workouts.length
    },
    recommended_next_calls: [
      "samsung_health_daily_summary",
      "samsung_health_weekly_summary",
      "samsung_health_wellness_context"
    ]
  };
}

export function formatInventoryMarkdown(inventory: Awaited<ReturnType<typeof buildDataInventory>>): string {
  return [
    "# Samsung Health Data Inventory",
    "",
    `- **records**: ${inventory.totals.records}`,
    `- **workouts**: ${inventory.totals.workouts}`,
    `- **record_types**: ${inventory.totals.record_types}`,
    `- **data_range**: ${inventory.data_range ? `${inventory.data_range.first_date} to ${inventory.data_range.last_date}` : "unknown"}`,
    `- **latest_data_date**: ${inventory.freshness.latest_data_date ?? "unknown"}`,
    `- **cache_hit**: ${inventory.cache.hit}`
  ].join("\n");
}

function sourceCounts(records: Array<{ sourceName?: string }>, workouts: Array<{ sourceName?: string }>) {
  return {
    records: countBy(records, (record) => record.sourceName ?? "unknown"),
    workouts: countBy(workouts, (workout) => workout.sourceName ?? "unknown")
  };
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  return Object.fromEntries(
    [...items.reduce((map, item) => {
      const key = getKey(item);
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right))
  );
}

function latestDate(values: Array<string | undefined>): Date | undefined {
  return values
    .map((value) => parseSamsungDate(value))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => right.getTime() - left.getTime())[0];
}

function earlier(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  const leftDate = parseSamsungDate(left);
  const rightDate = parseSamsungDate(right);
  if (!leftDate || !rightDate) return left;
  return leftDate <= rightDate ? left : right;
}

function later(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  const leftDate = parseSamsungDate(left);
  const rightDate = parseSamsungDate(right);
  if (!leftDate || !rightDate) return left;
  return leftDate >= rightDate ? left : right;
}
