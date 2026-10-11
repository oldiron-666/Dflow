import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import sharp from 'sharp';
import {createThumbnailCache} from '../thumbnails.js';
import {fixture, favorite, entry} from '../scripts/regression-fixture.mjs';
import {presetDefaults} from '../presets.js';

const picture = (width, height, colour = '#357baa') => sharp({create: {
  width, height, channels: 4, background: colour
}}).png().toBuffer();

test('half thumbnails preserve originals, reuse concurrent work, refresh replacements and rotate EXIF', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dflow-thumbnail-'));
  try {
    const source = path.join(root, 'original.png');
    const original = await picture(1200, 800);
    await fs.writeFile(source, original);
    const generate = createThumbnailCache(path.join(root, 'thumbs'));
    const copies = await Promise.all(Array.from({length: 12}, () => generate(source)));
    assert.equal(new Set(copies).size, 1);
    const meta = await sharp(copies[0]).metadata();
    assert.equal(meta.format, 'webp');assert.equal(meta.width, 600);assert.equal(meta.height, 400);
    assert.deepEqual(await fs.readFile(source), original);
    assert.equal((await fs.readdir(path.join(root, 'thumbs'))).length, 1);
    await fs.writeFile(source, await picture(400, 1000, '#aa3535'));
    const changed = await generate(source);
    assert.notEqual(changed, copies[0]);
    assert.equal((await sharp(changed).metadata()).height, 500);
    const rotated = path.join(root, 'rotate.jpg');
    await sharp(await picture(800, 400)).jpeg().withMetadata({orientation: 6}).toFile(rotated);
    const oriented = await sharp(await generate(rotated)).metadata();
    assert.equal(oriented.width, 200);assert.equal(oriented.height, 400);
    const invalid = path.join(root, 'broken.png');await fs.writeFile(invalid, 'broken');
    await assert.rejects(generate(invalid));
    assert.ok(await generate(source), 'failed job does not block later work');
    assert.equal((await fs.readdir(path.join(root, 'thumbs'))).some(x => x.endsWith('.tmp')), false);
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});

test('local thumbnail endpoints keep HD bytes, revalidate cache and invalidate upload/move', async () => {
  const f = await fixture({favorites: [favorite('local_thumb', 'worded', 0, {prompt: 'Fixture prompt'})], entries: [entry('manual-thumb', 'worded', 0)]});
  try {
    const source = path.join(f.data, 'favorites', 'worded', 'local_thumb.png');
    const original = await picture(1200, 800);
    await fs.writeFile(source, original);
    const route = '/api/reverse/image/local_thumb';
    let response = await f.request(route+'?thumbnail=1');
    assert.equal(response.status, 200);assert.match(response.headers.get('content-type'), /image\/webp/);
    assert.match(response.headers.get('cache-control'), /private, no-cache/);
    const etag = response.headers.get('etag');
    let meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(meta.width, 600);assert.equal(meta.height, 400);
    assert.deepEqual(Buffer.from(await (await f.request(route)).arrayBuffer()), original);
    const unchanged = await new Promise((resolve, reject) => {
      http.get(f.base+route+'?thumbnail=1', {headers: {'If-None-Match': etag}}, res => {res.resume();resolve(res.statusCode);}).on('error', reject);
    });
    assert.equal(unchanged, 304);
    await f.request('/api/favorites/local_thumb', {folder: 'completed'}, 'PATCH');
    response = await f.request(route+'?thumbnail=1');assert.equal(response.status, 200);
    assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width, 600);
    const replacement = await picture(600, 1000, '#aaaa35');
    const upload = await fetch(f.base+'/api/worded/images/manual-thumb?width=600&height=1000', {
      method: 'PUT', headers: {'Content-Type': 'image/png'}, body: replacement
    });assert.equal(upload.status, 200);
    const manualRoute = '/api/worded/images/manual-thumb';
    response = await f.request(manualRoute+'?thumbnail=1');
    const oldTag = response.headers.get('etag');
    meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(meta.width, 300);assert.equal(meta.height, 500);
    assert.deepEqual(Buffer.from(await (await f.request(manualRoute)).arrayBuffer()), replacement);
    await fetch(f.base+manualRoute+'?width=1000&height=600', {method: 'PUT', headers: {'Content-Type':'image/png'}, body: await picture(1000,600)});
    response = await f.request(manualRoute+'?thumbnail=1', undefined, 'GET', {'If-None-Match': oldTag});
    assert.equal(response.status, 200);
    assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width, 500);
    assert.equal((await f.request('/api/reverse/image/missing?thumbnail=1')).status, 404);
    await fs.writeFile(path.join(f.data, 'favorites', 'completed', 'local_thumb.png'), 'not a supported image');
    assert.equal((await f.request(route+'?thumbnail=1')).status, 200, 'unsupported thumbnail falls back to original');
  } finally { await f.close(); }
});

test('bundled poster/cinema preset replacements use current filenames and load verbatim', async () => {
  const defaults = presetDefaults();
  assert.deepEqual(defaults.expansion.slice(0, 5).map(x => x.name), ['通用扩写', '插画', '电影', '海报', '巨构提示词']);
  const published = ['通用扩写', '插画', '电影', '海报', '巨构提示词', 'nai提示词测试-Antigravity', 'nai提示词测试-ChatGPT', 'nai提示词测试-deepseekv4pro', 'nai提示词测试-gemini3.8flash', 'nai提示词测试-muse'];
  assert.ok(defaults.expansion.every(x => published.includes(x.name)));
  for (const name of ['海报', '电影']) {
    const content = await fs.readFile(new URL(`../presets/${name}.txt`, import.meta.url), 'utf8');
    assert.equal(defaults.expansion.find(x => x.name === name).content, content);
  }
  assert.match(defaults.expansion.find(x => x.name === '海报').content, /Swiss International/);
  assert.match(defaults.expansion.find(x => x.name === '电影').content, /Photorealistic Live-Action Cinema Still/);
});
