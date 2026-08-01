import type { SamsungHealthRecord, SamsungHealthWorkout, PrivacyMode } from "../types.js";
import { dateOnlyInTimezone, parseFlexibleDate } from "./time.js";

/**
 * Metadata columns that may be carried out of a Samsung Health export.
 *
 * This is an ALLOWLIST on purpose. A denylist only protects against the leaks
 * we already know about, and Samsung adds columns to the personal-data export
 * whenever the app changes: a new `route_points` or `home_location` column
 * would ship straight to the agent under a denylist. Anything not recognised
 * here is dropped at parse time — before it reaches the snapshot cache, any
 * tool, any resource, or `raw` mode — and only counted, so the agent knows
 * data was withheld without learning which private columns exist.
 *
 * Explicitly NOT allowlisted (the 0.6.0 leak): `*_latitude`, `*_longitude`,
 * `*_altitude`, `deviceuuid`, `datauuid`, `location_data`, `live_data`,
 * `comment`, `com.samsung.health.exercise.custom` and any free-text field.
 */
const SAFE_METADATA_KEY_NAMES = [
  // provenance / plumbing
  "source_file", "source_name", "source", "pkg_name", "package_name",
  // time
  "time", "start_time", "end_time", "create_time", "update_time", "time_offset",
  "date", "start_date", "end_date", "create_date", "update_date",
  // units and enumerations
  "unit", "type", "stage", "status", "quality",
  // activity
  "duration", "elapsed_time", "distance", "count", "steps", "step_count",
  "calorie", "calories", "kcal", "energy", "speed", "pace", "cadence",
  "incline", "power", "vo2_max", "sweat_loss", "score", "efficiency",
  // heart / respiration
  "heart_rate", "hrv", "rmssd", "sdnn", "bpm",
  "oxygen_saturation", "spo2", "saturation", "respiratory_rate", "breathing_rate",
  // body
  "weight", "height", "body_fat", "muscle_mass", "body_water", "bmi", "bmr",
  "basal_metabolic_rate", "temperature", "stress"
];

const SAFE_METADATA_PATTERN = new RegExp(`(^|_)(${SAFE_METADATA_KEY_NAMES.join("|")})$`);

/** Key added to sanitized metadata reporting how many columns were dropped. */
export const WITHHELD_METADATA_COUNT_KEY = "withheld_metadata_count";

function normalizeMetadataKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function isSafeMetadataKey(key: string): boolean {
  return SAFE_METADATA_PATTERN.test(normalizeMetadataKey(key));
}

/**
 * Keep only allowlisted metadata columns. Applied at parse time so no consumer
 * — including a future one — can opt back into geolocation or hardware ids.
 */
export function sanitizeMetadata(metadata: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  let withheld = 0;
  for (const [key, value] of Object.entries(metadata)) {
    if (isSafeMetadataKey(key)) safe[key] = value;
    else withheld += 1;
  }
  if (withheld > 0) safe[WITHHELD_METADATA_COUNT_KEY] = String(withheld);
  return safe;
}

export function recordPrivacyView(records: SamsungHealthRecord[], mode: PrivacyMode, timezone = "UTC") {
  if (mode === "raw") {
    return {
      records,
      disclosure: "raw_export_record_attributes_returned"
    };
  }

  if (mode === "structured") {
    return {
      records: records.map((record) => ({
        type: record.type,
        unit: record.unit,
        value: record.numeric_value ?? record.value,
        numeric_value: record.numeric_value,
        start_date: dateOnlyInTimezone(record.startDate, timezone),
        end_date: dateOnlyInTimezone(record.endDate, timezone),
        metadata_keys: record.metadata ? Object.keys(record.metadata).sort() : undefined
      })),
      disclosure: "structured_fields_without_creation_dates_source_names_or_raw_metadata"
    };
  }

  return {
    records: [],
    aggregate: recordAggregate(records, timezone),
    disclosure: "summary_mode_omits_individual_records"
  };
}

export function workoutPrivacyView(workouts: SamsungHealthWorkout[], mode: PrivacyMode, timezone = "UTC") {
  if (mode === "raw") {
    return {
      workouts,
      disclosure: "raw_export_workout_attributes_returned"
    };
  }

  if (mode === "structured") {
    return {
      workouts: workouts.map((workout) => ({
        workoutActivityType: workout.workoutActivityType,
        start_date: dateOnlyInTimezone(workout.startDate, timezone),
        end_date: dateOnlyInTimezone(workout.endDate, timezone),
        duration: workout.duration,
        durationUnit: workout.durationUnit,
        totalDistance: workout.totalDistance,
        totalDistanceUnit: workout.totalDistanceUnit,
        totalEnergyBurned: workout.totalEnergyBurned,
        totalEnergyBurnedUnit: workout.totalEnergyBurnedUnit,
        metadata_keys: workout.metadata ? Object.keys(workout.metadata).sort() : undefined,
        event_count: workout.events?.length
      })),
      disclosure: "structured_fields_without_creation_dates_source_names_or_raw_metadata"
    };
  }

  return {
    workouts: [],
    aggregate: workoutAggregate(workouts, timezone),
    disclosure: "summary_mode_omits_individual_workouts"
  };
}

export function recordAggregate(records: SamsungHealthRecord[], timezone = "UTC") {
  const numeric = records.filter((record) => record.numeric_value !== undefined) as Array<SamsungHealthRecord & { numeric_value: number }>;
  const values = numeric.map((record) => record.numeric_value);
  return {
    count_by_type: countBy(records, (record) => record.type || "unknown"),
    units: Array.from(new Set(records.map((record) => record.unit).filter((unit): unit is string => Boolean(unit)))).sort(),
    date_range: dateRange(records.flatMap((record) => [record.startDate, record.endDate]), timezone),
    numeric: values.length ? {
      count: values.length,
      sum: round(values.reduce((sum, value) => sum + value, 0)),
      average: round(values.reduce((sum, value) => sum + value, 0) / values.length),
      min: round(Math.min(...values)),
      max: round(Math.max(...values))
    } : undefined
  };
}

export function workoutAggregate(workouts: SamsungHealthWorkout[], timezone = "UTC") {
  return {
    count_by_activity: countBy(workouts, (workout) => workout.workoutActivityType || "unknown"),
    date_range: dateRange(workouts.flatMap((workout) => [workout.startDate, workout.endDate]), timezone),
    total_duration_minutes: round(workouts.reduce((sum, workout) => sum + durationMinutes(workout), 0)),
    total_distance: round(workouts.reduce((sum, workout) => sum + (workout.totalDistance ?? 0), 0)),
    distance_units: Array.from(new Set(workouts.map((workout) => workout.totalDistanceUnit).filter((unit): unit is string => Boolean(unit)))).sort(),
    total_energy_kcal: round(workouts.reduce((sum, workout) => sum + (workout.totalEnergyBurned ?? 0), 0))
  };
}

export function dateRange(values: Array<string | undefined>, timezone = "UTC") {
  const dates = values
    .map((value) => parseFlexibleDate(value))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.getTime() - right.getTime());
  if (!dates.length) return undefined;
  return {
    first: dates[0].toISOString(),
    last: dates[dates.length - 1].toISOString(),
    first_date: dateOnlyInTimezone(dates[0].toISOString(), timezone),
    last_date: dateOnlyInTimezone(dates[dates.length - 1].toISOString(), timezone)
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

function durationMinutes(workout: SamsungHealthWorkout): number {
  if (!workout.duration) return 0;
  if (workout.durationUnit === "sec") return workout.duration / 60;
  if (workout.durationUnit === "hr") return workout.duration * 60;
  return workout.duration;
}

function round(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.round(value * 100) / 100;
}
