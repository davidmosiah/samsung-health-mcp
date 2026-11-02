import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSamsungDate, listRecords } from '../dist/services/samsung-health-export.js';
const cases = [
 ['2024-02-29 23:59:59.123','2024-02-29T23:59:59.123Z'],
 ['2026/05/01 1:02:03.1','2026-05-01T01:02:03.100Z'],
 ['2026.05.01 01:02:03.123456','2026-05-01T01:02:03.123Z'],
 ['2026-05-01T00:30:00.123+14:00','2026-04-30T10:30:00.123Z'],
 ['2026-05-01 23:30:00.987 -1200','2026-05-02T11:30:00.987Z'],
 ['2026-05-01T08:00:00.007Z','2026-05-01T08:00:00.007Z'],
 ['2026-05-01','2026-05-01T00:00:00.000Z'],
 [String(Date.parse('2026-05-01T01:02:03.123Z')),'2026-05-01T01:02:03.123Z']
];
for (const [input, expected] of cases) assert.equal(parseSamsungDate(input)?.toISOString(),expected,input);
for (const invalid of ['2026-02-29','2024-02-30','2026-04-31','2026-13-01','2026-00-01','2026-01-00','2026-05-01 24:00:00','2026-05-01 12:60:00','2026-05-01 12:00:60','2026-02-30T01:00:00Z','2026-04-31T01:00:00+14:00','2026-05-01T01:00:00+24:00','2026-05-01T01:00:00+01:60','2026-05/01']) assert.equal(parseSamsungDate(invalid),undefined,invalid);
const root=await mkdtemp(join(tmpdir(),'samsung-date-precision-'));
try {
 const file=join(root,'com.samsung.health.heart_rate.csv');
 await writeFile(file,'start_time,heart_rate\n2026-02-30 12:00:00,90\n2026-03-02 12:00:00.123,60\n');
 const records=await listRecords({exportPath:file,start:'2026-03-02T00:00:00Z',end:'2026-03-02T23:59:59Z'});
 assert.equal(records.length,1,'invalid timestamp is excluded from dated queries, not normalized or a global crash');
 assert.equal(records[0].startDate,'2026-03-02T12:00:00.123Z');
} finally {await rm(root,{recursive:true,force:true});}
console.log('Date precision PASS: fractions, leap days, explicit offsets, invalid calendar/time rejection, dated-query exclusion.');
