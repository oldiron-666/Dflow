import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fixture,favorite,entry,root} from '../scripts/regression-fixture.mjs';
test('login tests verify real identity and report credentials, permissions and network separately',{timeout:15000},async()=>{
 const f=await fixture();try{
  for(const [key,status,pattern] of [['good',200,/已验证账户/],['bad',401,/API Key/],['restricted',403,/IP/],['html',403,/防护/],['timeout',502,/不代表凭据错误/],['public',401,/未确认/]]){
   const response=await f.request('/api/auth-test',{loginName:'测试用户',loginKey:key});assert.equal(response.status,status);assert.match((await response.json()).message,pattern);
  }
  const response=await f.request('/api/auth-test',undefined,'GET',{'X-Danbooru-Username':encodeURIComponent('测试用户'),'X-Danbooru-Key':'good','X-DFlow-Auth-Encoding':'uri'});assert.equal(response.status,200);assert.equal((await response.json()).user.name,'测试用户');
 }finally{await f.close();}
});
test('mixed favorites/manual queue preserves order on move, pause, resume and restart; gallery supports 304',{timeout:15000},async()=>{
 const f=await fixture({favorites:[favorite('local_a','pending',1,{prompt:'Previously written prompt',reverseStatus:'success'})],entries:[entry('b','pending',2),entry('c','pending',3)]});
 const queue=async()=> (await (await f.request('/api/reverse/queue')).json()).items.map(x=>[String(x.id),x.queueOrder]);
 try{
  assert.deepEqual(await queue(),[['local_a',1],['b',2],['c',3]]);
  await f.request('/api/worded/state/b',{autoEnabled:false},'PATCH');assert.deepEqual((await queue()).filter(x=>x[1]),[['local_a',1],['c',2]]);
  await f.request('/api/worded/state/b',{autoEnabled:true,customInstruction:'preserve this requirement'},'PATCH');assert.deepEqual((await queue()).filter(x=>x[1]),[['local_a',1],['c',2],['b',3]]);
  await f.request('/api/worded/state/c',{folder:'worded'},'PATCH');assert.deepEqual((await queue()).filter(x=>x[1]),[['local_a',1],['b',2]]);
  const first=await f.request('/api/local-gallery'),etag=first.headers.get('etag');assert.ok(etag);await first.json();
  const unchanged=await f.request('/api/local-gallery',undefined,'GET',{'If-None-Match':etag});assert.equal(unchanged.status,304);
  await f.request('/api/worded/state/c',{folder:'completed'},'PATCH');assert.equal((await f.request('/api/local-gallery',undefined,'GET',{'If-None-Match':etag})).status,200);
  await f.restart();assert.deepEqual((await queue()).filter(x=>x[1]),[['local_a',1],['b',2]]);
  const snapshot=await (await f.request('/api/local-gallery')).json();assert.equal(snapshot.entries.find(x=>x.id==='b').customInstruction,'preserve this requirement');
 }finally{await f.close();}
});
test('browser batch wakes existing latest DSH chat once and claims the snapshot strictly in queue order',{timeout:15000},async()=>{
 const f=await fixture({bridge:true,favorites:[favorite('local_a','pending',1)],entries:[entry('b','pending',2),entry('c','pending',3)]});
 try{
  const client=new Client({name:'DSH Desktop',version:'test'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp-server.js')],cwd:root,env:{...process.env,DFLOW_PORT:String(f.port)}}));
  const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});assert.notEqual(result.isError,true,result.content[0].text);return JSON.parse(result.content[0].text);};
  await call('list_pending');
  try {
  const starts=await Promise.all(Array.from({length:4},()=>f.request('/api/reverse/batch/start',{instruction:'Preserve lighting and composition'})));
  assert.ok(starts.every(r=>r.status===202));const runs=await Promise.all(starts.map(r=>r.json()));assert.equal(new Set(runs.map(x=>x.batchId)).size,1);const batchId=runs[0].batchId;
  const wakes=f.messages.filter(x=>x.method==='session.startTurn');assert.equal(wakes.length,1);assert.equal(wakes[0].params.sessionId,'active-chat');assert.match(wakes[0].params.content,new RegExp(batchId));
  // Normal workers must not steal cards reserved by a browser batch.
  assert.equal((await (await f.request('/api/reverse/next',{})).json()).item,null);
  for(const cardId of ['local_a','b','c']){
   const claim=await call('claim_direct_reverse',{batchId});assert.equal(claim.workflow.batchInstruction,'Preserve lighting and composition');assert.equal(claim.request.itemId,cardId);assert.equal(claim.request.batchInstruction,'Preserve lighting and composition');
   const result=await call('complete_pending',{id:cardId,prompt:'Faithful detailed image description with lighting, composition and environment. '.repeat(6),resolvedPreset:'通用扩写'});assert.equal((result.item || result.favorite).folder,'worded');
  }
  assert.equal((await call('claim_direct_reverse',{batchId})).request,null);
  const progress=await (await f.request(`/api/reverse/batch/${batchId}`)).json();assert.equal(progress.completed,3);assert.equal(progress.queued,0);
  }finally{await client.close();}
 }finally{await f.close();}
});
test('plain MCP cannot be falsely reported as awakened and an uncached earlier card is never skipped',{timeout:15000},async()=>{
 const f=await fixture({bridge:true,entries:[entry('missing','pending',1,{imageExt:''}),entry('ready','pending',2)]});try{
  const client=await (await f.request('/api/mcp/sessions',{name:'tools-only',clientId:'tools'})).json();
  let response=await f.request('/api/reverse/batch/start',{});assert.equal(response.status,409);assert.equal((await response.json()).code,'WAKE_UNSUPPORTED');
  await f.request('/api/mcp/sessions',{name:'DSH Desktop',clientId:'dsh'});response=await f.request('/api/reverse/batch/start',{});assert.equal(response.status,409);assert.equal((await response.json()).code,'CACHE_NOT_READY');assert.equal(f.messages.filter(x=>x.method==='session.startTurn').length,0);
  const again=await (await f.request('/api/mcp/sessions',{name:'tools-only',clientId:'tools'})).json();assert.equal(again.id,client.id);
  await f.request(`/api/mcp/sessions/${client.id}`,undefined,'DELETE');response=await f.request('/api/mcp/sessions',{name:'tools-only',clientId:'tools'});assert.equal(response.status,410);assert.equal((await response.json()).reason,'revoked');
 }finally{await f.close();}
});

test('inline manual prompt edits persist content chronology, while moves and invalid edits do not rewrite it',{timeout:15000},async()=>{
 const f=await fixture({entries:[entry('inline','worded',0,{promptWrittenAt:'2026-01-01',autoEnabled:false})]});try{
  let response=await f.request('/api/worded/state/inline',{positive:'Updated inline prompt'},'PATCH');assert.equal(response.status,200);
  const saved=(await response.json()).entry;assert.equal(saved.positive,'Updated inline prompt');assert.notEqual(saved.promptWrittenAt,'2026-01-01');
  response=await f.request('/api/worded/state/inline',{positive:'   ',folder:'completed'},'PATCH');assert.equal(response.status,400);
  response=await f.request('/api/worded/state/inline',{folder:'completed'},'PATCH');const moved=(await response.json()).entry;assert.equal(moved.promptWrittenAt,saved.promptWrittenAt);
  await f.restart();const snapshot=await (await f.request('/api/local-gallery')).json();const card=snapshot.entries.find(x=>x.id==='inline');assert.equal(card.positive,'Updated inline prompt');assert.equal(card.folder,'completed');assert.equal(card.promptWrittenAt,saved.promptWrittenAt);
 }finally{await f.close();}
});

test('an existing queued batch is awakened once again after its MCP process reconnects',{timeout:15000},async()=>{
 const f=await fixture({bridge:true,entries:[entry('reconnect-batch','pending',1)]});try{
  const old=await (await f.request('/api/mcp/sessions',{name:'DSH Desktop',clientId:'old'})).json();
  const original=await (await f.request('/api/reverse/batch/start',{})).json();assert.ok(original.batchId);
  await f.request(`/api/mcp/sessions/${old.id}`,undefined,'DELETE');
  const current=await (await f.request('/api/mcp/sessions',{name:'DSH Desktop',clientId:'new'})).json();
  for(let n=0;n<2;n++){
   const response=await f.request('/api/reverse/batch/start',{});assert.equal(response.status,202);const resumed=await response.json();assert.equal(resumed.batchId,original.batchId);assert.equal(resumed.reused,true);
  }
  assert.equal(f.messages.filter(x=>x.method==='session.startTurn').length,2);
  const response=await f.request('/api/reverse/direct/claim',{batchId:original.batchId},'POST',{'X-DFlow-MCP-Session':current.id});assert.equal(response.status,200);assert.equal((await response.json()).request.itemId,'reconnect-batch');
 }finally{await f.close();}
});
