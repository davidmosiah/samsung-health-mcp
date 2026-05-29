import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  reconcileWatchFolder,
  getWatchStatus,
  findLatestExportInFolder,
  resolveWatchPath
} from '../dist/services/watch.js';
import { getConfig } from '../dist/services/config.js';
import { mergeLocalConfig, readLocalConfig } from '../dist/services/local-config.js';
import { buildDailySummary } from '../dist/services/summary.js';
import { clearSnapshotCache } from '../dist/services/samsung-health-export.js';

// Isolated env: no ambient SAMSUNG_HEALTH_* leaking from the shell.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('SAMSUNG_HEALTH_'))
);

const home = mkdtempSync(join(tmpdir(), 'samsung-health-watch-'));
const watchDir = join(home, 'watch');
mkdirSync(watchDir, { recursive: true });

// Helper: write a SamsungHealth export folder with a single step_count CSV for `date`
// with `steps` total, and stamp its mtime so newer/older ordering is deterministic.
function writeExport(name, date, steps, mtimeSeconds) {
  const dir = join(watchDir, name);
  mkdirSync(dir, { recursive: true });
  const csv = join(dir, 'com.samsung.health.step_count.202605.csv');
  writeFileSync(
    csv,
    `start_time,end_time,count,source_name\n${date}T07:00:00-03:00,${date}T08:00:00-03:00,${steps},Galaxy Watch\n`,
    'utf8'
  );
  const t = new Date(mtimeSeconds * 1000);
  utimesSync(csv, t, t);
  utimesSync(dir, t, t);
  return dir;
}

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}: ${error.message}`);
  }
}

try {
  // ---------- 1. No watch folder configured ----------
  {
    const result = await reconcileWatchFolder({ env: cleanEnv, homeDir: home });
    check('no watch folder -> reason no_watch_folder, no change', () => {
      assert.equal(result.changed, false);
      assert.equal(result.reason, 'no_watch_folder');
    });
    const status = await getWatchStatus({ env: cleanEnv, homeDir: home });
    check('getWatchStatus reports not configured', () => {
      assert.equal(status.configured, false);
    });
  }

  // ---------- 2. Configure a watch folder that exists but is empty ----------
  mergeLocalConfig({ SAMSUNG_HEALTH_WATCH_PATH: watchDir }, home);
  {
    const resolved = resolveWatchPath(cleanEnv, home);
    check('resolveWatchPath resolves configured folder', () => {
      assert.equal(resolved, watchDir);
    });
    const result = await reconcileWatchFolder({ env: cleanEnv, homeDir: home });
    check('empty watch folder -> no_export_in_folder', () => {
      assert.equal(result.changed, false);
      assert.equal(result.reason, 'no_export_in_folder');
    });
  }

  // ---------- 3. Drop a fresh export -> promoted ----------
  const exportA = writeExport('SamsungHealth-A', '2026-05-10', 4321, 1_700_000_000);
  {
    const result = await reconcileWatchFolder({ env: cleanEnv, homeDir: home });
    check('fresh export -> promoted_new_export + changed', () => {
      assert.equal(result.changed, true);
      assert.equal(result.reason, 'promoted_new_export');
      assert.equal(result.active_export_path, exportA);
      assert.ok(result.reimported_at, 'reimported_at set');
    });

    const local = readLocalConfig(home);
    check('local config now points SAMSUNG_HEALTH_EXPORT_PATH at the export', () => {
      assert.equal(local.SAMSUNG_HEALTH_EXPORT_PATH, exportA);
      assert.equal(local.SAMSUNG_HEALTH_LAST_WATCH_IMPORT_PATH, exportA);
      assert.ok(local.SAMSUNG_HEALTH_LAST_WATCH_IMPORT_AT);
    });

    // The whole point: a summary built from the now-active export reflects the data.
    const config = getConfig(cleanEnv, home);
    const summary = await buildDailySummary(config.exportPath, '2026-05-10', { timezone: 'America/Fortaleza' });
    check('daily_summary reflects the promoted export (steps = 4321)', () => {
      assert.equal(summary.totals.steps, 4321);
    });
  }

  // ---------- 4. Idempotent: reconcile again with no change ----------
  {
    const result = await reconcileWatchFolder({ env: cleanEnv, homeDir: home });
    check('no folder change -> already_current, no change', () => {
      assert.equal(result.changed, false);
      assert.equal(result.reason, 'already_current');
    });
  }

  // ---------- 5. Drop a NEWER export -> promoted + summary refreshes ----------
  const exportB = writeExport('SamsungHealth-B', '2026-05-10', 9876, 1_700_100_000);
  {
    const status = await getWatchStatus({ env: cleanEnv, homeDir: home });
    check('getWatchStatus flags active export is NOT latest', () => {
      assert.equal(status.configured, true);
      assert.equal(status.watch_path_exists, true);
      assert.equal(status.latest_export?.path, exportB);
      assert.equal(status.active_export_is_latest, false);
    });

    const result = await reconcileWatchFolder({ env: cleanEnv, homeDir: home });
    check('newer export -> promoted (changed) to exportB', () => {
      assert.equal(result.changed, true);
      assert.ok(['promoted_new_export', 'promoted_updated_export'].includes(result.reason));
      assert.equal(result.active_export_path, exportB);
    });

    // Snapshot cache cleared by reconcile, so the new export's data is visible.
    const config = getConfig(cleanEnv, home);
    const summary = await buildDailySummary(config.exportPath, '2026-05-10', { timezone: 'America/Fortaleza' });
    check('daily_summary now reflects the NEWER export (steps = 9876)', () => {
      assert.equal(summary.totals.steps, 9876);
    });
  }

  // ---------- 6. check_only / getWatchStatus after promotion: active IS latest ----------
  {
    const status = await getWatchStatus({ env: cleanEnv, homeDir: home });
    check('after promotion active_export_is_latest is true', () => {
      assert.equal(status.active_export_is_latest, true);
      assert.equal(status.latest_export?.path, exportB);
    });
  }

  // ---------- 7. force re-promote even when already current ----------
  {
    const result = await reconcileWatchFolder({ env: cleanEnv, homeDir: home, force: true });
    check('force=true re-promotes current export (changed)', () => {
      assert.equal(result.changed, true);
      assert.equal(result.active_export_path, exportB);
    });
  }

  // ---------- 8. watch folder missing on disk ----------
  {
    mergeLocalConfig({ SAMSUNG_HEALTH_WATCH_PATH: join(home, 'does-not-exist') }, home);
    const result = await reconcileWatchFolder({ env: cleanEnv, homeDir: home });
    check('missing watch folder -> watch_folder_missing', () => {
      assert.equal(result.changed, false);
      assert.equal(result.reason, 'watch_folder_missing');
    });
    // restore for findLatestExportInFolder check
    mergeLocalConfig({ SAMSUNG_HEALTH_WATCH_PATH: watchDir }, home);
  }

  // ---------- 9. findLatestExportInFolder picks newest by mtime ----------
  {
    const latest = await findLatestExportInFolder(watchDir);
    check('findLatestExportInFolder returns the newest export (exportB)', () => {
      assert.equal(latest?.path, exportB);
      assert.ok((latest?.csv_count ?? 0) >= 1);
    });
  }

  clearSnapshotCache();
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\nwatch-folder-test: ${failures} assertion group(s) failed.`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, watch_folder: true }, null, 2));
