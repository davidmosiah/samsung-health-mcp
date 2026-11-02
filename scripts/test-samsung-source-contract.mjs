import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { listRecords, listWorkouts } from '../dist/services/samsung-health-export.js';
import { buildDailySummary } from '../dist/services/summary.js';
const root=await mkdtemp(join(tmpdir(),'samsung-source-contract-'));
try {
 const hr=join(root,'com.samsung.health.heart_rate.202610.csv');
 await writeFile(hr,'start_time,end_time,time_offset,heart_rate\n2026-05-01 00:30:00,2026-05-01 00:31:00,UTC+1400,61\n2026-05-01 23:30:00,2026-05-01 23:31:00,UTC-1200,62\n2026-05-01T08:00:00+03:00,2026-05-01T08:01:00+03:00,UTC-1200,63\n');
 const readings=await listRecords({exportPath:hr,start:'2026-05-01T00:00:00Z',end:'2026-05-01T23:59:59Z'});
 assert.deepEqual(readings.map(r=>r.startDate),['2026-05-01T00:30:00.000Z','2026-05-01T23:30:00.000Z','2026-05-01T05:00:00.000Z']);
 const generic=join(root,'heart_rate.csv');await writeFile(generic,'start_time,time_offset,heart_rate\n2026-05-01 08:05:00,UTC-0300,70\n');
 assert.equal((await listRecords({exportPath:generic}))[0].startDate,'2026-05-01T11:05:00.000Z','generic CSV offset contract unchanged');
 const workout=join(root,'com.samsung.health.exercise.202610.csv');
 await writeFile(workout,'start_time,end_time,time_offset,exercise_type,duration,distance\n2026-05-02 01:00:00,2026-05-02 01:01:00,UTC-0300,1001,60000,80\n2026-05-02 01:00:30,2026-05-02 01:01:30,UTC-0300,1001,60000,90\n');
 const sessions=await listWorkouts({exportPath:workout});assert.equal(sessions.length,2,'overlap alone is not identity');
 assert.equal(sessions[0].duration,1);assert.equal(sessions[0].totalDistance,0.08);assert.equal(sessions[0].startDate,'2026-05-02T01:00:00.000Z');
 const genericWorkout=join(root,'workout.csv');await writeFile(genericWorkout,'start_time,end_time,duration,distance,distance_unit\n2026-05-01T01:00:00Z,2026-05-01T02:00:00Z,60,200,km\n');
 const old=(await listWorkouts({exportPath:genericWorkout}))[0];assert.equal(old.duration,60);assert.equal(old.totalDistance,200,'explicit km cannot use magnitude heuristic');
 const steps=join(root,'com.samsung.shealth.step_daily_trend.202610.csv');
 await writeFile(steps,'day_time,count,source_type,distance\n2026-05-03 00:00:00.000,100,-2,80\n2026-05-03 00:00:00.000,90,0,9000\n');
 const distances=await listRecords({exportPath:steps,type:'samsung_health_distance',limit:1});assert.equal(distances.length,1);assert.equal(distances[0].numeric_value,0.08);assert.equal(distances[0].calendarDate,'2026-05-03');
 for(const timezone of ['Etc/GMT+12','Pacific/Auckland','Pacific/Kiritimati']){const day=await buildDailySummary(steps,'2026-05-03',{timezone});assert.equal(day.totals.steps,100);assert.equal(day.totals.distance,0.08);}
 const energy=join(root,'com.samsung.shealth.calories_burned.details.202610.csv');
 await writeFile(energy,'day_time,tef_calorie,rest_calorie,active_calorie\n2026-05-03 00:00:00.000,150,1700,420.5\n');
 for(const timezone of ['Etc/GMT+12','Pacific/Kiritimati']) assert.equal((await buildDailySummary(energy,'2026-05-03',{timezone})).totals.active_energy_kcal,420.5);
 const missingEnergy=join(root,'com.samsung.shealth.calories_burned.details.202611.csv');await writeFile(missingEnergy,'day_time,tef_calorie,rest_calorie\n2026-05-03 00:00:00.000,150,1700\n');assert.equal((await listRecords({exportPath:missingEnergy})).length,0,'never substitute thermic/rest calories');
 const ids=join(root,'ids');await mkdir(ids);
 const header='datauuid,deviceuuid,start_time,end_time,exercise_type,duration,distance\n';
 const row='SYNTHETIC-RECORD-0001,SYNTHETIC-DEVICE-0001,2026-05-02 01:00:00,2026-05-02 01:01:00,1001,60000,80\n';
 await writeFile(join(ids,'com.samsung.health.exercise.202610.csv'),header+row+row+row.replace('RECORD-0001','RECORD-0002')+row.replace(',80\n',',90\n')+row.replace(',80\n',',80.1\n')+row.replace(',60000,',',60001,')+row.replace('DEVICE-0001','DEVICE-0002'));
 await writeFile(join(ids,'com.samsung.health.exercise.202611.csv'),header+row);
 const unique=await listWorkouts({exportPath:ids});assert.equal(unique.length,6,'same ID and exact source row only; retain distinct IDs, sub-rounding changes and device/source changes');assert.doesNotMatch(JSON.stringify(unique),/SYNTHETIC-RECORD|SYNTHETIC-DEVICE/);
 const noId=join(root,'com.samsung.health.exercise.202612.csv');await writeFile(noId,header+row.replace('SYNTHETIC-RECORD-0001','')+row.replace('SYNTHETIC-RECORD-0001',''));assert.equal((await listWorkouts({exportPath:noId})).length,2,'device identity alone never deduplicates sessions');
 console.log('Samsung source contracts PASS: UTC versus generic offsets, ms duration, explicit/default distance units, canonical step distance, active energy, exact source identities, distinct overlapping sessions.');
}finally{await rm(root,{recursive:true,force:true});}
