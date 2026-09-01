import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync, utimesSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Isolated HOME so the test never touches a real ~/.samsung-health-mcp cache.
const fakeHome = mkdtempSync(join(tmpdir(), 'samsung-health-mcp-cache-test-'));
const cachePath = join(fakeHome, '.samsung-health-mcp', 'incremental-cache.json');
const exportPath = resolve('fixtures/samsung_health_export');

async function newClient() {
  const client = new Client({ name: 'samsung-health-incremental-cache-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      ...process.env,
      HOME: fakeHome,
      SAMSUNG_HEALTH_EXPORT_PATH: exportPath
    }
  });
  await client.connect(transport);
  return client;
}

const client = await newClient();
try {
  // 1. Cache file does not exist before first use.
  assert.equal(existsSync(cachePath), false, 'cache file should not exist before first call');

  const initialStatus = await client.callTool({
    name: 'samsung_health_connection_status',
    arguments: { response_format: 'json' }
  });
  assert.equal(initialStatus.structuredContent?.incremental_cache?.exists, false);
  assert.equal(initialStatus.structuredContent?.incremental_cache?.category_count, 0);

  // 2. First list_records call with incremental_cache=true: seeds the cache.
  const first = await client.callTool({
    name: 'samsung_health_list_records',
    arguments: {
      type: 'samsung_health_steps',
      limit: 50,
      incremental_cache: true,
      privacy_mode: 'raw',
      response_format: 'json'
    }
  });
  assert.equal(first.structuredContent?.count, 4, 'first call should return all 4 aggregate step records');
  assert.equal(existsSync(cachePath), true, 'cache file should be created');

  const cache1 = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.ok(cache1.categories?.samsung_health_steps, 'should persist last_parsed_at for the step category');
  assert.equal(typeof cache1.export_mtime_ms, 'number');
  assert.equal(typeof cache1.export_path, 'string');

  // 3. Second call with same cache: should skip already-parsed records.
  const second = await client.callTool({
    name: 'samsung_health_list_records',
    arguments: {
      type: 'samsung_health_steps',
      limit: 50,
      incremental_cache: true,
      privacy_mode: 'raw',
      response_format: 'json'
    }
  });
  assert.equal(second.structuredContent?.count, 0, 'second call should skip all already-seen records');

  // 4. Connection status now shows the cache populated.
  const statusWithCache = await client.callTool({
    name: 'samsung_health_connection_status',
    arguments: { response_format: 'json' }
  });
  assert.equal(statusWithCache.structuredContent?.incremental_cache?.exists, true);
  assert.ok(statusWithCache.structuredContent?.incremental_cache?.category_count >= 1);
  const stepEntry = statusWithCache.structuredContent?.incremental_cache?.categories
    ?.find((c) => c.category === 'samsung_health_steps');
  assert.ok(stepEntry, 'connection status should list the step category');
  assert.ok(stepEntry.last_parsed_at, 'step category should have a last_parsed_at');

  // 5. Without incremental_cache=true, behavior unchanged (returns full set).
  const fullRescan = await client.callTool({
    name: 'samsung_health_list_records',
    arguments: {
      type: 'samsung_health_steps',
      limit: 50,
      privacy_mode: 'raw',
      response_format: 'json'
    }
  });
  assert.equal(fullRescan.structuredContent?.count, 4, 'non-incremental call should still return all 4 records');

  // 6. mtime change on any CSV inside the directory invalidates the cache.
  const dirStat = statSync(exportPath);
  const futureTime = new Date(dirStat.mtimeMs + 5000);
  utimesSync(exportPath, futureTime, futureTime);

  const afterMtimeChange = await client.callTool({
    name: 'samsung_health_list_records',
    arguments: {
      type: 'samsung_health_steps',
      limit: 50,
      incremental_cache: true,
      privacy_mode: 'raw',
      response_format: 'json'
    }
  });
  assert.equal(afterMtimeChange.structuredContent?.count, 4, 'mtime change should invalidate cache and re-parse');

  // 7. Clear-cache tool wipes the cache state.
  const clear = await client.callTool({
    name: 'samsung_health_clear_incremental_cache',
    arguments: { response_format: 'json' }
  });
  assert.equal(clear.structuredContent?.ok, true);
  assert.equal(clear.structuredContent?.existed, true);

  const afterClear = await client.callTool({
    name: 'samsung_health_list_records',
    arguments: {
      type: 'samsung_health_steps',
      limit: 50,
      incremental_cache: true,
      privacy_mode: 'raw',
      response_format: 'json'
    }
  });
  assert.equal(afterClear.structuredContent?.count, 4, 'after clear, should re-parse from beginning');

  // 8. Unknown category does not appear in cache stats.
  const unknownCategoryStats = await client.callTool({
    name: 'samsung_health_connection_status',
    arguments: { response_format: 'json' }
  });
  const unknownEntry = unknownCategoryStats.structuredContent?.incremental_cache?.categories
    ?.find((c) => c.category === 'samsung_health_NONE');
  assert.equal(unknownEntry, undefined);

  console.log(JSON.stringify({ ok: true, incremental_cache: true, scenarios: 8 }, null, 2));
} finally {
  await client.close();
}
