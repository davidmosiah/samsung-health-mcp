import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerSamsungHealthPrompts(server: McpServer): void {
  server.registerPrompt("samsung_health_daily_review", {
    title: "Samsung Health Daily Review",
    description: "Review a day of Samsung Health export data with non-medical wellness framing.",
    argsSchema: {
      date: z.string().optional().describe("YYYY-MM-DD date to review.")
    }
  }, ({ date }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Call samsung_health_connection_status first, then samsung_health_data_inventory if the available date range is unknown. Then call samsung_health_daily_summary${date ? ` for ${date}` : ""}. Summarize activity, heart, sleep and workouts as wellness context. Do not provide medical diagnosis.`
      }
    }]
  }));

  server.registerPrompt("samsung_health_weekly_review", {
    title: "Samsung Health Weekly Review",
    description: "Review a week of Samsung Health export data with practical habit signals.",
    argsSchema: {
      end_date: z.string().optional().describe("YYYY-MM-DD end date."),
      days: z.string().optional().describe("Number of days to review.")
    }
  }, ({ end_date, days }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Call samsung_health_connection_status first, then samsung_health_data_inventory if the available date range is unknown. Then call samsung_health_weekly_summary${end_date ? ` ending ${end_date}` : ""}${days ? ` for ${days} days` : ""}. Compare steps, sleep, workouts and heart signals. Keep guidance non-medical and privacy-conscious.`
      }
    }]
  }));
}
