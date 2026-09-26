import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve('.');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9f8fSJ8AAAAASUVORK5CYII=', 'base64');
function metadataPng() {
  const payload = Buffer.from('prompt\0' + JSON.stringify({ '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'test.safetensors' } } }));
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0); chunk.write('tEXt', 4); payload.copy(chunk, 8);
  // Parser checks chunk bounds and metadata; CRC is not currently validated by its existing implementation.
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}
test('stdio MCP end-to-end on isolated DFlow data', { timeout: 60000 }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dflow-mcp-'));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const service = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, DFLOW_DATA_DIR: path.join(temp, 'data'), PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
  let client;
  try {
    let up = false;
    for (let n = 0; n < 60; n++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/reverse/queue`); if (r.ok) { up = true; break; } } catch { /* starting */ }
      await sleep(100);
    }
    assert.ok(up, 'test service did not start');
    const imagePath = path.join(temp, 'test.png'), metadataPath = path.join(temp, 'comfy.png');
    await fs.writeFile(imagePath, png); await fs.writeFile(metadataPath, metadataPng());
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp-server.js')], cwd: root, env: { ...process.env, DFLOW_PORT: String(port) }, maxBufferSize: 64 * 1024 * 1024 });
    client = new Client({ name: 'dflow-test', version: '0.1' });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(x => x.name).sort(), ['claim_next_pending','complete_pending','create_worded_card','fail_pending','get_reverse_workflow','import_metadata_png','list_pending','read_pending_image']);
    const call = (name, args = {}) => client.callTool({ name, arguments: args });
    const body = result => JSON.parse(result.content[0].text);
    assert.equal(body(await call('list_pending')).total, 0);
    const sessionResponse=await fetch(`http://127.0.0.1:${port}/api/mcp/sessions`);
    const sessions=await sessionResponse.json();
    assert.ok(sessions.some(x=>x.name==='dflow-test'));
    const configResponse=await fetch(`http://127.0.0.1:${port}/api/mcp/presets`);
    const config=await configResponse.json();
    assert.deepEqual(config.expansion.map(x=>x.name), ['通用扩写']);
    const update=await fetch(`http://127.0.0.1:${port}/api/mcp/presets`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...config,reverse:[...config.reverse,{name:'自定义反推',content:'先观察事实'}],expansion:[...config.expansion,{name:'自定义扩写',content:'完整扩写画面'}]})});
    assert.equal(update.status,200);
    const library = JSON.parse(await fs.readFile(path.join(temp,'data','mcp-presets','config.json'),'utf8'));
    assert.ok(library.reverse.some(x=>x.name==='自定义反推'));
    assert.ok(library.expansion.some(x=>x.name==='自定义扩写'));
    for (const type of ['reverse','expansion']) for (const entry of library[type])
      assert.ok((await fs.readFile(path.join(temp,'data','mcp-presets',type,entry.file),'utf8')).length>0);

    assert.equal((await call('create_worded_card', { prompt: 'test' })).isError, true);
    const card = body(await call('create_worded_card', { prompt: 'a sample prompt', imagePath }));
    assert.equal(card.width, 1); assert.equal(card.height, 1); assert.equal(card.imageExt, 'png');
    const entries = await (await fetch(`http://127.0.0.1:${port}/api/worded/entries`)).json();
    assert.equal(entries.length, 1);
    const imported = body(await call('import_metadata_png', { imagePath: metadataPath }));
    assert.equal(imported.hasMetadata, true); assert.equal(imported.model, 'test.safetensors');
    const badMeta = await call('import_metadata_png', { imagePath });
    assert.equal(badMeta.isError, true);
    const move = await fetch(`http://127.0.0.1:${port}/api/worded/state/${card.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: 'pending' }) });
    assert.equal(move.status, 200);
    const selected=await fetch(`http://127.0.0.1:${port}/api/worded/state/${card.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({preset:'自定义扩写',reversePreset:'自定义反推'})});
    assert.equal(selected.status,200);
    assert.equal(body(await call('list_pending')).total, 1);
    const step=body(await call('get_reverse_workflow',{id:card.id}));
    assert.equal(step.reverseInstructions,'先观察事实');
    assert.equal(step.expansionInstructions,'完整扩写画面');

    const image = await call('read_pending_image', { id: card.id });
    assert.equal(image.content[1].mimeType, 'image/png');
    assert.deepEqual(Buffer.from(image.content[1].data, 'base64'), png);
    const claim=body(await call('claim_next_pending'));
    assert.equal(claim.item.id, card.id);
    assert.ok(claim.workflow.sequence[1].includes('反推'));
    assert.equal(claim.workflow.expansionInstructions,'完整扩写画面');

    const prompt = 'Detailed expanded prompt for a picture, preserving its composition, light, environment and visual hierarchy. '.repeat(4);
    const completed = body(await call('complete_pending', { id: card.id, prompt, resolvedPreset: '自定义扩写' }));
    assert.equal(completed.item.folder, 'worded');
    assert.equal(body(await call('list_pending')).total, 0);
    const disconnect=await fetch(`http://127.0.0.1:${port}/api/mcp/sessions/${sessions[0].id}`,{method:'DELETE'});
    assert.equal(disconnect.status,200);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/mcp/sessions`)).json()).length,0);
  } finally {
    if (client) await client.close();
    service.kill();
    await new Promise(resolve => service.once('exit', resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
});

