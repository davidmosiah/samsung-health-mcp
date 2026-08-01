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
 * Two fixtures, because the two entry points read different days:
 *
 * - `fixtures/samsung_health_export` is dated 2026-05-01 and drives every call
 *   that takes an explicit `date`/`end_date`.
 * - A temp export written at run time and dated TODAY drives the resources.
 *   The resources take no arguments: `samsung-health://summary/daily` is always
 *   "today" and `summary/weekly` is always "the last 7 days", so against the
 *   May fixture they see an empty window and every leak assertion passes no
 *   matter what the code does. That is how 0.6.0 shipped a resource gate that
 *   could not fail — and it would have rotted further with time, since the
 *   weekly window can never reach back to May 2026.
 *
 * Every resource check therefore asserts NON-VACUITY first (the workout with
 * the sensitive columns is really inside the window the resource read) and
 * only then asserts the payload is clean.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

const EXERCISE_HEADER = 'start_time,end_time,exercise_type,duration,distance,distance_unit,calorie,start_latitude,start_longitude,end_latitude,end_longitude,max_altitude,deviceuuid,com.samsung.health.exercise.custom,source_name';

function isoDayOffset(offsetDays) {
  const date = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate() + offsetDays
  ));
  return date.toISOString().slice(0, 10);
}

/**
 * A synthetic export dated TODAY (UTC), so the argument-less resources really
 * read the record carrying the sensitive columns. Rows for yesterday/today/
 * tomorrow at 12:00Z: the middle of the day is far from either boundary, and
 * the neighbouring days keep the test deterministic if the UTC date rolls over
 * mid-run. All coordinates are obviously fake.
 */
function writeTodayExport() {
  const dir = mkdtempSync(join(tmpdir(), 'samsung-health-mcp-today-'));
  const today = isoDayOffset(0);
  const rows = [-1, 0, 1].map((offset) => {
    const day = isoDayOffset(offset);
    return `${day}T12:00:00+00:00,${day}T12:32:00+00:00,running,1920000,5200,m,410,-11.111111,-22.222222,-33.333333,-44.444444,999.9,FAKE-DEVICE-UUID-0000-SYNTHETIC,SYNTHETIC-FREE-TEXT-NOTE,Galaxy Watch`;
  });
  const fileName = `com.samsung.health.exercise.${today.slice(0, 4)}${today.slice(5, 7)}.csv`;
  writeFileSync(join(dir, fileName), `${EXERCISE_HEADER}\n${rows.join('\n')}\n`);
  return dir;
}

const todayExportPath = writeTodayExport();

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

function parseResource(label, resource) {
  const text = resource.contents?.[0]?.text;
  assert.ok(text, `${label} returned no content`);
  return JSON.parse(text);
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

// 1. Tools, every server-level privacy mode, both response formats.
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

      const weekly = await client.callTool({
        name: 'samsung_health_weekly_summary',
        arguments: { end_date: '2026-05-01', days: 7, timezone: 'America/Fortaleza', privacy_mode: callMode, response_format: 'json' }
      });
      assert.equal(weekly.isError ?? false, false, `weekly_summary rejected privacy_mode=${callMode}: ${JSON.stringify(weekly.content)}`);
      assertResultClean(`weekly_summary ${label} call_mode=${callMode}`, weekly);
      checks.push(`weekly_summary/${serverMode ?? 'default'}/call=${callMode}`);
    }

    // 3. The record-level tools: metadata is allowlisted at parse time, so even
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

// 4. The resource path, against an export dated TODAY so the resources actually
//    reach the record with the sensitive columns. Each check proves it is not
//    vacuous before it proves the payload is clean: without the count/date
//    assertions these blocks would pass against any code at all, which is
//    exactly the hole this round closes.
for (const serverMode of [undefined, 'summary', 'structured', 'raw']) {
  await withClient({
    SAMSUNG_HEALTH_EXPORT_PATH: todayExportPath,
    SAMSUNG_HEALTH_PRIVACY_MODE: serverMode ?? ''
  }, async (client) => {
    const label = `server privacy_mode=${serverMode ?? 'default'} (today export)`;

    const dailyResource = await client.readResource({ uri: 'samsung-health://summary/daily' });
    const daily = parseResource(`resource summary/daily ${label}`, dailyResource);
    assert.equal(
      daily.workouts?.count,
      1,
      `resource summary/daily ${label} read an empty window (date=${daily.date}) — the leak assertion below would be vacuous`
    );
    assertClean(`resource summary/daily ${label}`, dailyResource.contents);
    checks.push(`resource:summary/daily/${serverMode ?? 'default'}`);

    const weeklyResource = await client.readResource({ uri: 'samsung-health://summary/weekly' });
    const weekly = parseResource(`resource summary/weekly ${label}`, weeklyResource);
    assert.ok(
      (weekly.totals?.workouts ?? 0) >= 1,
      `resource summary/weekly ${label} read an empty window (${weekly.start_date}..${weekly.end_date}) — the leak assertion below would be vacuous`
    );
    assertClean(`resource summary/weekly ${label}`, weeklyResource.contents);
    checks.push(`resource:summary/weekly/${serverMode ?? 'default'}`);

    // Same story for the argument-less tool call an agent makes by default:
    // no `date` means today, which the May fixture can never cover.
    const dailyToday = await client.callTool({ name: 'samsung_health_daily_summary', arguments: { privacy_mode: 'raw', response_format: 'json' } });
    assert.equal(dailyToday.structuredContent?.workouts?.count, 1, `daily_summary (no date) ${label} read an empty window`);
    assertResultClean(`daily_summary no-date raw ${label}`, dailyToday);
    checks.push(`daily_summary/no-date/${serverMode ?? 'default'}`);

    const inventory = await client.callTool({ name: 'samsung_health_data_inventory', arguments: { privacy_mode: 'raw', response_format: 'json' } });
    assert.ok((inventory.structuredContent?.totals?.workouts ?? 0) >= 1, `data_inventory ${label} saw no workouts`);
    assertResultClean(`data_inventory raw ${label} (today export)`, inventory);
    checks.push(`data_inventory/today/${serverMode ?? 'default'}`);
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

// 6. The weekly rollup always aggregates — but it must say so instead of
//    echoing back a privacy mode it never applied. Reporting only
//    privacy_mode:"summary" to a caller who asked for "raw" is a false
//    statement to the agent: it cannot tell an override from an empty export.
await withClient({ SAMSUNG_HEALTH_PRIVACY_MODE: 'summary' }, async (client) => {
  for (const requested of ['structured', 'raw']) {
    const weekly = await client.callTool({
      name: 'samsung_health_weekly_summary',
      arguments: { end_date: '2026-05-01', days: 7, timezone: 'America/Fortaleza', privacy_mode: requested, response_format: 'json' }
    });
    const summary = weekly.structuredContent;
    assert.equal(weekly.isError ?? false, false, `weekly_summary rejected privacy_mode=${requested}`);
    assert.equal(summary?.requested_privacy_mode, requested, `weekly_summary did not report the requested privacy_mode=${requested}`);
    assert.equal(summary?.privacy_mode, 'summary', 'weekly_summary must report the mode it actually applied');
    assert.match(
      String(summary?.privacy_disclosure ?? ''),
      new RegExp(`always_aggregates_requested_privacy_mode_${requested}_was_not_applied`),
      `weekly_summary did not disclose that privacy_mode=${requested} was overridden`
    );
    // The override is real: no individual workout records, whatever was asked.
    for (const day of summary?.daily ?? []) {
      assert.equal(day.workouts?.privacy_mode, 'summary', 'weekly daily entries must report the applied mode');
      assert.deepEqual(day.workouts?.records, [], 'weekly summary must never return individual workout records');
    }
    checks.push(`weekly_summary/disclosure/requested=${requested}`);
  }

  // Asking for the mode that is actually applied gets a plain disclosure, not
  // an override warning.
  const weekly = await client.callTool({
    name: 'samsung_health_weekly_summary',
    arguments: { end_date: '2026-05-01', days: 7, timezone: 'America/Fortaleza', privacy_mode: 'summary', response_format: 'json' }
  });
  assert.equal(weekly.structuredContent?.requested_privacy_mode, 'summary');
  assert.equal(weekly.structuredContent?.privacy_disclosure, 'weekly_summary_always_aggregates_individual_workouts_are_never_returned');
  checks.push('weekly_summary/disclosure/requested=summary');
});

console.log(JSON.stringify({ ok: true, privacy_leak: false, assertions: checks.length + 12 }, null, 2));
