import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access, mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const vendor = 'samsung_health';
const home = await mkdtemp(join(tmpdir(),vendor+'-profile-boundaries-'));
const file = join(home,'.delx-wellness','profile.json');
const client = new Client({name:vendor+'-profile-boundary-tests',version:'1.0.0'});
const env = { PATH:process.env.PATH??'', HOME:home, USERPROFILE:home, ...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot??''}:{}) };
async function call(suffix,args={}) {return client.callTool({name:vendor+'_'+suffix,arguments:{response_format:'json',...args}});}
try {
 await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js'],env}));
 // Read-only tools must not create even a directory or lock on a clean HOME.
 for (const suffix of ['profile_get','onboarding']) {
  assert.equal((await call(suffix)).structuredContent?.ok,true);
  assert.deepEqual(await readdir(home),[]);
 }
 // Legacy context stays available, but reads cannot silently migrate it.
 for (const relative of ['.hermes/profiles/delx-wellness/wellness-profile.json','.openclaw-delx-wellness/workspace/wellness-profile.json']) {
  const legacy=join(home,relative);
  await mkdir(dirname(legacy),{recursive:true});
  const bytes=JSON.stringify({schema:'delx-wellness-profile/v1',profile:{preferred_name:'Synthetic Legacy Read'}});
  await writeFile(legacy,bytes);
  const beforePaths=(await readdir(home,{recursive:true})).sort();
  for (const suffix of ['profile_get','onboarding']) {
   const result=await call(suffix);
   assert.equal(result.structuredContent?.ok,true);assert.match(JSON.stringify(result),/Synthetic Legacy Read/);
   const cli=spawnSync(process.execPath,['dist/index.js','call',vendor+'_'+suffix,'--json','{"response_format":"json"}'],{env,encoding:'utf8',timeout:10000});
   assert.equal(cli.status,0,cli.stderr);assert.match(cli.stdout,/Synthetic Legacy Read/);
   assert.equal(await readFile(legacy,'utf8'),bytes);
   assert.deepEqual((await readdir(home,{recursive:true})).sort(),beforePaths);
   await assert.rejects(access(join(home,'.delx-wellness')));
  }
  const onboardingCli=spawnSync(process.execPath,['dist/index.js','onboarding'],{env,encoding:'utf8',timeout:10000});
  assert.equal(onboardingCli.status,0,onboardingCli.stderr);assert.match(onboardingCli.stdout,/Synthetic Legacy Read/);
  assert.deepEqual((await readdir(home,{recursive:true})).sort(),beforePaths);
  await rm(join(home,relative.split('/')[0]),{recursive:true,force:true});
 }
 const denied = await call('profile_update',{patch:{notes:'synthetic'},explicit_user_intent:false});
 assert.match(JSON.stringify(denied),/USER_ACTION_REQUIRED/);await assert.rejects(access(file));
 const valid = await call('profile_update',{patch:{profile:{preferred_name:'Synthetic Fixture',language:'pt-BR',units:'metric'},goals:{primary:'synthetic',secondary:['recovery']},devices:{connected:['oura']},training:{sports:['walking'],preferred_duration_minutes:'30'},nutrition:{dietary_preferences:['synthetic'],protein_target_g:'100'},preferences:{language_priority:['pt-BR','en'],reply_style:'concise',ask_before_logging:true},safety:{conservative_flags:['synthetic']},notes:'synthetic'},explicit_user_intent:true});
 assert.match(JSON.stringify(valid),/Synthetic Fixture/);
 const before = await readFile(file,'utf8');
 for (const patch of [{devices:{connected:'synthetic-sensitive-value'}},{devices:{connected:null}},{devices:{connected:[1]}},{profile:'synthetic-sensitive-value'},{notes:42},{preferences:{ask_before_logging:'false'}},{profile:{language:'xx'}},{unknown:'synthetic-sensitive-value'},{profile:{unknown:'synthetic-sensitive-value'}},JSON.parse('{"profile":{"__proto__":{"polluted":true}}}')]) {
  const result = JSON.stringify(await call('profile_update',{patch,explicit_user_intent:true}));
  assert.match(result,/Invalid wellness profile patch/);assert.doesNotMatch(result,/synthetic-sensitive-value/);
  assert.equal(await readFile(file,'utf8'),before);
 }
 const stored=JSON.parse(before);assert.equal(stored.schema,'delx-wellness-profile/v1');assert.equal(stored.profile.preferred_name,'Synthetic Fixture');
 await writeFile(file,JSON.stringify({schema:'delx-wellness-profile/v1',devices:{connected:['whoop']}}));
 assert.match(JSON.stringify(await call('profile_get')),/whoop/);
 for (const bad of [JSON.stringify({schema:'delx-wellness-profile/v1',devices:{connected:null},notes:'synthetic-sensitive-value'}),JSON.stringify({schema:'unsupported',notes:'synthetic-sensitive-value'}),'{synthetic-sensitive-value']) {
  await writeFile(file,bad);
  for (const [suffix,args] of [['profile_get',{}],['profile_update',{patch:{notes:'safe'},explicit_user_intent:true}]]) {
   const result=JSON.stringify(await call(suffix,args));assert.match(result,/Stored wellness profile is invalid/);assert.doesNotMatch(result,/synthetic-sensitive-value/);
   assert.equal(await readFile(file,'utf8'),bad);
  }
 }
 console.log(JSON.stringify({ok:true,suite:'profile-boundaries',vendor,transport:'stdio',readOnlyProfileAndOnboarding:true,legacyReadPaths:2,cliReadOnly:true,validLegacy:true,rejectedPatches:10,corruptFiles:3,realAccounts:0}));
} finally {await client.close().catch(()=>{});await rm(home,{recursive:true,force:true});}
