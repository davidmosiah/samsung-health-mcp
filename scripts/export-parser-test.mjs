import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exportPath = resolve('fixtures/samsung_health_export');
const client = new Client({ name: 'samsung-health-export-test', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: { ...process.env, SAMSUNG_HEALTH_EXPORT_PATH: exportPath }
});

await client.connect(transport);
try {
  const status = await client.callTool({ name: 'samsung_health_connection_status', arguments: { response_format: 'json' } });
  assert.equal(status.structuredContent?.ok, true);
  assert.equal(status.structuredContent?.export?.kind, 'directory');
  assert.equal(status.structuredContent?.export?.exists, true);

  const records = await client.callTool({
    name: 'samsung_health_list_records',
    arguments: { type: 'samsung_health_steps', limit: 10, privacy_mode: 'raw', response_format: 'json' }
  });
  assert.equal(records.structuredContent?.count, 3);
  assert.equal(records.structuredContent?.records?.[0]?.sourceName, 'Galaxy Watch');

  const summaryRecords = await client.callTool({
    name: 'samsung_health_list_records',
    arguments: { type: 'samsung_health_steps', limit: 10, response_format: 'json' }
  });
  assert.equal(summaryRecords.structuredContent?.privacy_mode, 'summary');
  assert.equal(summaryRecords.structuredContent?.records?.length, 0);
  assert.equal(summaryRecords.structuredContent?.aggregate?.count_by_type?.samsung_health_steps, 3);

  const workouts = await client.callTool({ name: 'samsung_health_list_workouts', arguments: { limit: 10, response_format: 'json' } });
  assert.equal(workouts.structuredContent?.count, 1);
  assert.equal(workouts.structuredContent?.workouts?.length, 0);

  const rawWorkouts = await client.callTool({ name: 'samsung_health_list_workouts', arguments: { limit: 10, privacy_mode: 'raw', response_format: 'json' } });
  assert.equal(rawWorkouts.structuredContent?.workouts?.[0]?.workoutActivityType, 'running');
  assert.equal(rawWorkouts.structuredContent?.workouts?.[0]?.totalDistance, 5.2);

  const inventory = await client.callTool({
    name: 'samsung_health_data_inventory',
    arguments: { response_format: 'json' }
  });
  assert.equal(inventory.structuredContent?.totals?.workouts, 1);
  assert.equal(inventory.structuredContent?.record_types?.samsung_health_steps?.count, 3);

  const daily = await client.callTool({
    name: 'samsung_health_daily_summary',
    arguments: { date: '2026-05-01', timezone: 'America/Fortaleza', response_format: 'json' }
  });
  assert.equal(daily.structuredContent?.date, '2026-05-01');
  assert.equal(daily.structuredContent?.totals?.steps, 4000);
  assert.equal(daily.structuredContent?.heart?.resting_bpm, 58);
  assert.equal(daily.structuredContent?.heart?.hrv_sdnn_ms, 72);
  assert.equal(daily.structuredContent?.heart?.respiratory_rate, 14.2);
  assert.equal(daily.structuredContent?.sleep?.minutes_asleep, 420);
  assert.equal(daily.structuredContent?.workouts?.count, 1);
  assert.equal(daily.structuredContent?.body?.body_mass, 80);

  const weekly = await client.callTool({
    name: 'samsung_health_weekly_summary',
    arguments: { end_date: '2026-05-02', days: 2, timezone: 'America/Fortaleza', response_format: 'json' }
  });
  assert.equal(weekly.structuredContent?.days, 2);
  assert.equal(weekly.structuredContent?.totals?.steps, 5000);
  assert.equal(weekly.structuredContent?.daily?.length, 2);

  const context = await client.callTool({
    name: 'samsung_health_wellness_context',
    arguments: { date: '2026-05-01', timezone: 'America/Fortaleza', response_format: 'json' }
  });
  assert.equal(context.structuredContent?.source, 'samsung_health');
  assert.equal(context.structuredContent?.sleep_score, 100);
  assert.equal(context.structuredContent?.recent_training_load, 'normal');
  assert.equal(context.structuredContent?.recovery_signals?.hrv_sdnn_ms, 72);

  console.log(JSON.stringify({ ok: true, export_parser: true, daily_steps: daily.structuredContent?.totals?.steps }, null, 2));
} finally {
  await client.close();
}
