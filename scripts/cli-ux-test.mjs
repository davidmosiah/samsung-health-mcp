import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'samsung-health-mcp-cli-'));
const exportPath = resolve('fixtures/samsung_health_export');

try {
  const version = spawnSync(process.execPath, ['dist/index.js', '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^\d+\.\d+\.\d+/);

  const help = spawnSync(process.execPath, ['dist/index.js', 'help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /SAMSUNG_HEALTH_EXPORT_PATH/);

  const setup = spawnSync(process.execPath, [
    'dist/index.js',
    'setup',
    '--export-path',
    exportPath,
    '--json'
  ], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home }
  });
  assert.equal(setup.status, 0, setup.stderr);
  const payload = JSON.parse(setup.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.export_path, exportPath);
  assert.ok(existsSync(payload.config_path));
  assert.match(readFileSync(payload.config_path, 'utf8'), /SAMSUNG_HEALTH_EXPORT_PATH/);

  const doctor = spawnSync(process.execPath, ['dist/index.js', 'doctor', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home }
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  const status = JSON.parse(doctor.stdout);
  assert.equal(status.ok, true);
  assert.equal(status.export.exists, true);

  const autoHome = mkdtempSync(join(tmpdir(), 'samsung-health-mcp-cli-auto-'));
  mkdirSync(join(autoHome, 'Downloads'), { recursive: true });
  cpSync(exportPath, join(autoHome, 'Downloads', 'Samsung Health'), { recursive: true });
  const autoSetup = spawnSync(process.execPath, [
    'dist/index.js',
    'setup',
    '--auto-import',
    '--json'
  ], {
    encoding: 'utf8',
    env: { ...process.env, HOME: autoHome }
  });
  assert.equal(autoSetup.status, 0, autoSetup.stderr);
  const autoPayload = JSON.parse(autoSetup.stdout);
  assert.ok(autoPayload.import.imported_path.includes('.samsung-health-mcp/exports/samsung-health-export-'));
  assert.ok(existsSync(autoPayload.import.imported_path));
  assert.match(readFileSync(autoPayload.config_path, 'utf8'), /SAMSUNG_HEALTH_LAST_IMPORT_AT/);
  rmSync(autoHome, { recursive: true, force: true });

  console.log(JSON.stringify({ ok: true, cli_ux: true, setup: true, doctor: true }, null, 2));
} finally {
  rmSync(home, { recursive: true, force: true });
}
