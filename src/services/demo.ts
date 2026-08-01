/**
 * Synthetic example payloads for `samsung_health_demo`.
 *
 * The stated purpose of the demo tool is that agents see the contract *before*
 * parsing a real export. That only holds if the examples match what the builders
 * actually return — an example advertising a field the server never emits makes
 * an agent write a parser for data that never arrives.
 *
 * These shapes are not hand-maintained guesses: `scripts/demo-contract-test.mjs`
 * runs the real `buildDailySummary` / `buildWeeklySummary` / `buildWellnessContext`
 * against the repo fixture and fails the build when the key sets diverge in
 * either direction (invented keys, or contract fields missing from the example).
 *
 * If you change a builder's output shape, that gate fails and points here.
 * Update this file — do not weaken the gate.
 */

const DEMO_DATE = "2026-05-01";
const DEMO_TIMEZONE = "America/Fortaleza";
const DEMO_GENERATED_AT = "2026-05-01T23:59:00.000Z";
const DEMO_EXPORT_MODIFIED_AT = "2026-05-01T23:31:00.000Z";
const DEMO_WEEK_START = "2026-04-25";

const DEMO_NOTES = [
  "Summary is derived from a Samsung Health export file, not live Samsung Health.",
  "This is wellness context, not medical diagnosis."
];

/** One representative day, matching the shape of `buildDailySummary`. */
function demoDailySummary() {
  return {
    kind: "daily_summary",
    date: DEMO_DATE,
    timezone: DEMO_TIMEZONE,
    generated_at: DEMO_GENERATED_AT,
    source: "samsung_health_export",
    export_modified_at: DEMO_EXPORT_MODIFIED_AT,
    cache: {
      hit: true,
      records_indexed: 2384,
      workouts_indexed: 1
    },
    totals: {
      steps: 6843,
      active_energy_kcal: 482,
      distance: 5210
    },
    heart: {
      average_bpm: 68,
      min_bpm: 52,
      max_bpm: 149,
      resting_bpm: 61,
      hrv_sdnn_ms: 42,
      respiratory_rate: 15.1,
      oxygen_saturation: 96
    },
    sleep: {
      minutes_asleep: 408,
      hours_asleep: 6.8,
      minutes_in_bed: 432,
      awake_minutes: 24,
      stages_minutes: {
        asleep: 408
      }
    },
    body: {
      body_mass: 78.4,
      body_mass_unit: "kg",
      body_mass_recorded_at: "2026-05-01T09:12:00-03:00"
    },
    mindfulness: {
      minutes: 10
    },
    workouts: {
      count: 1,
      total_duration_minutes: 32,
      activity_counts: {
        running: 1
      },
      privacy_mode: "summary",
      records: [] as unknown[],
      disclosure: "summary_mode_omits_individual_workouts"
    },
    data_quality: {
      record_count: 2384,
      workout_count: 1,
      has_sleep: true,
      has_heart: true,
      has_activity: true
    },
    notes: [...DEMO_NOTES]
  };
}

/** Matching the shape of `buildWeeklySummary`, including the nested `daily` array. */
function demoWeeklySummary() {
  return {
    kind: "weekly_summary",
    start_date: DEMO_WEEK_START,
    end_date: DEMO_DATE,
    days: 7,
    timezone: DEMO_TIMEZONE,
    requested_privacy_mode: "raw",
    privacy_mode: "summary",
    privacy_disclosure:
      "weekly_summary_always_aggregates_requested_privacy_mode_raw_was_not_applied_use_samsung_health_daily_summary_or_samsung_health_list_workouts_for_record_level_access",
    generated_at: DEMO_GENERATED_AT,
    source: "samsung_health_export",
    export_modified_at: DEMO_EXPORT_MODIFIED_AT,
    cache: {
      hit: true,
      records_indexed: 16204,
      workouts_indexed: 3
    },
    totals: {
      steps: 49868,
      active_energy_kcal: 3297,
      distance: 38400,
      sleep_minutes: 2898,
      mindful_minutes: 40,
      workout_duration_minutes: 198,
      workouts: 3
    },
    averages: {
      steps_per_day: 7124,
      active_energy_kcal_per_day: 471,
      sleep_hours_per_day: 6.9,
      hrv_sdnn_ms: 44,
      resting_bpm: 60
    },
    trends: {
      steps_change_from_first_to_last: 1180,
      sleep_hours_change_from_first_to_last: -0.4,
      highest_steps_day: {
        date: "2026-04-29",
        steps: 9312
      },
      lowest_sleep_day: {
        date: "2026-04-27",
        hours_asleep: 5.9
      },
      hrv_direction: "stable",
      resting_hr_direction: "stable"
    },
    daily: [demoDailySummary()],
    notes: [...DEMO_NOTES]
  };
}

/** Matching the shape of `buildWellnessContext` — note it has no `kind` field. */
function demoWellnessContext() {
  return {
    source: "samsung_health",
    date: DEMO_DATE,
    timezone: DEMO_TIMEZONE,
    generated_at: DEMO_GENERATED_AT,
    sleep_score: 78,
    recent_training_load: "normal",
    recovery_signals: {
      resting_bpm: 61,
      hrv_sdnn_ms: 42,
      respiratory_rate: 15.1,
      oxygen_saturation: 96
    },
    activity_signals: {
      steps: 6843,
      active_energy_kcal: 482,
      workout_count: 1,
      workout_duration_minutes: 32
    },
    sleep_signals: {
      hours_asleep: 6.8,
      stages_minutes: {
        asleep: 408
      }
    },
    soreness: [] as string[],
    injury_flags: [] as string[],
    notes: ["Derived from Samsung Health export data, not live Samsung Health."],
    data_quality: {
      confidence: "export",
      source: "samsung_health_export",
      has_sleep: true,
      has_heart: true,
      has_activity: true,
      export_modified_at: DEMO_EXPORT_MODIFIED_AT
    },
    telegram_summary: "Samsung Health wellness context | Sleep: 78 | Load: normal | HRV: 42"
  };
}

export function buildDemoPayload() {
  return {
    ok: true,
    is_demo: true,
    source: "samsung_health_export",
    device_hint: "Galaxy Watch 6",
    sample: {
      samsung_health_daily_summary: demoDailySummary(),
      samsung_health_weekly_summary: demoWeeklySummary(),
      samsung_health_wellness_context: demoWellnessContext()
    },
    notes: [
      "All sample data is synthetic; tagged with is_demo=true.",
      "Real calls parse the local Samsung Health CSV/zip export — no Samsung, Health Connect, or other cloud APIs.",
      "Field names and nesting match the real builders; a contract gate fails the build if they drift.",
      "Optional fields (body mass, oxygen saturation, mindfulness) are absent when the export has no such records.",
      "Pair with wellness-nourish for recovery-aware meal coaching and wellness-cycle-coach for cycle-aware load adjustments."
    ]
  };
}
