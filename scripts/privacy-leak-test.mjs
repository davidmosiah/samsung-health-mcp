/**
 * Regression gate for the GPS / device-identifier leak fixed in 0.6.0.
 *
 * Before 0.6.0 `samsung_health_daily_summary` and the resource
 * `samsung-health://summary/daily` returned raw workout objects whose
 * `metadata` carried every CSV column verbatim — including start/end
 * latitude+longitude, altitude, the stable `deviceuuid` and free-text user
 * fields. SAMSUNG_HEALTH_PRIVACY_MODE was ignored on that path, and in the
 * default `markdown` response the leak was invisible in the rendered text
 * while `structuredContent` still carried the whole object to the host/LLM.
 *
 * The fixture `com.samsung.health.exercise.202605.csv` now carries synthetic
 * GPS/device columns (obviously fake values) so this gate can fail if the
 * leak ever comes back. Both the text content AND structuredContent are
 * checked, in every privacy mode, for tools and resources.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exportPath = resolve('fixtures/samsung_health_export');
// Isolated HOME so ~/.samsung-health-mcp/config.json on the dev machine cannot
// change the default privacy mode under the test.
const fakeHome = mkdtempSync(join(tmpdir(), 'samsung-health-mcp-privacy-'));

/** Values and column names that must never reach a client, in any mode. */
const FORBIDDEN = [
  '-11.111111',
  '-22.222222',
  '-33.333333',
  '-44.444444',
  'FAKE-DEVICE-UUID',
  'SYNTHETIC-FREE-TEXT-NOTE',
  '999.9',
  'latitude',
  'longitude',
  'deviceuuid',
  'altitude'
];

function assertClean(label, payload) {
  const haystack = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);
  for (const needle of FORBIDDEN) {
    assert.equal(
      haystack.toLowerCase().includes(needle.toLowerCase()),
      false,
      `${label} leaked "${needle}" (privacy regression). Payload: ${haystack.slice(0, 800)}`
    );
  }
}

function assertResultClean(label, result) {
  // Both surfaces matter: markdown hides the workouts but structuredContent
  // is what the host/LLM actually receives.
  assertClean(`${label} (content)`, result.content);
  assertClean(`${label} (structuredContent)`, result.structuredContent);
}

async function withClient(env, run) {
  const client = new Client({ name: 'samsung-health-privacy-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: { ...process.env, HOME: fakeHome, SAMSUNG_HEALTH_EXPORT_PATH: exportPath, ...env }
  });
  await client.connect(transport);
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

const checks = [];

// 1. Tool + resource, every server-level privacy mode, both response formats.
for (const serverMode of [undefined, 'summary', 'structured', 'raw']) {
  await withClient(serverMode ? { SAMSUNG_HEALTH_PRIVACY_MODE: serverMode } : { SAMSUNG_HEALTH_PRIVACY_MODE: '' }, async (client) => {
    const label = `server privacy_mode=${serverMode ?? 'default'}`;

    for (const responseFormat of ['markdown', 'json']) {
      const daily = await client.callTool({
        name: 'samsung_health_daily_summary',
        arguments: { date: '2026-05-01', timezone: 'America/Fortaleza', response_format: responseFormat }
      });
      assertResultClean(`daily_summary ${label} format=${responseFormat}`, daily);
      checks.push(`daily_summary/${serverMode ?? 'default'}/${responseFormat}`);
    }

    // 2. Per-call privacy_mode must be accepted AND must not leak either.
    for (const callMode of ['summary', 'structured', 'raw']) {
      const daily = await client.callTool({
        name: 'samsung_health_daily_summary',
        arguments: { date: '2026-05-01', timezone: 'America/Fortaleza', privacy_mode: callMode, response_format: 'json' }
      });
      assert.equal(daily.isError ?? false, false, `daily_summary rejected privacy_mode=${callMode}: ${JSON.stringify(daily.content)}`);
      assertResultClean(`daily_summary ${label} call_mode=${callMode}`, daily);
      checks.push(`daily_summary/${serverMode ?? 'default'}/call=${callMode}`);
    }

    // 3. The resource path (no arguments — it can only use the server config).
    const resource = await client.readResource({ uri: 'samsung-health://summary/daily' });
    assertClean(`resource summary/daily ${label}`, resource.contents);
    checks.push(`resource:summary/daily/${serverMode ?? 'default'}`);

    const weeklyResource = await client.readResource({ uri: 'samsung-health://summary/weekly' });
    assertClean(`resource summary/weekly ${label}`, weeklyResource.contents);
    checks.push(`resource:summary/weekly/${serverMode ?? 'default'}`);

    // 4. The record-level tools: metadata is allowlisted at parse time, so even
    //    an explicit raw dump cannot carry coordinates or a device identifier.
    const workouts = await client.callTool({ name: 'samsung_health_list_workouts', arguments: { limit: 10, privacy_mode: 'raw', response_format: 'json' } });
    assertResultClean(`list_workouts raw ${label}`, workouts);
    checks.push(`list_workouts/raw/${serverMode ?? 'default'}`);

    const records = await client.callTool({ name: 'samsung_health_list_records', arguments: { limit: 200, privacy_mode: 'raw', response_format: 'json' } });
    assertResultClean(`list_records raw ${label}`, records);
    checks.push(`list_records/raw/${serverMode ?? 'default'}`);

    const inventory = await client.callTool({ name: 'samsung_health_data_inventory', arguments: { response_format: 'json' } });
    assertResultClean(`data_inventory ${label}`, inventory);
    checks.push(`data_inventory/${serverMode ?? 'default'}`);

    const wellness = await client.callTool({ name: 'samsung_health_wellness_context', arguments: { date: '2026-05-01', timezone: 'America/Fortaleza', response_format: 'json' } });
    assertResultClean(`wellness_context ${label}`, wellness);
    checks.push(`wellness_context/${serverMode ?? 'default'}`);
  });
}

// 5. Positive controls: the fix must not gut the payload. Legitimate workout
//    fields and safe metadata survive, and the summary discloses what it did.
await withClient({ SAMSUNG_HEALTH_PRIVACY_MODE: 'raw' }, async (client) => {
  const daily = await client.callTool({
    name: 'samsung_health_daily_summary',
    arguments: { date: '2026-05-01', timezone: 'America/Fortaleza', privacy_mode: 'raw', response_format: 'json' }
  });
  const workouts = daily.structuredContent?.workouts;
  assert.equal(workouts?.count, 1, 'raw daily summary lost the workout count');
  assert.equal(workouts?.privacy_mode, 'raw');
  assert.equal(workouts?.disclosure, 'raw_export_workout_attributes_returned');
  assert.equal(workouts?.records?.[0]?.workoutActivityType, 'running');
  assert.equal(workouts?.records?.[0]?.totalDistance, 5.2);
  assert.equal(workouts?.records?.[0]?.metadata?.calorie, '410', 'allowlist dropped a safe metadata column');
  assert.equal(workouts?.records?.[0]?.metadata?.distance, '5200', 'allowlist dropped a safe metadata column');
  assert.ok(Number(workouts?.records?.[0]?.metadata?.withheld_metadata_count) >= 7, 'withheld metadata columns are not reported');

  // The device identifier must not be laundered into sourceName either.
  assert.equal(workouts?.records?.[0]?.sourceName, 'Galaxy Watch');
});

await withClient({ SAMSUNG_HEALTH_PRIVACY_MODE: 'summary' }, async (client) => {
  const daily = await client.callTool({
    name: 'samsung_health_daily_summary',
    arguments: { date: '2026-05-01', timezone: 'America/Fortaleza', response_format: 'json' }
  });
  const workouts = daily.structuredContent?.workouts;
  assert.equal(workouts?.privacy_mode, 'summary');
  assert.equal(workouts?.disclosure, 'summary_mode_omits_individual_workouts');
  assert.deepEqual(workouts?.records, [], 'default daily summary must not return individual workout records');
  assert.equal(workouts?.count, 1, 'aggregate workout count is still available in summary mode');
});

console.log(JSON.stringify({ ok: true, privacy_leak: false, assertions: checks.length + 12 }, null, 2));
