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
}

export interface SamsungHealthRecord {
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
