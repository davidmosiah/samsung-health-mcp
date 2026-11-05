/**
 * Overlapping same-type workouts (PR19 follow-up).
 *
 * Overlap alone cannot tell a phone/app copy from two real sessions, so the
 * default keeps every workout and only reports likely copies in
 * `workouts.possible_duplicates`. With merge_overlapping_workouts on, a workout
 * covering at least 80% of a longer same-type one counts once. Back-to-back and
 * half-overlapping sessions are never flagged. Synthetic data only.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDailySummary, buildWeeklySummary } from '../dist/services/summary.js';
import { getConfig, parseFlag } from '../dist/services/config.js';
import { DailySummaryInputSchema, WeeklySummaryInputSchema } from '../dist/schemas/common.js';

const root = await mkdtemp(join(tmpdir(), 'samsung-overlapping-workouts-'));
try {
  const exportPath = join(root, 'com.samsung.health.exercise.202605.csv');
  await writeFile(exportPath, [
    'start_time,end_time,time_offset,exercise_type,duration',
    // Back-to-back walks, 30 min each.
    '2026-05-04 13:00:00,2026-05-04 13:30:00,UTC-0300,1001,1800000',
    '2026-05-04 13:30:00,2026-05-04 14:00:00,UTC-0300,1001,1800000',
    // Two 40 min runs sharing 20 min: half of each.
    '2026-05-04 15:00:00,2026-05-04 15:40:00,UTC-0300,1002,2400000',
    '2026-05-04 15:20:00,2026-05-04 16:00:00,UTC-0300,1002,2400000',
    // One run from the watch and its minute-rounded copy written by another app.
    '2026-05-04 18:00:30.500,2026-05-04 18:40:31,UTC-0300,1002,2400500',
    '2026-05-04 18:00:00,2026-05-04 18:40:00,UTC-0300,1002,2400000',
    ''
  ].join('\n'));
  const timezone = 'America/Sao_Paulo';

  // Default: nothing is merged, the copy is only reported.
  const reported = await buildDailySummary(exportPath, '2026-05-04', { timezone });
  assert.equal(reported.workouts.count, 6, 'default counts every recorded workout');
  assert.equal(reported.workouts.total_duration_minutes, 220.01);
  assert.equal(reported.workouts.possible_duplicates, 1, 'only the minute-rounded copy looks like a duplicate');
  assert.equal(reported.workouts.merge_overlapping_workouts, false);
  assert.ok(reported.notes.some((note) => note.includes('merge_overlapping_workouts=true')), 'the summary says how to merge');

  // Opt-in: the copy counts once; back-to-back and half-overlapping sessions stay.
  const merged = await buildDailySummary(exportPath, '2026-05-04', { timezone, mergeOverlappingWorkouts: true });
  assert.equal(merged.workouts.count, 5);
  assert.equal(merged.workouts.total_duration_minutes, 180.01, '30 + 30 + 40 + 40 + the longer copy (40.01)');
  assert.equal(merged.workouts.possible_duplicates, 1);
  assert.equal(merged.workouts.merge_overlapping_workouts, true);
  assert.equal(merged.workouts.activity_counts['1002'], 3);
  assert.ok(!merged.notes.some((note) => note.includes('merge_overlapping_workouts=true')));

  // Weekly rollup reports the same and follows the switch.
  const week = await buildWeeklySummary(exportPath, '2026-05-04', 1, { timezone });
  assert.equal(week.totals.workouts, 6);
  assert.equal(week.totals.possible_duplicate_workouts, 1);
  assert.equal(week.merge_overlapping_workouts, false);
  const mergedWeek = await buildWeeklySummary(exportPath, '2026-05-04', 1, { timezone, mergeOverlappingWorkouts: true });
  assert.equal(mergedWeek.totals.workouts, 5);
  assert.equal(mergedWeek.merge_overlapping_workouts, true);

  // The switch is off unless set explicitly, and the tools accept it.
  const emptyHome = join(root, 'home');
  assert.equal(getConfig({}, emptyHome).mergeOverlappingWorkouts, false);
  assert.equal(getConfig({ SAMSUNG_HEALTH_MERGE_OVERLAPPING_WORKOUTS: 'true' }, emptyHome).mergeOverlappingWorkouts, true);
  assert.equal(getConfig({ SAMSUNG_HEALTH_MERGE_OVERLAPPING_WORKOUTS: 'no' }, emptyHome).mergeOverlappingWorkouts, false);
  assert.equal(parseFlag(' 1 '), true);
  assert.equal(parseFlag(''), false);
  assert.equal(DailySummaryInputSchema.parse({ merge_overlapping_workouts: true }).merge_overlapping_workouts, true);
  assert.equal(WeeklySummaryInputSchema.parse({}).merge_overlapping_workouts, undefined);

  console.log('Overlapping workouts PASS: reported by default, merged only on opt-in, back-to-back and half-overlapping sessions kept.');
} finally {
  await rm(root, { recursive: true, force: true });
}
