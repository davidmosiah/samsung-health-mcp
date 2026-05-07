import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildAgentManifest } from '../dist/services/agent-manifest.js';

const exportPath = resolve('fixtures/samsung_health_export');
const client = new Client({ name: 'samsung-health-agent-readiness-test', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: { ...process.env, SAMSUNG_HEALTH_EXPORT_PATH: exportPath }
});

try {
  for (const target of ['claude', 'codex', 'cursor', 'hermes', 'openclaw']) {
    const manifest = buildAgentManifest(target);
    assert.equal(manifest.client, target);
    assert.ok(manifest.recommended_first_calls.includes('samsung_health_connection_status'));
    assert.ok(manifest.recommended_first_calls.includes('samsung_health_data_inventory'));
    assert.ok(manifest.recommended_first_calls.includes('samsung_health_wellness_context'));
  }

  await client.connect(transport);

  const status = await client.callTool({
    name: 'samsung_health_connection_status',
    arguments: { client: 'hermes', response_format: 'json' }
  });
  assert.equal(status.structuredContent?.ok, true);
  assert.equal(status.structuredContent?.client, 'hermes');
  assert.equal(status.structuredContent?.export?.exists, true);

  const inventory = await client.callTool({
    name: 'samsung_health_data_inventory',
    arguments: { response_format: 'json' }
  });
  assert.equal(inventory.structuredContent?.kind, 'data_inventory');
  assert.ok(inventory.structuredContent?.totals?.record_types >= 1);

  const context = await client.callTool({
    name: 'samsung_health_wellness_context',
    arguments: { date: '2026-05-01', response_format: 'markdown' }
  });
  assert.equal(context.structuredContent?.source, 'samsung_health');
  assert.ok(['low', 'normal', 'high', 'unknown'].includes(context.structuredContent?.recent_training_load));
  assert.match(context.content?.[0]?.text ?? '', /Samsung Health Wellness Context/);
  assert.doesNotMatch(context.content?.[0]?.text ?? '', /\[object Object\]/);

  console.log(JSON.stringify({ ok: true, clients: 5, export_ready: true, wellness_context: true }, null, 2));
} finally {
  await client.close().catch(() => {});
}
