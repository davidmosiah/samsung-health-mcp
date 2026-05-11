export const SERVER_NAME = "samsung-health-mcp-server";
export const SERVER_VERSION = "0.4.0";
export const NPM_PACKAGE_NAME = "samsung-health-mcp-unofficial";
export const PINNED_NPM_PACKAGE = `${NPM_PACKAGE_NAME}@${SERVER_VERSION}`;

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export const SUPPORTED_RECORD_TYPES = [
  "samsung_health_steps",
  "samsung_health_distance",
  "samsung_health_active_energy",
  "samsung_health_heart_rate",
  "samsung_health_resting_heart_rate",
  "samsung_health_hrv",
  "samsung_health_respiratory_rate",
  "samsung_health_oxygen_saturation",
  "samsung_health_body_weight",
  "samsung_health_body_fat",
  "samsung_health_sleep",
  "samsung_health_sleep_stage"
];
