import { buildDailySummary } from "./summary.js";

type ContextOptions = {
  date?: string;
  timezone?: string;
  soreness?: string[];
  injury_flags?: string[];
  notes?: string;
};

function loadFromWorkouts(workouts: number, steps: number, workoutMinutes: number): "low" | "normal" | "high" | "unknown" {
  if (!workouts && !steps && !workoutMinutes) return "unknown";
  if (workouts >= 2 || steps >= 15000 || workoutMinutes >= 90) return "high";
  if (workouts === 0 && steps <= 3000) return "low";
  return "normal";
}

function sleepScoreFromHours(hours: number | undefined): number | undefined {
  if (hours === undefined) return undefined;
  return Math.max(0, Math.min(100, Math.round((hours / 7) * 100)));
}

export async function buildWellnessContext(exportPath: string | undefined, options: ContextOptions) {
  const summary = await buildDailySummary(exportPath, options.date, { timezone: options.timezone });
  const sleepScore = sleepScoreFromHours(summary.sleep.hours_asleep);
  const recentTrainingLoad = loadFromWorkouts(summary.workouts.count, summary.totals.steps, summary.workouts.total_duration_minutes);

  return {
    source: "samsung_health",
    date: summary.date,
    timezone: summary.timezone,
    generated_at: summary.generated_at,
    sleep_score: sleepScore,
    recent_training_load: recentTrainingLoad,
    recovery_signals: {
      resting_bpm: summary.heart.resting_bpm,
      hrv_sdnn_ms: summary.heart.hrv_sdnn_ms,
      respiratory_rate: summary.heart.respiratory_rate,
      oxygen_saturation: summary.heart.oxygen_saturation
    },
    activity_signals: {
      steps: summary.totals.steps,
      active_energy_kcal: summary.totals.active_energy_kcal,
      workout_count: summary.workouts.count,
      workout_duration_minutes: summary.workouts.total_duration_minutes
    },
    sleep_signals: {
      hours_asleep: summary.sleep.hours_asleep,
      stages_minutes: summary.sleep.stages_minutes
    },
    soreness: options.soreness ?? [],
    injury_flags: options.injury_flags ?? [],
    notes: [
      "Derived from Samsung Health export data, not live Samsung Health.",
      options.notes
    ].filter((note): note is string => Boolean(note)),
    data_quality: {
      confidence: "export",
      source: summary.source,
      has_sleep: summary.data_quality.has_sleep,
      has_heart: summary.data_quality.has_heart,
      has_activity: summary.data_quality.has_activity,
      export_modified_at: summary.export_modified_at
    },
    telegram_summary: [
      "Samsung Health wellness context",
      sleepScore !== undefined ? `Sleep: ${sleepScore}` : undefined,
      `Load: ${recentTrainingLoad}`,
      summary.heart.hrv_sdnn_ms !== undefined ? `HRV: ${summary.heart.hrv_sdnn_ms}` : undefined
    ].filter(Boolean).join(" | ")
  };
}

export function formatWellnessContextMarkdown(context: Record<string, unknown>): string {
  return ["# Samsung Health Wellness Context", "", JSON.stringify(context, null, 2)].join("\n");
}
