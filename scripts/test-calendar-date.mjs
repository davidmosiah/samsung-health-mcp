import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { samsungDayDate } from '../dist/services/samsung-day-date.js';
import { buildDailySummary, buildWeeklySummary } from '../dist/services/summary.js';
import { listRecords } from '../dist/services/samsung-health-export.js';
import { recordPrivacyView } from '../dist/services/privacy.js';
for (const x of ['2026-05-02','2026-05-02 00:00:00.000','2026-05-02T00:00:00Z',String(Date.UTC(2026,4,2))]) assert.equal(samsungDayDate(x),'2026-05-02');
for (const x of ['2026-02-30','2026-05-02T12:00:00Z','2026-05-02T00:00:00+14:00','x',undefined]) assert.equal(samsungDayDate(x),undefined);
const dir = await mkdtemp(join(tmpdir(),'samsung-day-model-'));
try {
  await writeFile(join(dir,'com.samsung.shealth.step_daily_trend.20261001000000.csv'), 'day_time,count,source_type\n2026-05-02 00:00:00.000,8000,-2\n2026-03-08 00:00:00.000,4000,-2\n');
  // Deliberately overlapping same-type sessions: no guessed identity collapse.
  await writeFile(join(dir,'workout.csv'), 'start_time,end_time,duration,exercise_type\n2026-05-02T01:00:00Z,2026-05-02T02:00:00Z,60,run\n2026-05-02T01:30:00Z,2026-05-02T02:30:00Z,60,run\n');
  for (const timezone of ['UTC','Etc/GMT+12','America/Sao_Paulo','Asia/Tokyo','Pacific/Auckland','Pacific/Kiritimati']) {
    const summary = await buildDailySummary(dir,'2026-05-02',{timezone});
    assert.equal(summary.totals.steps,8000,timezone);
    assert.equal((await buildDailySummary(dir,'2026-05-01',{timezone})).totals.steps,0,timezone+' preceding');
    assert.equal((await buildDailySummary(dir,'2026-05-03',{timezone})).totals.steps,0,timezone+' following');
    assert.equal((await buildWeeklySummary(dir,'2026-05-03',3,{timezone})).totals.steps,8000,timezone+' weekly');
  }
  assert.equal((await buildDailySummary(dir,'2026-03-08',{timezone:'America/New_York'})).totals.steps,4000,'DST transition');
  assert.equal((await buildDailySummary(dir,'2026-05-02',{timezone:'UTC'})).workouts.count,2,'do not infer duplicate identity from overlap');
  const records = await listRecords({exportPath:dir,type:'samsung_health_steps'});
  const record=records.find(r=>r.calendarDate==='2026-05-02');assert.ok(record);
  assert.equal(record.startDate,'2026-05-02T00:00:00.000Z','raw timestamp is not moved to invented noon');
  assert.equal(recordPrivacyView([record],'structured','Pacific/Kiritimati').records[0].start_date,'2026-05-02');
  console.log('Samsung calendar-date fixtures PASS: UTC-12/+12/+14, DST, weekly, raw/structured and distinct overlapping workouts.');
} finally { await rm(dir,{recursive:true,force:true}); }
