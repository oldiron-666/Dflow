import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PixivBrowserLogin} from '../browser-login.js';
import {sleep} from '../scripts/regression-fixture.mjs';
const fakeContext=(user={id:'123',name:'Tester'})=>{
 const context=new EventEmitter();let closed=false;
 context.pages=()=>[{url:()=> 'https://www.pixiv.net/',goto:async()=>{},evaluate:async()=>user}];
 context.cookies=async()=>[{name:'PHPSESSID',value:'123-secret'}];
 context.close=async()=>{closed=true;context.emit('close');};context.isClosed=()=>closed;return context;
};
test('official login verifies authenticated page before saving cookie and closing dedicated browser',{timeout:6000},async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dflow-login-test-'));let launches=0,saved;const context=fakeContext();
 const login=new PixivBrowserLogin(temp,async(cookie,user)=>saved={cookie,user},{browserPath:'fake',launch:async()=>{launches++;await sleep(20);return context;}});
 try{await Promise.all([login.start(),login.start()]);assert.equal(launches,1);assert.equal(login.status().status,'waiting');await sleep(1200);assert.equal(saved.cookie,'PHPSESSID=123-secret');assert.equal(login.status().status,'connected');assert.equal(context.isClosed(),true);}finally{await login.cancel();await fs.rm(temp,{recursive:true,force:true});}
});
test('anonymous PHPSESSID is not mistaken for authenticated Pixiv login',{timeout:6000},async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dflow-login-test-'));let saved=false;const context=fakeContext(null);
 const login=new PixivBrowserLogin(temp,()=>saved=true,{browserPath:'fake',launch:async()=>context});
 try{await login.start();await sleep(1200);assert.equal(saved,false);assert.equal(login.status().status,'waiting');await login.cancel();assert.equal(context.isClosed(),true);assert.equal(login.status().status,'cancelled');}finally{await login.cancel();await fs.rm(temp,{recursive:true,force:true});}
});
test('cancelling while browser is launching does not resurrect a login window',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dflow-login-test-'));let release;const context=fakeContext();
 const login=new PixivBrowserLogin(temp,()=>assert.fail('must not save'),{browserPath:'fake',launch:()=>new Promise(resolve=>release=resolve)});
 try{const opening=login.start();await login.cancel();release(context);await opening;assert.equal(context.isClosed(),true);assert.equal(login.status().status,'cancelled');}finally{await login.cancel();await fs.rm(temp,{recursive:true,force:true});}
});
