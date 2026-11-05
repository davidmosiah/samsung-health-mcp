export type ResponseFormat = "markdown" | "json";
export type PrivacyMode = "summary" | "structured" | "raw";

export interface ToolResponse<T> extends Record<string, unknown> {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: T;
  isError?: boolean;
}

export interface SamsungHealthConfig {
  exportPath?: string;
  privacyMode: PrivacyMode;
  timezone?: string;
  lastImportAt?: string;
  lastImportSourcePath?: string;
  /** Folder watched for new Samsung Health exports (auto-reimport source). */
  watchPath?: string;
  /** Path of the export most recently promoted from the watch folder. */
  lastWatchImportPath?: string;
  /** ISO timestamp of the last successful watch-folder reimport. */
  lastWatchImportAt?: string;
  /**
   * Count same-type workouts that cover nearly the same interval once in
   * summaries. Off by default: overlap alone cannot tell a copy from two real
   * sessions, so summaries only report them as possible duplicates.
   */
  mergeOverlappingWorkouts: boolean;
}

export interface SamsungHealthRecord {
  /** Calendar date encoded by a Samsung daily table; not a fabricated timestamp. */
  calendarDate?: string;
  type: string;
  sourceName?: string;
  unit?: string;
  value?: string;
  numeric_value?: number;
  creationDate?: string;
  startDate?: string;
  endDate?: string;
  metadata?: Record<string, string>;
}

export interface SamsungHealthWorkout {
  workoutActivityType: string;
  sourceName?: string;
  creationDate?: string;
  startDate?: string;
  endDate?: string;
  duration?: number;
  durationUnit?: string;
  totalDistance?: number;
  totalDistanceUnit?: string;
  totalEnergyBurned?: number;
  totalEnergyBurnedUnit?: string;
  metadata?: Record<string, string>;
  events?: SamsungHealthWorkoutEvent[];
}

export interface SamsungHealthWorkoutEvent {
  type?: string;
  date?: string;
  duration?: number;
  durationUnit?: string;
}
