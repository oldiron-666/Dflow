import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('missing favorite cache can be retried after failure without replacing ready images', {timeout:20000}, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dflow-cache-retry-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const dataDir = path.join(temp, 'data');
  const original = path.join(dataDir, 'favorites', 'original');
  await fs.mkdir(original, {recursive:true});
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9f8fSJ8AAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(path.join(original, '103.png'), png);
  const remote = 'https://cdn.donmai.us/dflow-test-image.png';
  await fs.writeFile(path.join(dataDir, 'dflow-state.json'), JSON.stringify({favorites:[
    {id:101,folder:'original',cacheStatus:'error',cacheError:'previous failure',large_file_url:remote},
    {id:102,folder:'original',cacheStatus:'ready',cacheFile:'102.png',large_file_url:remote+'?id=102'},
    {id:103,folder:'original',cacheStatus:'ready',cacheFile:'103.png',large_file_url:remote+'?id=103'}
  ]}));
  const mock = path.join(temp, 'mock-fetch.mjs');
  await fs.writeFile(mock, `const originalFetch = globalThis.fetch;
let failed = false;
const image = Buffer.concat([Buffer.from(${JSON.stringify(png.toString('base64'))}, 'base64'), Buffer.alloc(80)]);
globalThis.fetch = async (input, options) => {
 const url = new URL(String(input));
 if(url.pathname.endsWith('/dflow-test-image.png')) {
   if (!url.search && !failed) { failed = true; return new Response('temporary failure', {status:503}); }
   return new Response(image, {headers:{'Content-Type':'image/png'}});
 }
 return originalFetch(input, options);
};
`);
  const service = spawn(process.execPath, ['--import',pathToFileURL(mock).href,'server.js'], {cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DFLOW_DATA_DIR:dataDir},windowsHide:true,stdio:'ignore'});
  const base = 'http://127.0.0.1:'+port;
  const request = async (url, value) => fetch(base+url, value === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  const waitFor = async condition => { for(let i=0;i<80;i++){ const state = await (await request('/api/state')).json(); if(condition(state))return state; await sleep(100); } assert.fail('cache worker did not reach expected state'); };
  try {
    for(let i=0;i<60;i++){try{if((await request('/api/state')).ok)break;}catch{} await sleep(100);}
    const invalid = await request('/api/favorites/retry-cache',{folder:'invalid'});
    assert.equal(invalid.status,400); assert.equal((await invalid.json()).ok,false);
    const missingApi = await request('/api/not-a-real-endpoint',{});
    assert.equal(missingApi.status,404); assert.equal((await missingApi.json()).ok,false);
    let result = await request('/api/favorites/retry-cache',{folder:'all'});
    assert.equal(result.status,200); result = await result.json();
    assert.equal(result.ok,true); assert.equal(result.queued,2);
    await waitFor(s => s.favorites.find(x=>x.id===101).cacheStatus==='error' && s.favorites.find(x=>x.id===102).cacheStatus==='ready');
    // Numeric Danbooru IDs used to remain in cacheJobs after failure, so this
    // second attempt would report queued without ever restarting the worker.
    result = await (await request('/api/favorites/retry-cache',{folder:'all'})).json();
    assert.equal(result.ok,true); assert.equal(result.queued,1);
    await waitFor(s => s.favorites.every(x=>x.cacheStatus==='ready'));
    assert.deepEqual(await fs.readFile(path.join(original,'103.png')),png);
    assert.equal((await (await request('/api/favorites/retry-cache',{folder:'all'})).json()).queued,0);
    const response = await request('/api/reverse/image/101');
    assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'image/png');
  } finally {
    if(service.exitCode === null && service.signalCode === null) { const exited = once(service,'exit'); service.kill(); await exited; }
    await fs.rm(temp,{recursive:true,force:true});
  }
});
