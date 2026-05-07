import type { SamsungHealthRecord, SamsungHealthWorkout } from "../types.js";
import { getExportSnapshot, parseSamsungDate, recordOverlaps } from "./samsung-health-export.js";
import { addCalendarDays, dayBounds, todayIsoDate } from "./time.js";

interface SummaryOptions {
  timezone?: string;
}

interface DayWindow {
  date: string;
  start: Date;
  end: Date;
}

export async function buildDailySummary(exportPath: string | undefined, date?: string, options: SummaryOptions = {}) {
  const timezone = options.timezone ?? "UTC";
  const targetDate = date ?? todayIsoDate(timezone);
  const window = buildDayWindow(targetDate, timezone);
  const snapshot = await getExportSnapshot({ exportPath, start: window.start.toISOString(), end: window.end.toISOString() });
  return summarizeDay(snapshot.records, snapshot.workouts, window, {
    generatedAt: snapshot.generated_at,
    source: snapshot.source,
    timezone,
    cacheHit: snapshot.cache.hit,
    exportModifiedAt: snapshot.location.modified_at
  });
}

export async function buildWeeklySummary(exportPath: string | undefined, endDate?: string, days = 7, options: SummaryOptions = {}) {
  const timezone = options.timezone ?? "UTC";
  const normalizedDays = Math.min(Math.max(Math.trunc(days), 1), 30);
  const targetEndDate = endDate ?? todayIsoDate(timezone);
  const startDate = addCalendarDays(targetEndDate, -(normalizedDays - 1));
  const rangeStart = dayBounds(startDate, timezone).start;
  const rangeEnd = dayBounds(targetEndDate, timezone).end;
  const snapshot = await getExportSnapshot({ exportPath, start: rangeStart.toISOString(), end: rangeEnd.toISOString() });
  const daily = [];

  for (let offset = 0; offset < normalizedDays; offset += 1) {
    const date = addCalendarDays(startDate, offset);
    const window = buildDayWindow(date, timezone);
    daily.push(summarizeDay(
      snapshot.records.filter((record) => recordOverlaps(record.startDate, record.endDate, window.start, window.end)),
      snapshot.workouts.filter((workout) => recordOverlaps(workout.startDate, workout.endDate, window.start, window.end)),
      window,
      {
        generatedAt: snapshot.generated_at,
        source: snapshot.source,
        timezone,
        cacheHit: snapshot.cache.hit,
        exportModifiedAt: snapshot.location.modified_at,
        includeWorkoutRecords: false
      }
    ));
  }

  const totals = {
    steps: daily.reduce((sum, item) => sum + item.totals.steps, 0),
    active_energy_kcal: round(daily.reduce((sum, item) => sum + (item.totals.active_energy_kcal ?? 0), 0)),
    distance: round(daily.reduce((sum, item) => sum + (item.totals.distance ?? 0), 0)),
    workouts: daily.reduce((sum, item) => sum + item.workouts.count, 0),
    workout_duration_minutes: round(daily.reduce((sum, item) => sum + item.workouts.total_duration_minutes, 0)),
    sleep_minutes: daily.reduce((sum, item) => sum + item.sleep.minutes_asleep, 0),
    mindful_minutes: round(daily.reduce((sum, item) => sum + item.mindfulness.minutes, 0))
  };

  return {
    kind: "weekly_summary",
    start_date: startDate,
    end_date: targetEndDate,
    days: normalizedDays,
    timezone,
    generated_at: snapshot.generated_at,
    source: snapshot.source,
    export_modified_at: snapshot.location.modified_at,
    cache: {
      hit: snapshot.cache.hit,
      records_indexed: snapshot.records.length,
      workouts_indexed: snapshot.workouts.length
    },
    totals,
    averages: {
      steps_per_day: round(totals.steps / normalizedDays),
      active_energy_kcal_per_day: round((totals.active_energy_kcal ?? 0) / normalizedDays),
      sleep_hours_per_day: round(totals.sleep_minutes / normalizedDays / 60),
      hrv_sdnn_ms: averageDefined(daily.map((item) => item.heart.hrv_sdnn_ms)),
      resting_bpm: averageDefined(daily.map((item) => item.heart.resting_bpm))
    },
    trends: buildWeeklyTrends(daily),
    daily,
    notes: [
      "Summary is derived from a Samsung Health export file, not live Samsung Health.",
      "This is wellness context, not medical diagnosis."
    ]
  };
}

export function formatSummaryMarkdown(summary: Record<string, unknown>): string {
  const lines = [`# Samsung Health ${summary.kind === "weekly_summary" ? "Weekly" : "Daily"} Summary`, ""];
  for (const [key, value] of Object.entries(summary)) {
    if (key === "daily" || key === "workouts") continue;
    lines.push(`- **${key}**: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
  return lines.join("\n");
}

function summarizeDay(records: SamsungHealthRecord[], workouts: SamsungHealthWorkout[], window: DayWindow, options: {
  generatedAt: string;
  source: string;
  timezone: string;
  cacheHit: boolean;
  exportModifiedAt?: string;
  includeWorkoutRecords?: boolean;
}) {
  const steps = sumType(records, "samsung_health_steps");
  const activeEnergy = sumType(records, "samsung_health_active_energy");
  const distance = sumType(records, "samsung_health_distance");
  const resting = averageType(records, "samsung_health_resting_heart_rate");
  const hrv = averageType(records, "samsung_health_hrv");
  const heartRateValues = numericValues(records, "samsung_health_heart_rate");
  const respiratoryRate = averageType(records, "samsung_health_respiratory_rate");
  const oxygenSaturation = averageType(records, "samsung_health_oxygen_saturation");
  const sleep = sleepBreakdown(records);
  const bodyMass = latestType(records, "samsung_health_body_weight");
  const mindfulMinutes = 0;
  const workoutDuration = round(workouts.reduce((sum, workout) => sum + workoutDurationMinutes(workout), 0)) ?? 0;

  return {
    kind: "daily_summary",
    date: window.date,
    timezone: options.timezone,
    generated_at: options.generatedAt,
    source: options.source,
    export_modified_at: options.exportModifiedAt,
    cache: {
      hit: options.cacheHit,
      records_indexed: records.length,
      workouts_indexed: workouts.length
    },
    totals: {
      steps,
      active_energy_kcal: activeEnergy,
      distance: distance || undefined
    },
    heart: {
      average_bpm: averageValues(heartRateValues),
      min_bpm: minValue(heartRateValues),
      max_bpm: maxValue(heartRateValues),
      resting_bpm: round(resting),
      hrv_sdnn_ms: round(hrv),
      respiratory_rate: round(respiratoryRate),
      oxygen_saturation: round(oxygenSaturation)
    },
    sleep,
    body: {
      body_mass: bodyMass?.numeric_value,
      body_mass_unit: bodyMass?.unit,
      body_mass_recorded_at: bodyMass?.endDate ?? bodyMass?.startDate
    },
    mindfulness: {
      minutes: round(mindfulMinutes) ?? 0
    },
    workouts: {
      count: workouts.length,
      total_duration_minutes: workoutDuration,
      activity_counts: countBy(workouts, (workout) => workout.workoutActivityType || "unknown"),
      records: options.includeWorkoutRecords === false ? undefined : workouts
    },
    data_quality: {
      record_count: records.length,
      workout_count: workouts.length,
      has_sleep: sleep.minutes_asleep > 0,
      has_heart: heartRateValues.length > 0 || resting !== undefined || hrv !== undefined,
      has_activity: steps > 0 || workouts.length > 0
    },
    notes: [
      "Summary is derived from a Samsung Health export file, not live Samsung Health.",
      "This is wellness context, not medical diagnosis."
    ]
  };
}

function buildDayWindow(date: string, timezone: string): DayWindow {
  const { start, end } = dayBounds(date, timezone);
  return { date, start, end };
}

function buildWeeklyTrends(daily: Array<ReturnType<typeof summarizeDay>>) {
  const first = daily[0];
  const last = daily[daily.length - 1];
  const split = Math.max(1, Math.floor(daily.length / 2));
  const firstHalf = daily.slice(0, split);
  const secondHalf = daily.slice(split);
  const highestStepsDay = maxBy(daily, (item) => item.totals.steps);
  const sleepDays = daily.filter((item) => item.sleep.minutes_asleep > 0);
  const lowestSleepDay = minBy(sleepDays, (item) => item.sleep.minutes_asleep);

  return {
    steps_change_from_first_to_last: first && last ? last.totals.steps - first.totals.steps : undefined,
    sleep_hours_change_from_first_to_last: first && last ? round(last.sleep.hours_asleep - first.sleep.hours_asleep) : undefined,
    highest_steps_day: highestStepsDay ? { date: highestStepsDay.date, steps: highestStepsDay.totals.steps } : undefined,
    lowest_sleep_day: lowestSleepDay ? { date: lowestSleepDay.date, hours_asleep: lowestSleepDay.sleep.hours_asleep } : undefined,
    hrv_direction: direction(
      averageDefined(firstHalf.map((item) => item.heart.hrv_sdnn_ms)),
      averageDefined(secondHalf.map((item) => item.heart.hrv_sdnn_ms))
    ),
    resting_hr_direction: direction(
      averageDefined(firstHalf.map((item) => item.heart.resting_bpm)),
      averageDefined(secondHalf.map((item) => item.heart.resting_bpm))
    )
  };
}

function sleepBreakdown(records: SamsungHealthRecord[]) {
  const stageRecords = records.filter((record) => record.type === "samsung_health_sleep" || record.type === "samsung_health_sleep_stage");
  const stages: Record<string, number> = {};
  let minutesAsleep = 0;
  let minutesInBed = 0;
  let minutesAwake = 0;

  for (const record of stageRecords) {
    const minutes = recordDurationMinutes(record);
    const stage = sleepStageName(record.value);
    stages[stage] = round((stages[stage] ?? 0) + minutes) ?? 0;
    if (/asleep|sleep|light|deep|rem/i.test(record.value ?? "")) minutesAsleep += minutes;
    if (/in.?bed/i.test(record.value ?? "")) minutesInBed += minutes;
    if (/awake|wake/i.test(record.value ?? "")) minutesAwake += minutes;
  }

  return {
    minutes_asleep: round(minutesAsleep) ?? 0,
    hours_asleep: round(minutesAsleep / 60) ?? 0,
    minutes_in_bed: round(minutesInBed) ?? 0,
    awake_minutes: round(minutesAwake) ?? 0,
    stages_minutes: stages
  };
}

function sleepStageName(value: string | undefined): string {
  if (!value) return "unknown";
  return value
    .replace(/^com\.samsung\.health\./i, "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "unknown";
}

function sumType(records: SamsungHealthRecord[], type: string): number {
  return round(records.filter((record) => record.type === type).reduce((sum, record) => sum + (record.numeric_value ?? 0), 0)) ?? 0;
}

function averageType(records: SamsungHealthRecord[], type: string): number | undefined {
  return averageValues(numericValues(records, type));
}

function numericValues(records: SamsungHealthRecord[], type: string): number[] {
  return records.filter((record) => record.type === type && record.numeric_value !== undefined).map((record) => record.numeric_value as number);
}

function latestType(records: SamsungHealthRecord[], type: string): SamsungHealthRecord | undefined {
  return records
    .filter((record) => record.type === type && record.numeric_value !== undefined)
    .sort((left, right) => (parseSamsungDate(right.endDate ?? right.startDate)?.getTime() ?? 0) - (parseSamsungDate(left.endDate ?? left.startDate)?.getTime() ?? 0))[0];
}

function durationMinutes(records: SamsungHealthRecord[]): number {
  return records.reduce((sum, record) => sum + recordDurationMinutes(record), 0);
}

function recordDurationMinutes(record: SamsungHealthRecord): number {
  const start = parseSamsungDate(record.startDate);
  const end = parseSamsungDate(record.endDate);
  if (!start || !end) return 0;
  return Math.max(0, end.getTime() - start.getTime()) / 60000;
}

function workoutDurationMinutes(workout: SamsungHealthWorkout): number {
  if (!workout.duration) return 0;
  if (workout.durationUnit === "sec") return workout.duration / 60;
  if (workout.durationUnit === "hr") return workout.duration * 60;
  return workout.duration;
}

function averageDefined(values: Array<number | undefined>): number | undefined {
  return averageValues(values.filter((value): value is number => value !== undefined));
}

function averageValues(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function minValue(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return round(Math.min(...values));
}

function maxValue(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return round(Math.max(...values));
}

function direction(before: number | undefined, after: number | undefined): "up" | "down" | "flat" | "unknown" {
  if (before === undefined || after === undefined) return "unknown";
  const delta = after - before;
  if (Math.abs(delta) < 0.5) return "flat";
  return delta > 0 ? "up" : "down";
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

function minBy<T>(items: T[], getValue: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>((best, item) => best === undefined || getValue(item) < getValue(best) ? item : best, undefined);
}

function maxBy<T>(items: T[], getValue: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>((best, item) => best === undefined || getValue(item) > getValue(best) ? item : best, undefined);
}

function round(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.round(value * 100) / 100;
}
