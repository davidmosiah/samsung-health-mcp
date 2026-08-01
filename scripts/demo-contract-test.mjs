/**
 * Contract gate for `samsung_health_demo`.
 *
 * The demo tool exists so agents can see the payload shape before parsing a real
 * export. A hand-written example nobody compares against reality drifts silently,
 * and an agent that trusts it writes a parser for fields that never arrive.
 *
 * This gate runs the REAL builders over the repo fixture and compares key sets
 * against the demo payload, failing in both directions:
 *
 *   - a key in the demo that the builders never emit  -> invented contract
 *   - a key the builders emit that the demo omits     -> incomplete contract
 *
 * Arrays are compared as the union of their elements' key paths, because a real
 * week contains both populated and empty days and either alone under-describes
 * the shape.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDailySummary, buildWeeklySummary } from '../dist/services/summary.js';
import { buildWellnessContext } from '../dist/services/context.js';
import { buildDemoPayload } from '../dist/services/demo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, '..', 'fixtures', 'samsung_health_export');
const FIXTURE_DATE = '2026-05-01';
const TIMEZONE = 'America/Fortaleza';

/**
 * Keys the builders only emit when the export happens to contain that record
 * type. The demo shows them because they are part of the contract an agent may
 * encounter; the fixture may or may not produce them. Each entry needs a reason.
 *
 * This is deliberately narrow. Adding a key here to silence the gate defeats the
 * gate — only list fields that are genuinely conditional on export contents.
 */
const OPTIONAL_IN_REAL = new Map([
  // No allowances needed today: the fixture exercises every documented field.
  // Kept as the explicit, reviewable place to record one if that ever changes.
]);

function keyPaths(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) {
    // Union across elements: a week has both populated and empty days.
    for (const item of value) keyPaths(item, `${prefix}[]`, out);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  for (const key of Object.keys(value)) {
    const p = prefix ? `${prefix}.${key}` : key;
    out.add(p);
    keyPaths(value[key], p, out);
  }
  return out;
}

function diff(demoSet, realSet) {
  const invented = [...demoSet].filter((k) => !realSet.has(k)).sort();
  const missing = [...realSet]
    .filter((k) => !demoSet.has(k) && !OPTIONAL_IN_REAL.has(k))
    .sort();
  return { invented, missing };
}

function report(name, invented, missing) {
  const lines = [];
  if (invented.length > 0) {
    lines.push(
      `\n  ${name}: ${invented.length} key(s) in the demo that the real builder NEVER returns.`,
      `  An agent trusting these writes a parser for data that never arrives:`,
      ...invented.map((k) => `    - ${k}`)
    );
  }
  if (missing.length > 0) {
    lines.push(
      `\n  ${name}: ${missing.length} key(s) the real builder returns but the demo omits.`,
      `  Agents reading the demo will not know these exist:`,
      ...missing.map((k) => `    + ${k}`)
    );
  }
  return lines.join('\n');
}

const demo = buildDemoPayload().sample;

const real = {
  samsung_health_daily_summary: await buildDailySummary(FIXTURE, FIXTURE_DATE, { timezone: TIMEZONE }),
  samsung_health_weekly_summary: await buildWeeklySummary(FIXTURE, FIXTURE_DATE, 7, { timezone: TIMEZONE }),
  samsung_health_wellness_context: await buildWellnessContext(FIXTURE, {
    date: FIXTURE_DATE,
    timezone: TIMEZONE,
    soreness: [],
    injury_flags: []
  })
};

const failures = [];
let checked = 0;

for (const [name, realPayload] of Object.entries(real)) {
  assert.ok(demo[name], `demo payload is missing the ${name} sample entirely`);
  const demoSet = keyPaths(demo[name]);
  const realSet = keyPaths(realPayload);
  const { invented, missing } = diff(demoSet, realSet);
  checked += demoSet.size;
  if (invented.length > 0 || missing.length > 0) {
    failures.push(report(name, invented, missing));
  } else {
    console.log(`PASS ${name} — ${demoSet.size} key paths match the real builder`);
  }
}

// The demo must stay honest about being synthetic, whatever the shape says.
const payload = buildDemoPayload();
assert.equal(payload.is_demo, true, 'demo payload must be tagged is_demo=true');
assert.ok(Array.isArray(payload.notes) && payload.notes.length > 0, 'demo payload must carry notes');
console.log('PASS demo payload is tagged synthetic');

// A demo that leaks the sensitive metadata the privacy fix removed would
// re-teach agents the wrong contract.
const encoded = JSON.stringify(payload);
for (const needle of ['latitude', 'longitude', 'deviceuuid', 'start_latitude']) {
  assert.ok(!encoded.toLowerCase().includes(needle), `demo payload must not contain "${needle}"`);
}
console.log('PASS demo payload carries no positional or device-identifier keys');

if (failures.length > 0) {
  console.error('\nFAIL demo contract drifted from the real builders:');
  console.error(failures.join('\n'));
  console.error(
    '\nFix src/services/demo.ts so the examples match what the builders return.' +
      '\nDo not widen OPTIONAL_IN_REAL to silence this — that is how the drift got here.\n'
  );
  process.exit(1);
}

console.log(`\ndemo-contract: ${checked} key paths verified against the real builders`);
console.log(JSON.stringify({ ok: true, suite: 'demo-contract', samples: Object.keys(real).length }));
