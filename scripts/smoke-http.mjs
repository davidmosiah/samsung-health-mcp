import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 4100 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['dist/index.js'], {
  env: {
    ...process.env,
    SAMSUNG_HEALTH_MCP_TRANSPORT: 'http',
    SAMSUNG_HEALTH_MCP_PORT: String(port)
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  await waitForHealth(port);
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.name, 'samsung-health-mcp-server');
  console.log(JSON.stringify({ ok: true, transport: 'http', port }, null, 2));
} finally {
  child.kill('SIGTERM');
}

async function waitForHealth(targetPort) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${targetPort}/health`);
      if (response.ok) return;
    } catch {
      // Retry until server is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('HTTP health endpoint did not become ready.');
}
