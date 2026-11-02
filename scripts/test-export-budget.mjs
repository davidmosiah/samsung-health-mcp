import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { ExportBudget, ExportBudgetError, readBoundedText } from '../dist/services/export-budget.js';
import { readCsvSources, parseCsvTable } from '../dist/services/samsung-health-export.js';
const limits = {csvBytes:64,totalBytes:100,entries:3,cells:10};
function crc32(data) {let c=0xffffffff;for(const n of data){c^=n;for(let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
// Tiny author-created ZIP fixtures; no external archive generator or real export.
function zip(entries) {
 const locals=[],centrals=[];let offset=0;
 for(const entry of entries){const name=Buffer.from(entry.name),data=Buffer.from(entry.data??'x');const packed=entry.deflate?deflateRawSync(data):data;const method=entry.deflate?8:0;const size=entry.declared??data.length;const crc=crc32(data);
  const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(method,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(size,22);l.writeUInt16LE(name.length,26);locals.push(l,name,packed);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(size,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);centrals.push(c,name);offset+=l.length+name.length+packed.length;
 }
 const central=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,central,end]);
}
assert.throws(()=>new ExportBudget({}),/Invalid export resource limits/);
const planned = new ExportBudget(limits);
assert.throws(()=>planned.file(65),ExportBudgetError);planned.file(60);assert.throws(()=>planned.file(41),ExportBudgetError);
const root=await mkdtemp(join(tmpdir(),'samsung-budget-'));
const csv=(path)=>({kind:'csv',resolved_path:path,exists:true});
const directory=(path)=>({kind:'directory',resolved_path:path,exists:true});
const archive=(path)=>({kind:'zip',resolved_path:path,exists:true});
try {
 const file=join(root,'one.csv');await writeFile(file,'x'.repeat(64));
 assert.equal((await readCsvSources(csv(file),limits))[0].text.length,64);
 await writeFile(file,'x'.repeat(65));await assert.rejects(readCsvSources(csv(file),limits),ExportBudgetError);
 const dir=join(root,'dir');await mkdir(dir);await writeFile(join(dir,'one.csv'),'a'.repeat(60));await writeFile(join(dir,'two.csv'),'b'.repeat(41));
 await assert.rejects(readCsvSources(directory(dir),limits),ExportBudgetError);
 await writeFile(join(dir,'two.csv'),'b'.repeat(40));assert.equal((await readCsvSources(directory(dir),limits)).length,2);
 await writeFile(join(dir,'ignored.txt'),'');await writeFile(join(dir,'ignored2.txt'),'');await assert.rejects(readCsvSources(directory(dir),limits),ExportBudgetError);
 const zipPath=join(root,'tiny.zip');
 await writeFile(zipPath,zip([{name:'ok.csv',data:'a,b\n1,2\n',deflate:true}]));assert.equal((await readCsvSources(archive(zipPath),limits))[0].text,'a,b\n1,2\n');
 await writeFile(zipPath,zip([{name:'large.csv',data:'x'.repeat(65),deflate:true}]));await assert.rejects(readCsvSources(archive(zipPath),limits),ExportBudgetError);
 await writeFile(zipPath,zip([{name:'a.csv',data:'x'.repeat(60)},{name:'b.csv',data:'x'.repeat(41)}]));await assert.rejects(readCsvSources(archive(zipPath),limits),ExportBudgetError);
 await writeFile(zipPath,zip([{name:'a.csv',data:'x'.repeat(60)},{name:'b.csv',data:'x'.repeat(40)}]));assert.equal((await readCsvSources(archive(zipPath),limits)).length,2);
 await writeFile(zipPath,zip([{name:'a.txt'},{name:'b.txt'},{name:'c.txt'},{name:'d.txt'}]));await assert.rejects(readCsvSources(archive(zipPath),limits),ExportBudgetError);
 for(const name of ['../outside.csv','dir\\bad.csv']){await writeFile(zipPath,zip([{name}]));await assert.rejects(readCsvSources(archive(zipPath),limits),/invalid|relative|backslash/i);}
 await writeFile(zipPath,zip([{name:'wrong.csv',data:'x'.repeat(60),declared:10,deflate:true}]));await assert.rejects(readCsvSources(archive(zipPath),limits),/size|byte/i);
 // Metadata-independent accounting catches a producer that emits more bytes.
 const stream=Readable.from([Buffer.alloc(40),Buffer.alloc(25)]);
 await assert.rejects(readBoundedText(stream,new ExportBudget(limits)),ExportBudgetError);assert.equal(stream.destroyed,true);
 const interrupted=new Readable({read(){this.destroy();}});
 await assert.rejects(readBoundedText(interrupted,new ExportBudget(limits)),/closed before completion/);
 const shared=new ExportBudget(limits);await readBoundedText(Readable.from([Buffer.alloc(60)]),shared);
 await assert.rejects(readBoundedText(Readable.from([Buffer.alloc(41)]),shared),ExportBudgetError);
 assert.equal(parseCsvTable('a,b\n1,2',new ExportBudget(limits)).rows.length,1);
 assert.throws(()=>parseCsvTable(','.repeat(10),new ExportBudget(limits)),ExportBudgetError);
 const cellBudget=new ExportBudget(limits);parseCsvTable('a,b\n1,2',cellBudget);parseCsvTable('a,b\n1,2',cellBudget);
 assert.throws(()=>parseCsvTable('a,b\n1,2',cellBudget),ExportBudgetError);
 console.log('Export budget fixtures PASS: byte boundaries, combined bytes, entries, ZIP paths/metadata, stream cleanup, parser cells.');
} finally {await rm(root,{recursive:true,force:true});}
