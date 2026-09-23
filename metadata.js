import { inflateSync } from 'node:zlib';

const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const decode = bytes => bytes.toString('utf8').slice(0, 2_000_000);
export function inspectPng(bytes) {
  if (!bytes.subarray(0,8).equals(signature)) throw Error('只支持 PNG 图片');
  const texts = {};
  let width = 0, height = 0, offset = 8;
  for (let n = 0; offset + 12 <= bytes.length && n < 10000; n++) {
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset+4, offset+8);
    if (size > bytes.length - offset - 12) throw Error('PNG 文件不完整');
    const chunk = bytes.subarray(offset+8, offset+8+size);
    if (type === 'IHDR' && size >= 8) { width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); }
    if (['tEXt','iTXt','zTXt'].includes(type) && size < 2_000_000) {
      const end = chunk.indexOf(0);
      if (end > 0 && end < 128) {
        const key = chunk.toString('latin1',0,end);
        try {
          let value;
          if (type === 'tEXt') value = decode(chunk.subarray(end+1));
          else if (type === 'zTXt' && chunk[end+1] === 0) value = decode(inflateSync(chunk.subarray(end+2),{maxOutputLength:2_000_000}));
          else if (type === 'iTXt') {
            const compressed = chunk[end+1] === 1;
            const languageEnd = chunk.indexOf(0,end+3), translatedEnd = chunk.indexOf(0,languageEnd+1);
            if (languageEnd < 0 || translatedEnd < 0) throw Error('Invalid iTXt');
            const payload = chunk.subarray(translatedEnd+1);
            value = decode(compressed ? inflateSync(payload,{maxOutputLength:2_000_000}) : payload);
          }
          if (value) texts[key] = value;
        } catch { /* Invalid text chunk must not prevent reading other metadata. */ }
      }
    }
    offset += size+12;
    if (type === 'IEND') break;
  }
  if (!width || !height) throw Error('PNG 缺少图像尺寸');
  const graph = safeJson(texts.prompt);
  const workflow = safeJson(texts.workflow);
  const nodes = graph && typeof graph === 'object' && !Array.isArray(graph) ? Object.values(graph).filter(x => x && typeof x === 'object' && x.class_type) : [];
  const find = (name) => nodes.filter(x => name.test(x.class_type));
  const first = (...names) => names.map(name => find(name)[0]?.inputs).find(Boolean) || {};
  const sampler = first(/KSampler|SamplerCustom/i);
  const ckpt = first(/CheckpointLoader|UNETLoader|DiffusionModelLoader/i);
  // A workflow-only PNG lacks executable prompt connections, but standard widget values
  // can still supply model, LoRA and generation settings without inventing prompt text.
  const workflowNodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const widget = pattern => workflowNodes.find(node => pattern.test(node.type || '') && Array.isArray(node.widgets_values))?.widgets_values || [];
  const wfCheckpoint = widget(/CheckpointLoaderSimple|UNETLoader/);
  const wfSampler = widget(/^KSampler$/);
  const wfLoras = workflowNodes.filter(node => /LoraLoader/i.test(node.type || '') && Array.isArray(node.widgets_values))
    .map(node => ({name:node.widgets_values[0],strength:node.widgets_values[1]})).filter(x => typeof x.name === 'string' && x.name !== 'None');
  const loras = find(/LoraLoader|LoraStacker|Power Lora Loader/i).flatMap(node => {
    const input = node.inputs || {};
    const direct = input.lora_name ? [{name:String(input.lora_name),strength:input.strength_model ?? input.strength ?? null}] : [];
    const stacked = Object.entries(input).filter(([k,v]) => /lora_\d+|loras/i.test(k) && Array.isArray(v) && v.every(x => !Array.isArray(x)))
      .flatMap(([,v]) => v.filter(x => x && typeof x === 'object').map(x => ({name:x.lora || x.lora_name || x.name, strength:x.strength ?? x.strength_model})));
    return [...direct,...stacked].filter(x => x.name && x.name !== 'None');
  });
  function promptFromLink(link, seen = new Set()) {
    if (!Array.isArray(link) || seen.has(String(link[0]))) return '';
    seen.add(String(link[0]));
    const node = graph?.[String(link[0])];
    if (!node) return '';
    const input = node.inputs || {};
    if (/CLIPTextEncode|TextEncode/i.test(node.class_type) && typeof input.text === 'string') return input.text;
    if (typeof input.text === 'string' && /prompt|string/i.test(node.class_type)) return input.text;
    return Object.values(input).filter(v => Array.isArray(v) && (typeof v[0] === 'number' || typeof v[0] === 'string')).map(v => promptFromLink(v,seen)).filter(Boolean).join('\n');
  }
  const positive = promptFromLink(sampler.positive) || find(/CLIPTextEncode/i).map(n => n.inputs?.text).find(x => typeof x === 'string') || '';
  const negative = promptFromLink(sampler.negative);
  loras.push(...wfLoras);
  const parameters = texts.parameters || '';
  const legacy = !nodes.length && parameters ? parseA1111(parameters) : {};
  return { width,height, hasMetadata:Boolean(nodes.length || workflow || parameters), model:String(ckpt.ckpt_name || ckpt.unet_name || wfCheckpoint[0] || legacy.model || ''),
    positive:positive || legacy.positive || '', negative:negative || legacy.negative || '', loras,
    seed:scalar(sampler.seed ?? sampler.noise_seed ?? wfSampler[0] ?? legacy.seed), steps:scalar(sampler.steps ?? wfSampler[2] ?? legacy.steps), cfg:scalar(sampler.cfg ?? wfSampler[3] ?? legacy.cfg),
    sampler:scalar(sampler.sampler_name ?? wfSampler[4] ?? legacy.sampler), scheduler:scalar(sampler.scheduler ?? wfSampler[5] ?? legacy.scheduler), denoise:scalar(sampler.denoise ?? wfSampler[6]),
    source: nodes.length ? 'ComfyUI prompt' : texts.workflow ? 'ComfyUI workflow' : parameters ? 'PNG parameters' : '' };
}
function safeJson(value) { try { return JSON.parse(value); } catch { return null; } }
function scalar(value) { return value == null || typeof value === 'object' ? '' : String(value); }
function parseA1111(text) {
  const line = text.split('\n').findIndex(x => /Steps:/.test(x));
  if (line < 0) return {positive:text};
  const body = text.split('\n');
  const fields = {};
  for (const m of body.slice(line).join(' ').matchAll(/(?:^|,\s*)(Steps|Sampler|Schedule type|CFG scale|Seed|Model):\s*([^,]+)/g)) fields[m[1]] = m[2].trim();
  const preceding = body.slice(0,line).join('\n').split(/Negative prompt:/i);
  return {positive:preceding[0].trim(), negative:(preceding[1]||'').trim(),steps:fields.Steps,sampler:fields.Sampler,scheduler:fields['Schedule type'],cfg:fields['CFG scale'],seed:fields.Seed,model:fields.Model};
}
