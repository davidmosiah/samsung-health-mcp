/**
 * Regression gate for record-type precedence and the 48h date pre-filter.
 *
 * Canonical `com.samsung.(shealth|health).*` filenames are already typed by
 * `samsungDataTypeFromFile` (#11). The remaining hole is a non-canonical name
 * whose sibling columns outvote the file (`oxygen_saturation.csv` carrying
 * `heart_rate`). The pre-filter must never drop a row that `overlaps()` would
 * keep: time_offset, ms/second epochs, unparseable dates, and two `_start_time`
 * suffix columns that `findEntry` resolves by shortest key.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearSnapshotCache,
  getExportSnapshot,
  listRecords,
  parseSamsungDate,
  recordOverlaps
} from '../dist/services/samsung-health-export.js';

function writeExport(files) {
  const dir = mkdtempSync(join(tmpdir(), 'samsung-health-mcp-reg-'));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

async function withExport(files, fn) {
  const dir = writeExport(files);
  try {
    clearSnapshotCache();
    return await fn(dir);
  } finally {
    clearSnapshotCache();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function recordTypes(files) {
  return withExport(files, async (dir) => {
    const records = await listRecords({ exportPath: dir, limit: 50 });
    return records.map((record) => record.type);
  });
}

const SPO2_WITH_HR = [
  'start_time,oxygen_saturation,heart_rate,source_name',
  '2026-05-01T12:00:00Z,97,68,Galaxy Watch',
  ''
].join('\n');

// File name first: sibling heart_rate must not steal SpO2 or sleep rows.
assert.deepEqual(
  await recordTypes({ 'com.samsung.shealth.tracker.oxygen_saturation.csv': SPO2_WITH_HR }),
  ['samsung_health_oxygen_saturation']
);
assert.deepEqual(
  await recordTypes({ 'oxygen_saturation.csv': SPO2_WITH_HR }),
  ['samsung_health_oxygen_saturation']
);
assert.deepEqual(
  await recordTypes({
    'sleep.csv': [
      'start_time,end_time,sleep_stage,step_count,source_name',
      '2026-05-01T00:00:00Z,2026-05-01T07:00:00Z,asleep,0,Galaxy Watch',
      ''
    ].join('\n')
  }),
  ['samsung_health_sleep']
);
assert.deepEqual(
  await recordTypes({
    'heart_rate.csv': [
      'start_time,heart_rate,oxygen_saturation,source_name',
      '2026-05-01T12:00:00Z,70,96,Galaxy Watch',
      ''
    ].join('\n')
  }),
  ['samsung_health_heart_rate']
);
assert.deepEqual(
  await recordTypes({
    'mystery.csv': [
      'start_time,heart_rate,source_name',
      '2026-05-01T12:00:00Z,64,Galaxy Watch',
      ''
    ].join('\n')
  }),
  ['samsung_health_heart_rate']
);
assert.deepEqual(
  await recordTypes({
    'hrv.csv': [
      'start_time,heart_rate,heart_rate_variability,source_name',
      '2026-05-01T12:00:00Z,60,72,Galaxy Watch',
      ''
    ].join('\n')
  }),
  ['samsung_health_hrv']
);

const may1 = '2026-05-01T00:00:00.000Z';
const may2 = '2026-05-02T00:00:00.000Z';
const may1Ms = Date.UTC(2026, 4, 1);
const jan1Ms = Date.UTC(2026, 0, 1);

await withExport({
  'heart_rate.csv': [
    'start_time,end_time,time_offset,heart_rate,source_name',
    // In-range ISO with offset (existing fixture shape).
    '2026-05-01 08:05:00.000,2026-05-01 08:06:00.000,UTC-0300,62,Galaxy Watch',
    // In range only after UTC-12 is applied: raw UTC is 12h before the window.
    '2026-04-30 12:00:00,2026-04-30 12:01:00,UTC-1200,63,Galaxy Watch',
    // UTC+14 raw looks 14h after the window end; actual UTC is still May 1.
    '2026-05-02 13:00:00,2026-05-02 13:01:00,UTC+1400,64,Galaxy Watch',
    // Exact window edges must survive the slack pre-filter.
    '2026-05-01T00:00:00.000Z,2026-05-01T00:01:00.000Z,,65,Galaxy Watch',
    '2026-05-01T23:59:59.000Z,2026-05-01T23:59:59.000Z,,66,Galaxy Watch',
    // Milliseconds and seconds epochs for May 1.
    `${may1Ms},, ,67,Galaxy Watch`,
    `${may1Ms / 1000},, ,68,Galaxy Watch`,
    // Unparseable start: pre-filter must keep the row; overlaps then drops it
    // because there is no usable date. Visible only on the unfiltered snapshot.
    'not-a-date,,,69,Galaxy Watch',
    // Empty start, in-range end: pre-filter keeps (empty start text).
    ',2026-05-01T15:00:00.000Z,,70,Galaxy Watch',
    // Far outside any 48h slack — must not leak into a ranged query.
    '2020-01-01T00:00:00.000Z,2020-01-01T00:01:00.000Z,,50,Galaxy Watch',
    `${jan1Ms},, ,51,Galaxy Watch`,
    '2026-07-01T00:00:00.000Z,2026-07-01T00:01:00.000Z,,52,Galaxy Watch',
    ''
  ].join('\n')
}, async (dir) => {
  const ranged = await listRecords({
    exportPath: dir,
    type: 'samsung_health_heart_rate',
    start: may1,
    end: '2026-05-01T23:59:59.999Z',
    limit: 50
  });
  const values = ranged.map((record) => record.numeric_value).sort((a, b) => a - b);
  assert.deepEqual(values, [62, 63, 64, 65, 66, 67, 68, 70]);

  const offsetMinus12 = ranged.find((record) => record.numeric_value === 63);
  assert.equal(offsetMinus12?.startDate, '2026-05-01T00:00:00.000Z');
  const offsetPlus14 = ranged.find((record) => record.numeric_value === 64);
  assert.equal(offsetPlus14?.startDate, '2026-05-01T23:00:00.000Z');

  clearSnapshotCache();
  const full = await getExportSnapshot({ exportPath: dir });
  const start = parseSamsungDate(may1);
  const end = parseSamsungDate('2026-05-01T23:59:59.999Z');
  const handFiltered = full.records.filter((record) => recordOverlaps(record.startDate, record.endDate, start, end));
  assert.equal(full.records.length >= 11, true, 'unfiltered snapshot still materializes out-of-range rows');
  assert.ok(full.records.some((record) => record.numeric_value === 50));
  assert.ok(full.records.some((record) => record.numeric_value === 69), 'unparseable dates still parse when no range is set');

  clearSnapshotCache();
  const rangedSnapshot = await getExportSnapshot({
    exportPath: dir,
    start: may1,
    end: '2026-05-01T23:59:59.999Z'
  });
  assert.equal(rangedSnapshot.records.length, handFiltered.length);
  assert.deepEqual(
    rangedSnapshot.records.map((record) => record.numeric_value).sort((a, b) => a - b),
    handFiltered.map((record) => record.numeric_value).sort((a, b) => a - b)
  );
});

// Two `_start_time` suffixes, no exact `start_time`. findEntry picks the
// shortest key. The long prefixed column is years away; if the pre-filter
// used header order instead, it would drop the in-range row.
await withExport({
  'heart_rate.csv': [
    'com.samsung.health.heart_rate.start_time,x_start_time,heart_rate,source_name',
    '2020-01-01T00:00:00.000Z,2026-05-01T12:00:00.000Z,77,Galaxy Watch',
    ''
  ].join('\n')
}, async (dir) => {
  const records = await listRecords({
    exportPath: dir,
    type: 'samsung_health_heart_rate',
    start: may1,
    end: may2,
    limit: 10
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.numeric_value, 77);
  assert.equal(records[0]?.startDate, '2026-05-01T12:00:00.000Z');
});

// parseCsv wrapper: BOM, Samsung preamble, semicolon delimiter, quoted comma.
await withExport({
  'oxygen_saturation.csv': `\uFEFFcom.samsung.shealth.tracker.oxygen_saturation;7006003;6.30.2
start_time;oxygen_saturation;heart_rate;note
"2026-05-01T12:00:00Z";97;68;"quoted, comma"
`
}, async (dir) => {
  const records = await listRecords({ exportPath: dir, limit: 10 });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.type, 'samsung_health_oxygen_saturation');
  assert.equal(records[0]?.numeric_value, 97);
  assert.equal(records[0]?.startDate, '2026-05-01T12:00:00.000Z');
});

console.log(JSON.stringify({
  ok: true,
  export_parser_regression: true,
  cases: [
    'canonical_tracker_oxygen_with_heart_rate_column',
    'noncanonical_oxygen_filename_with_heart_rate_column',
    'sleep_filename_with_step_column',
    'heart_rate_filename_with_oxygen_column',
    'column_fallback_heart_rate',
    'hrv_before_heart_rate',
    'time_offset_utc_minus_12_and_plus_14',
    'range_edge_inclusive',
    'ms_and_second_epoch',
    'empty_start_uses_end',
    'unfiltered_keeps_far_and_unparseable_rows',
    'ranged_count_matches_hand_filter',
    'shortest_suffix_date_column',
    'parse_csv_bom_preamble_semicolon'
  ]
}, null, 2));
