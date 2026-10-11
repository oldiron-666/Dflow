import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonicalExpansionName, migratePresetNames, syncPresetLibrary, savePresetLibrary, readPresetLibrary, presetDefaults } from '../presets.js';
import { fixture, favorite, entry, root } from '../scripts/regression-fixture.mjs';
const library = (expansion, defaultExpansion = expansion[0].name) => ({
  reverse: [{name: '个人反推', content: 'Personal reverse fixture'}],
  expansion, defaultExpansion, defaultReverse: '个人反推'
});

test('preset migration renames only the two legacy expansion names, preserving private content/defaults', () => {
  const raw = library([
    {name: '动漫海报', content: 'Personal poster fixture'},
    {name: '电影感动漫', content: 'Personal cinema fixture'},
    {name: '自定义', content: 'Personal other fixture'}
  ], '电影感动漫');
  const before = structuredClone(raw), next = migratePresetNames(raw);
  assert.deepEqual(raw, before, 'caller-owned data is not mutated');
  assert.deepEqual(next.expansion, raw.expansion.map((x, i) => ({...x, name: ['海报', '电影', '自定义'][i]})));
  assert.equal(next.defaultExpansion, '电影');
  assert.equal(next.defaultReverse, '个人反推');
  assert.deepEqual(next.reverse, raw.reverse);
  assert.equal(canonicalExpansionName('随机'), '随机');
  assert.equal(canonicalExpansionName(undefined), undefined);
  assert.deepEqual(migratePresetNames(next), next, 'migration is idempotent');
});

test('preset migration resolves duplicate old/new names in favor of the existing current name', () => {
  for (const reversed of [false, true]) {
    const items = [{name: '动漫海报', content: 'Old fixture'}, {name: '海报', content: 'Current fixture'}];
    const next = migratePresetNames(library(reversed ? items.reverse() : items, '动漫海报'));
    assert.deepEqual(next.expansion, [{name: '海报', content: 'Current fixture'}]);
    assert.equal(next.defaultExpansion, '海报');
  }
});

test('preset synchronization adds only missing built-ins and respects the 30-entry limit', () => {
  const raw = library([{name: '动漫海报', content: 'Keep my poster fixture'}]);
  const next = syncPresetLibrary(raw);
  assert.equal(next.expansion.find(x => x.name === '海报').content, 'Keep my poster fixture');
  assert.equal(next.defaultExpansion, '海报');
  for (const item of presetDefaults().expansion) assert.ok(next.expansion.some(x => x.name === item.name));
  assert.deepEqual(syncPresetLibrary(next), next);
  const full = library(Array.from({length: 30}, (_, i) => ({name: `Custom ${i}`, content: 'Private fixture'})));
  assert.equal(syncPresetLibrary(full).expansion.length, 30);
  assert.deepEqual(syncPresetLibrary(full).expansion, full.expansion);
  assert.equal(syncPresetLibrary(library(full.expansion.slice(0, 29))).expansion.length, 30);
});

test('private preset library migration and old card references survive restart without rewriting prompts', {timeout: 15000}, async () => {
  const f = await fixture({
    favorites: [favorite('local_legacy', 'worded', 0, {preset: '动漫海报', prompt: 'Favorite prompt fixture'})],
    entries: [entry('legacy-manual', 'worded', 0, {preset: '电影感动漫', promptWrittenAt: '2026-01-02'})]
  });
  try {
    savePresetLibrary(f.data, library([
      {name: '动漫海报', content: 'Private poster fixture'},
      {name: '电影感动漫', content: 'Private cinema fixture'},
      {name: '自定义', content: 'Keep custom fixture'}
    ], '电影感动漫'));
    await f.restart();
    const presets = await (await f.request('/api/mcp/presets')).json();
    assert.equal(presets.defaultExpansion, '电影');
    assert.equal(presets.expansion.find(x => x.name === '海报').content, 'Private poster fixture');
    assert.equal(presets.expansion.find(x => x.name === '自定义').content, 'Keep custom fixture');
    assert.deepEqual(readPresetLibrary(f.data), presets);
    const state = await (await f.request('/api/state')).json();
    assert.equal(state.favorites.find(x => x.id === 'local_legacy').preset, '海报');
    const gallery = await (await f.request('/api/local-gallery')).json();
    const card = gallery.entries.find(x => x.id === 'legacy-manual');
    assert.equal(card.preset, '电影');
    assert.equal(card.positive, 'Fixture prompt');
    assert.equal(card.promptWrittenAt, '2026-01-02');
    await f.restart();
    assert.deepEqual(await (await f.request('/api/mcp/presets')).json(), presets);
    const manifest = JSON.parse(await fs.readFile(path.join(f.data, 'mcp-presets', 'config.json'), 'utf8'));
    assert.ok(manifest.expansion.every(x => !['动漫海报', '电影感动漫'].includes(x.name)));
  } finally { await f.close(); }
});

test('preset API reloads edited private files, migrates PUT names and retains legacy JSON backup', {timeout: 15000}, async () => {
  const f = await fixture();
  try {
    const raw = library([{name: '动漫海报', content: 'Legacy fixture'}]);
    const legacyPath = path.join(f.data, 'mcp-presets.json');
    const backup = JSON.stringify(raw);
    await fs.writeFile(legacyPath, backup);
    await f.restart();
    assert.equal((await (await f.request('/api/mcp/presets')).json()).defaultExpansion, '海报');
    assert.equal(await fs.readFile(legacyPath, 'utf8'), backup);
    let response = await f.request('/api/mcp/presets', raw, 'PUT');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).defaultExpansion, '海报');
    const manifest = JSON.parse(await fs.readFile(path.join(f.data, 'mcp-presets', 'config.json'), 'utf8'));
    const file = path.join(f.data, 'mcp-presets', 'expansion', manifest.expansion[0].file);
    await fs.writeFile(file, 'Externally edited private fixture');
    const next = await (await f.request('/api/mcp/presets')).json();
    assert.equal(next.expansion.find(x => x.name === '海报').content, 'Externally edited private fixture');
  } finally { await f.close(); }
});

test('Git ignores unpublished local presets and personal data but allows current poster/cinema filenames', () => {
  const paths = ['presets/not-published-fixture.txt', 'data/not-published-fixture.json', 'presets/海报.txt', 'presets/电影.txt'];
  const output = execFileSync('git', ['check-ignore', '--no-index', '--', ...paths], {cwd: root, encoding: 'utf8'}).trim().split(/\r?\n/);
  assert.deepEqual(output, paths.slice(0, 2));
});
