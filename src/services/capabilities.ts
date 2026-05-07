import { SUPPORTED_RECORD_TYPES } from "../constants.js";

export function buildCapabilities() {
  return {
    project: "samsung-health-mcp-unofficial",
    mcp_name: "io.github.davidmosiah/samsung-health-mcp",
    creator: {
      name: "David Mosiah",
      github: "https://github.com/davidmosiah"
    },
    unofficial: true,
    api_boundary: {
      source: "Samsung Health personal-data download CSV/ZIP",
      raw_definition: "Raw means records from a user-provided Samsung Health export file.",
      samsung_health_live_access: false,
      does_not_include: [
        "live Samsung Health reads",
        "Samsung account scraping",
        "Health Connect live reads",
        "Samsung Health Data SDK Android bridge",
        "device sensor streaming",
        "medical diagnosis"
      ]
    },
    supported_data: [
      { name: "Activity", examples: ["steps", "distance", "active energy"], tools: ["samsung_health_list_records", "samsung_health_daily_summary"] },
      { name: "Heart", examples: ["heart rate", "resting heart rate", "HRV SDNN"], tools: ["samsung_health_list_records", "samsung_health_daily_summary"] },
      { name: "Sleep", examples: ["sleep analysis categories and durations"], tools: ["samsung_health_list_records", "samsung_health_daily_summary", "samsung_health_wellness_context"] },
      { name: "Workouts", examples: ["activity type", "duration", "distance", "energy"], tools: ["samsung_health_list_workouts", "samsung_health_weekly_summary"] },
      { name: "Inventory", examples: ["available date range", "record types", "export freshness"], tools: ["samsung_health_data_inventory"] }
    ],
    supported_record_types: SUPPORTED_RECORD_TYPES,
    recommended_agent_flow: [
      "Call samsung_health_agent_manifest when installing or operating inside an agent runtime.",
      "Call samsung_health_connection_status before reading export data.",
      "Call samsung_health_data_inventory to discover available data, stale exports and safe next calls.",
      "Use samsung_health_daily_summary or samsung_health_weekly_summary before low-level record calls.",
      "Use samsung_health_wellness_context when handing export-derived sleep/activity context to Exercise Catalog.",
      "Do not ask users to paste raw CSV content into chat.",
      "Do not claim live Samsung Health access; this connector reads local Samsung Health exports."
    ],
    privacy_modes: [
      { mode: "summary", use_when: "The agent only needs daily or weekly aggregates." },
      { mode: "structured", use_when: "The user wants bounded records without source names, creation dates or raw metadata." },
      { mode: "raw", use_when: "The user explicitly asks for raw export record attributes." }
    ],
    links: {
      github: "https://github.com/davidmosiah/samsung-health-mcp",
      samsung_health_data_sdk: "https://developer.samsung.com/health/data/overview.html",
      samsung_personal_data_export: "https://www.samsung.com/us/support/answer/ANS10001379/",
      health_connect: "https://support.google.com/android/answer/12201227",
      delx_wellness: "https://github.com/davidmosiah/delx-wellness"
    }
  };
}
