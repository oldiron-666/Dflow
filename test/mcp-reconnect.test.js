import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fixture,root,sleep} from '../scripts/regression-fixture.mjs';
test('stdio MCP registers immediately, recovers service restart, stays revoked and avoids duplicate sessions',{timeout:20000},async()=>{
 const f=await fixture();let client;try{
  client=new Client({name:'restart-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp-server.js')],cwd:root,env:{...process.env,DFLOW_PORT:String(f.port)}}));
  const call=()=>client.callTool({name:'list_pending',arguments:{}});
  await Promise.all(Array.from({length:5},call));let sessions=await (await f.request('/api/mcp/sessions')).json();assert.equal(sessions.length,1);assert.equal(sessions[0].name,'restart-test');
  const initial=sessions[0].id;await f.restart();const result=await call();assert.notEqual(result.isError,true);sessions=await (await f.request('/api/mcp/sessions')).json();assert.equal(sessions.length,1);assert.notEqual(sessions[0].id,initial);
  await f.request(`/api/mcp/sessions/${sessions[0].id}`,undefined,'DELETE');const revoked=await call();assert.equal(revoked.isError,true);assert.match(revoked.content[0].text,/断开/);
  await sleep(5500);assert.equal((await (await f.request('/api/mcp/sessions')).json()).length,0);
 }finally{await client?.close();await f.close();}
});
