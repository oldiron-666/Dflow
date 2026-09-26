import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REVERSE } from './reverse-workflow.js';
const project = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXPANSION = fs.readFileSync(path.join(project, 'presets', '通用扩写.txt'), 'utf8');
export const PRESET_STORE = 'mcp-presets.json';
export function presetDefaults() {
  return { reverse: [{ name: '通用反推', content: DEFAULT_REVERSE }], expansion: [{ name: '通用扩写', content: DEFAULT_EXPANSION }], defaultReverse: '通用反推', defaultExpansion: '通用扩写' };
}
export function validatePresets(raw) {
  if (!raw || typeof raw !== 'object') throw Error('无效预设配置');
  const clean = type => {
    if (!Array.isArray(raw[type]) || !raw[type].length || raw[type].length > 30) throw Error(`${type} 至少一个且最多 30 个预设`);
    const names = new Set();
    return raw[type].map(entry => {
      const name = String(entry?.name || '').trim(), content = String(entry?.content || '');
      if (!name || name.length > 60 || name === '随机' || names.has(name)) throw Error(`预设名称无效或重复：${name}`);
      if (!content.trim() || content.length > 100000) throw Error(`${name} 内容不能为空或超过 100000 字符`);
      names.add(name); return { name, content };
    });
  };
  const reverse = clean('reverse'), expansion = clean('expansion');
  const defaultReverse = String(raw.defaultReverse || ''), defaultExpansion = String(raw.defaultExpansion || '');
  if (!reverse.some(x => x.name === defaultReverse) || !expansion.some(x => x.name === defaultExpansion)) throw Error('默认预设必须存在');
  return { reverse, expansion, defaultReverse, defaultExpansion };
}


// Private on-disk preset library. The manifest is committed last, so a failed save
// leaves the previous manifest readable. Legacy mcp-presets.json is retained as backup.
export const PRESET_DIRECTORY = 'mcp-presets';
function presetFilename(name) {
  const safe = name.replace(/[\\/:*?"<>|.\x00-\x1f]/g, '_').replace(/[ .]+$/g, '').slice(0, 40) || 'preset';
  return `${safe}-${crypto.createHash('sha256').update(name).digest('hex').slice(0, 12)}.txt`;
}
export function savePresetLibrary(dataDir, raw) {
  const config = validatePresets(raw);
  const root = path.join(dataDir, PRESET_DIRECTORY);
  const manifest = { reverse: [], expansion: [], defaultReverse: config.defaultReverse, defaultExpansion: config.defaultExpansion };
  for (const type of ['reverse', 'expansion']) {
    const folder = path.join(root, type);
    fs.mkdirSync(folder, { recursive: true });
    for (const entry of config[type]) {
      const file = presetFilename(entry.name);
      const destination = path.join(folder, file);
      const temporary = `${destination}.tmp`;
      fs.writeFileSync(temporary, entry.content, 'utf8');
      fs.renameSync(temporary, destination);
      manifest[type].push({ name: entry.name, file });
    }
  }
  const temporary = path.join(root, 'config.json.tmp');
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(temporary, path.join(root, 'config.json'));
  // After the new manifest is durable, discard files removed or renamed in the UI.
  for (const type of ['reverse', 'expansion']) {
    const keep = new Set(manifest[type].map(entry => entry.file));
    for (const file of fs.readdirSync(path.join(root, type))) {
      if (file.endsWith('.txt') && !keep.has(file)) {
        try { fs.unlinkSync(path.join(root, type, file)); }
        catch (error) { console.warn(`无法清理旧预设文件 ${file}: ${error.message}`); }
      }
    }
  }
  return config;
}
export function readPresetLibrary(dataDir) {
  const root = path.join(dataDir, PRESET_DIRECTORY);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const result = { defaultReverse: manifest.defaultReverse, defaultExpansion: manifest.defaultExpansion };
  for (const type of ['reverse', 'expansion']) {
    result[type] = manifest[type].map(entry => {
      const file = String(entry.file || '');
      if (!file || path.basename(file) !== file || !file.endsWith('.txt')) throw Error('预设文件名无效');
      return { name: entry.name, content: fs.readFileSync(path.join(root, type, file), 'utf8') };
    });
  }
  return validatePresets(result);
}
