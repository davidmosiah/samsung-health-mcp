import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const pinnedPackage = `samsung-health-mcp-unofficial@${packageJson.version}`;
const exportPath = resolve('fixtures/samsung_health_export');
const home = mkdtempSync(join(tmpdir(), 'samsung-health-mcp-hermes-'));

const client = new Client({ name: 'samsung-health-mcp-hermes-agent-test', version: '0.0.0' });
const transport = new StdioClientTransport({ command: 'node', args: ['dist/index.js'] });

try {
  await client.connect(transport);
  const manifestResult = await client.callTool({
    name: 'samsung_health_agent_manifest',
    arguments: { client: 'hermes', response_format: 'json' }
  });
  const manifest = manifestResult.structuredContent;
  assert.equal(manifest.client, 'hermes');
  assert.equal(manifest.hermes.tool_name_prefix, 'mcp_samsung_health_');
  assert.equal(manifest.hermes.no_gateway_restart_for_data_access, true);
  assert.equal(manifest.samsung_health_live_access, false);
  assert.ok(manifest.hermes.common_tool_names.includes('mcp_samsung_health_samsung_health_data_inventory'));
  assert.ok(JSON.stringify(manifest.hermes.recommended_config).includes(pinnedPackage));

  const resource = await client.readResource({ uri: 'samsung-health://agent-manifest' });
  assert.match(resource.contents[0]?.text ?? '', /mcp_samsung_health_samsung_health_connection_status/);
  assert.match(resource.contents[0]?.text ?? '', /mcp_samsung_health_samsung_health_data_inventory/);

  const setup = spawnSync(process.execPath, [
    'dist/index.js',
    'setup',
    '--client',
    'hermes',
    '--export-path',
    exportPath,
    '--json'
  ], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home }
  });
  assert.equal(setup.status, 0, setup.stderr);
  const setupPayload = JSON.parse(setup.stdout);
  assert.equal(setupPayload.client, 'hermes');
  assert.ok(setupPayload.hermes_skill_path.endsWith('.hermes/skills/samsung-health-mcp/SKILL.md'));
  assert.ok(setupPayload.next_step.includes('/reload-mcp'));
  assert.ok(existsSync(setupPayload.hermes_skill_path));
  assert.match(readFileSync(setupPayload.client_config_path, 'utf8'), new RegExp(pinnedPackage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const doctor = spawnSync(process.execPath, ['dist/index.js', 'doctor', '--client', 'hermes', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home }
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorPayload = JSON.parse(doctor.stdout);
  assert.equal(doctorPayload.client, 'hermes');
  assert.equal(doctorPayload.client_checks.hermes.samsung_health_server_configured, true);
  assert.equal(doctorPayload.client_checks.hermes.package_pinned, true);
  assert.equal(doctorPayload.client_checks.hermes.skill_installed, true);

  const mergeHome = mkdtempSync(join(tmpdir(), 'samsung-health-mcp-hermes-merge-'));
  mkdirSync(join(mergeHome, '.hermes'), { recursive: true, mode: 0o700 });
  writeFileSync(join(mergeHome, '.hermes', 'config.yaml'), [
    'mcp_servers:',
    '  existing_health_mcp:',
    '    command: npx',
    '    args:',
    '      - -y',
    '      - existing-health-mcp',
    ''
  ].join('\n'), { mode: 0o600 });
  const mergeSetup = spawnSync(process.execPath, [
    'dist/index.js',
    'setup',
    '--client',
    'hermes',
    '--export-path',
    exportPath,
    '--json'
  ], {
    encoding: 'utf8',
    env: { ...process.env, HOME: mergeHome }
  });
  assert.equal(mergeSetup.status, 0, mergeSetup.stderr);
  const mergedConfig = readFileSync(join(mergeHome, '.hermes', 'config.yaml'), 'utf8');
  assert.equal((mergedConfig.match(/^mcp_servers:/gm) ?? []).length, 1);
  assert.match(mergedConfig, /existing_health_mcp:/);
  assert.match(mergedConfig, /samsung_health:/);
  assert.doesNotMatch(mergedConfig, /mcp_reload_confirm/);
  rmSync(mergeHome, { recursive: true, force: true });

  // Setup owns the MCP entry, never the user's approval/security policy.
  for (const policy of [
    'approvals:\n  mcp_reload_confirm: true\n  mode: interactive\n',
    'approvals:\n  mcp_reload_confirm: false\n  mode: interactive\n',
    'approvals: {mcp_reload_confirm: true}\n',
    ''
  ]) {
    for (const server of ['', [
      'mcp_servers:',
      '  samsung_health:',
      '    command: npx',
      '    args: ["-y", "samsung-health-mcp-unofficial@0.1.0"]',
      ''
    ].join('\n')]) {
      const policyHome = mkdtempSync(join(tmpdir(), 'samsung-hermes-policy-'));
      try {
        mkdirSync(join(policyHome, '.hermes'), { recursive: true, mode: 0o700 });
        const configPath = join(policyHome, '.hermes', 'config.yaml');
        const before = `${policy}${server}# keep unrelated configuration\nmodel: example-model\n`;
        writeFileSync(configPath, before, { mode: 0o600 });
        const run = () => spawnSync(process.execPath, [
          'dist/index.js', 'setup', '--client', 'hermes', '--export-path', exportPath, '--json'
        ], { encoding: 'utf8', env: { ...process.env, HOME: policyHome } });
        const first = run();
        assert.equal(first.status, 0, first.stderr);
        const after = readFileSync(configPath, 'utf8');
        assert.equal((after.match(/mcp_reload_confirm/g) ?? []).length,
          (before.match(/mcp_reload_confirm/g) ?? []).length);
        if (policy) assert.ok(after.startsWith(policy), 'approval policy changed');
        assert.ok(after.includes('# keep unrelated configuration\nmodel: example-model\n'));
        assert.ok(after.includes(pinnedPackage));
        const second = run();
        assert.equal(second.status, 0, second.stderr);
        assert.equal(readFileSync(configPath, 'utf8'), after, 'repeat setup must be idempotent');
        const policyDoctor = spawnSync(process.execPath, ['dist/index.js', 'doctor', '--client', 'hermes', '--json'], {
          encoding: 'utf8', env: { ...process.env, HOME: policyHome }
        });
        assert.equal(policyDoctor.status, 0, policyDoctor.stderr);
        const recommendations = JSON.parse(policyDoctor.stdout).client_checks.hermes.recommendations;
        assert.ok(recommendations.some(text => text.includes('approval policy unchanged')));
        assert.ok(recommendations.every(text => !text.includes('mcp_reload_confirm: false')));
      } finally {
        rmSync(policyHome, { recursive: true, force: true });
      }
    }
  }

  console.log(JSON.stringify({ ok: true, hermes_agent_manifest: true, pinned_package: pinnedPackage }, null, 2));
} finally {
  await client.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
}
