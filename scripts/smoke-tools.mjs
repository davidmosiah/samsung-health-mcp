import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedTools = [
  'samsung_health_agent_manifest',
  'samsung_health_capabilities',
  'samsung_health_connection_status',
  'samsung_health_daily_summary',
  'samsung_health_data_inventory',
  'samsung_health_demo',
  'samsung_health_list_records',
  'samsung_health_list_workouts',
  'samsung_health_privacy_audit',
  'samsung_health_quickstart',
  'samsung_health_weekly_summary',
  'samsung_health_wellness_context'
];

const expectedResources = [
  'samsung-health://agent-manifest',
  'samsung-health://capabilities',
  'samsung-health://inventory',
  'samsung-health://summary/daily',
  'samsung-health://summary/weekly'
];

const expectedPrompts = [
  'samsung_health_daily_review',
  'samsung_health_weekly_review'
];

const client = new Client({ name: 'samsung-health-mcp-smoke-test', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: { ...process.env, SAMSUNG_HEALTH_EXPORT_PATH: 'fixtures/samsung_health_export' }
});
await client.connect(transport);
try {
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), expectedTools.sort());

  const resources = await client.listResources();
  assert.deepEqual(resources.resources.map((resource) => resource.uri).sort(), expectedResources.sort());

  const prompts = await client.listPrompts();
  assert.deepEqual(prompts.prompts.map((prompt) => prompt.name).sort(), expectedPrompts.sort());

  const inventoryResult = await client.callTool({ name: 'samsung_health_data_inventory', arguments: { response_format: 'json' } });
  assert.equal(inventoryResult.structuredContent?.kind, 'data_inventory');
  assert.equal(typeof inventoryResult.structuredContent?.source, 'string');

  const manifest = await client.callTool({ name: 'samsung_health_agent_manifest', arguments: { client: 'hermes', response_format: 'json' } });
  assert.equal(manifest.structuredContent?.client, 'hermes');
  assert.equal(manifest.structuredContent?.samsung_health_live_access, false);
  assert.ok(manifest.structuredContent?.agent_rules?.some((rule) => /export/i.test(rule)));

  const status = await client.callTool({ name: 'samsung_health_connection_status', arguments: { client: 'hermes', response_format: 'json' } });
  assert.equal(status.structuredContent?.ok, true);
  assert.equal(status.structuredContent?.client, 'hermes');
  assert.ok(status.structuredContent?.next_steps?.some((step) => step.includes('daily_summary')));

  console.log(JSON.stringify({ ok: true, tools: expectedTools.length, resources: expectedResources.length, prompts: expectedPrompts.length }, null, 2));
} finally {
  await client.close();
}
