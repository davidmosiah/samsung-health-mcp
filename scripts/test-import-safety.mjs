import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { discoverLatestExport, importSamsungHealthExport } from '../dist/services/import-export.js';
import { listRecords } from '../dist/services/samsung-health-export.js';

const root = mkdtempSync(join(realpathSync(tmpdir()), 'samsung-import-safety-'));
const csvName = 'com.samsung.health.step_count.202605.csv';
const csv = 'start_time,count\n2026-05-01T12:00:00Z,123\n';
function write(path, bytes) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
function snapshot(path) {
  let stat;
  try { stat = lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const mode = stat.mode & 0o777;
  if (stat.isSymbolicLink()) return { mode, link: readlinkSync(path) };
  if (stat.isDirectory()) return { mode, entries: Object.fromEntries(readdirSync(path).sort().map(name => [name, snapshot(join(path, name))])) };
  if (stat.isFile()) return { mode, bytes: readFileSync(path).toString('base64') };
  return { mode, special: true };
}
function crc32(data) { let c = 0xffffffff; for (const n of data) { c ^= n; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
// One-entry, stored ZIP made entirely from synthetic CSV bytes.
function zip(nameText, text) {
  const name = Buffer.from(nameText), data = Buffer.from(text), crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

let rejectedCases = 0;
try {
  const home = join(root, 'valid-home'); mkdirSync(home);
  const sourceDir = join(root, 'valid-source', 'SamsungHealth');
  const sourceCsv = join(sourceDir, csvName); write(sourceCsv, csv);
  const sourceZip = join(root, 'valid-source', 'SamsungHealth.zip'); write(sourceZip, zip(csvName, csv));
  const original = snapshot(join(root, 'valid-source'));
  const imports = [];
  for (const [source, kind] of [[sourceCsv, 'csv'], [sourceZip, 'zip'], [sourceDir, 'directory'], [sourceCsv, 'csv']]) {
    const result = await importSamsungHealthExport(source, home);
    assert.equal(result.source_kind, kind);
    assert.ok(!imports.includes(result.imported_path), 'repeated imports need unique paths');
    imports.push(result.imported_path);
    const records = await listRecords({ exportPath: result.imported_path, limit: 10 });
    assert.ok(records.length > 0, 'valid imported data must still parse');
    if (kind !== 'directory') assert.deepEqual(readFileSync(result.imported_path), readFileSync(source));
    if (process.platform !== 'win32') assert.equal(lstatSync(result.imported_path).mode & 0o777, kind === 'directory' ? 0o700 : 0o600);
  }
  assert.equal(new Set(imports).size, 4);
  assert.deepEqual(snapshot(join(root, 'valid-source')), original, 'imports must preserve source bytes and modes');

  const discoveryHome = join(root, 'discovery-home');
  const unrelated = join(discoveryHome, 'Downloads', 'UnrelatedFinance');
  write(join(unrelated, 'budget.csv'), 'category,amount\nsynthetic,10\n');
  write(join(unrelated, 'personal-note.txt'), 'Synthetic unrelated note');
  const unrelatedBefore = snapshot(unrelated);
  assert.equal(await discoverLatestExport(discoveryHome), undefined);
  assert.deepEqual(snapshot(unrelated), unrelatedBefore);
  assert.equal(snapshot(join(discoveryHome, '.samsung-health-mcp')), null);

  for (const name of ['SamsungHealth', 'Samsung Health', 'Samsung-Health', 'Samsung_Health']) {
    const folder = join(discoveryHome, 'Downloads', name);
    write(join(folder, 'steps.csv'), csv);
    assert.equal((await discoverLatestExport(discoveryHome))?.path, folder);
    rmSync(folder, { recursive: true });
  }
  const unnamed = join(discoveryHome, 'Documents', 'downloaded-export');
  write(join(unnamed, csvName), csv);
  const namedCsvDiscovery = await discoverLatestExport(discoveryHome);
  assert.ok([unnamed, join(unnamed, csvName)].includes(namedCsvDiscovery?.path));
  rmSync(unnamed, { recursive: true });
  const standalone = join(discoveryHome, 'Desktop', csvName); write(standalone, csv);
  assert.equal((await discoverLatestExport(discoveryHome))?.path, standalone); rmSync(standalone);
  for (const name of ['SamsungHealth.zip', 'samsung_health.zip', 'samsung-health.zip', 'backup-samsung-health-2026.zip']) {
    const archive = join(discoveryHome, 'Downloads', name); write(archive, zip(csvName, csv));
    assert.equal((await discoverLatestExport(discoveryHome))?.path, archive); rmSync(archive);
  }

  // Symlink privileges are not assumed on Windows. All POSIX CI fixtures run.
  if (process.platform !== 'win32') {
    const external = join(root, 'external-targets');
    const externalFile = join(external, 'private-note.txt'); write(externalFile, 'Synthetic external bytes'); chmodSync(externalFile, 0o644);
    const externalDir = join(external, 'private-directory'); write(join(externalDir, 'untouched.txt'), 'Synthetic nested bytes'); chmodSync(externalDir, 0o755);
    const externalBefore = snapshot(external);
    async function rejectsUntouched(source, caseHome) {
      mkdirSync(caseHome, { recursive: true });
      const sourceBefore = snapshot(source), homeBefore = snapshot(caseHome);
      await assert.rejects(importSamsungHealthExport(source, caseHome), /symbolic links and special files/);
      assert.deepEqual(snapshot(source), sourceBefore);
      assert.deepEqual(snapshot(caseHome), homeBefore, 'preflight must fail before copying or creating managed storage');
      assert.deepEqual(snapshot(external), externalBefore, 'external target bytes/modes must remain unchanged');
      rejectedCases++;
    }
    for (const [name, target] of [['file', externalFile], ['directory', externalDir], ['dangling', join(external, 'missing')]]) {
      const folder = join(root, `linked-${name}`, 'SamsungHealth'); write(join(folder, csvName), csv);
      symlinkSync(target, join(folder, 'linked-entry'));
      await rejectsUntouched(folder, join(root, `reject-home-${name}`));
    }
    const rootFileLink = join(root, 'SamsungHealth.csv'); symlinkSync(sourceCsv, rootFileLink);
    await rejectsUntouched(rootFileLink, join(root, 'reject-root-file'));
    const rootDirLink = join(root, 'SamsungHealth-link'); symlinkSync(sourceDir, rootDirLink);
    await rejectsUntouched(rootDirLink, join(root, 'reject-root-directory'));
    await rejectsUntouched(join(rootDirLink, csvName), join(root, 'reject-linked-ancestor'));
    for (const depth of ['config', 'exports']) {
      const targetHome = join(root, `reject-destination-${depth}`); mkdirSync(targetHome);
      const linkPath = depth === 'config' ? join(targetHome, '.samsung-health-mcp') : join(targetHome, '.samsung-health-mcp', 'exports');
      mkdirSync(dirname(linkPath), { recursive: true }); symlinkSync(externalDir, linkPath);
      await rejectsUntouched(sourceCsv, targetHome);
    }
    const fifoFolder = join(root, 'fifo-source', 'SamsungHealth'); write(join(fifoFolder, csvName), csv);
    const fifo = spawnSync('mkfifo', [join(fifoFolder, 'special-file')], { encoding: 'utf8' });
    assert.equal(fifo.status, 0, fifo.stderr);
    await rejectsUntouched(fifoFolder, join(root, 'reject-fifo'));
    const unsafeDiscovery = join(discoveryHome, 'Downloads', 'SamsungHealth'); write(join(unsafeDiscovery, csvName), csv);
    symlinkSync(externalFile, join(unsafeDiscovery, 'linked-entry'));
    // The unsafe directory is excluded; a regular Samsung CSV child can still be selected safely.
    assert.notEqual((await discoverLatestExport(discoveryHome))?.path, unsafeDiscovery);
    assert.deepEqual(snapshot(external), externalBefore);
  }
  console.log(JSON.stringify({ ok: true, suite: 'import-safety', validImports: 4, uniquePaths: true, genericCsvIgnored: true, rejectedCases, realData: false, concurrentPathSwapProtectionClaimed: false }));
} finally { rmSync(root, { recursive: true, force: true }); }
