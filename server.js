import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { inspectPng } from "./metadata.js";
import { fileURLToPath } from "node:url";
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const DANBOORU = "https://danbooru.donmai.us";
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = process.env.DFLOW_DATA_DIR ? path.resolve(process.env.DFLOW_DATA_DIR) : path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "dflow-state.json");
const REVERSE_DIR = path.join(DATA_DIR, "reverse");
const ORIGINAL_IMAGE_DIR = path.join(DATA_DIR, "favorites", "original");
const PENDING_IMAGE_DIR = path.join(DATA_DIR, "favorites", "pending");
const COMPLETED_IMAGE_DIR = path.join(DATA_DIR, "favorites", "completed");
const WORDED_IMAGE_DIR = path.join(DATA_DIR, "favorites", "worded");
const PRESET_NAMES = ["动作扩写", "艺术导演扩写", "巨构提示词", "动漫专用", "瑶光真人", "通用扩写"];
const VALID_PRESETS = new Set([...PRESET_NAMES, "随机"]);
const favoriteFolderOf = post => ["original", "pending", "worded", "completed"].includes(post.folder) ? post.folder : (post.completed ? "completed" : "original");
const defaultSharedState = () => ({
  account: { loginName: "", loginKey: "", googleTranslateKey: "" },
  favorites: [],
  preferences: { mode: "latest", columns: 5, ratings: ["g", "s", "q", "e"], search: "", selectedTags: [] },
  updatedAt: null
});
function readSharedState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      ...defaultSharedState(), ...parsed,
      account: { ...defaultSharedState().account, ...(parsed.account || {}) },
      preferences: { ...defaultSharedState().preferences, ...(parsed.preferences || {}) },
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.map(cleanFavorite).filter(Boolean) : []
    };
  } catch {
    return defaultSharedState();
  }
}
let sharedState = readSharedState();
function renumberReverseQueue() {
  const entries = sharedState.favorites.map((item, index) => ({item, index}))
    .filter(({item}) => item.folder === "pending" && item.autoEnabled);
  entries.sort((a, b) => (a.item.queueOrder || Infinity) - (b.item.queueOrder || Infinity) || a.index - b.index);
  entries.forEach(({item}, index) => { item.queueOrder = index + 1; });
  sharedState.favorites.filter(item => item.folder !== "pending" || !item.autoEnabled)
    .forEach(item => { item.queueOrder = 0; });
}
function nextReverseOrder() {
  return Math.max(0, ...sharedState.favorites.map(item => item.folder === "pending" ? item.queueOrder || 0 : 0)) + 1;
}
function reverseQueueSnapshot() {
  return sharedState.favorites.filter(item => item.folder === "pending")
    .map(item => ({id:item.id, autoEnabled:item.autoEnabled, queueOrder:item.queueOrder}));
}
renumberReverseQueue();
function writeSharedState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  sharedState.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(sharedState, null, 2), "utf8");
}
function cleanFavorite(post) {
  if (!post || !Number(post.id)) return null;
  return {
    id: Number(post.id), rating: String(post.rating || "s"),
    preview_file_url: String(post.preview_file_url || ""), large_file_url: String(post.large_file_url || ""), file_url: String(post.file_url || ""),
    image_width: Number(post.image_width) || 0, image_height: Number(post.image_height) || 0,
    tag_string_general: String(post.tag_string_general || ""), tag_string_character: String(post.tag_string_character || ""),
    tag_string_copyright: String(post.tag_string_copyright || ""), created_at: String(post.created_at || ""), completed: favoriteFolderOf(post) === "completed",
    folder: favoriteFolderOf(post), preset: VALID_PRESETS.has(post.preset) ? post.preset : "动漫专用",
    autoEnabled: post.autoEnabled !== false, queueOrder: Math.max(0, Number(post.queueOrder) || 0), prompt: String(post.prompt || "").slice(0, 100000), customInstruction: String(post.customInstruction || "").slice(0, 4000),
    resolvedPreset: String(post.resolvedPreset || ""), reverseStatus: String(post.reverseStatus || "idle"),
    reverseError: String(post.reverseError || "").slice(0, 1000),
    cacheStatus: String(post.cacheStatus || "idle"), cacheFile: String(post.cacheFile || ""),
    cacheError: String(post.cacheError || "").slice(0, 1000), reverseStartedAt: String(post.reverseStartedAt || ""), wordedAt: String(post.wordedAt || "")
  };
}
// An optional official Cloud Translation API key avoids the unauthenticated web
// endpoint's 429 throttling. Never expose the key to browsers or log its URL.
const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
async function googleTranslatePart(part, source, target, signal) {
  if (googleTranslateKey()) {
    const response = await fetch('https://translation.googleapis.com/language/translate/v2', {
      method: 'POST',
      headers: {'Content-Type':'application/json', 'X-goog-api-key':googleTranslateKey()},
      body: JSON.stringify({q:part, source, target, format:'text'}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)])
    });
    if (!response.ok) throw Error(`Google Cloud Translation HTTP ${response.status}（请检查 API Key、服务启用和结算配置）`);
    const data = await response.json();
    const translated = data?.data?.translations?.[0]?.translatedText;
    if (typeof translated !== 'string') throw Error('Google Cloud Translation 响应格式错误');
    // Cloud Translation v2 encodes HTML entities even with format:text.
    return translated.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|#39);/gi, (match, entity) => {
      const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'"};
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const value = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    });
  }
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.search = new URLSearchParams({client:'gtx',sl:source,tl:target,dt:'t',q:part}).toString();
  const response = await fetch(url, {signal:AbortSignal.any([signal, AbortSignal.timeout(20000)])});
  if (!response.ok) throw Error(response.status === 429
    ? 'Google 网页翻译返回 429（即使短句也会失败）；需要等待 Google 解除限制，或自愿配置官方 Cloud Translation API Key'
    : `Google 网页翻译 HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data?.[0])) throw Error('Google 网页翻译响应格式错误');
  return data[0].map(segment => segment?.[0] || '').join('');
}
function translationChunks(text, maxLength = 900) {
  const chunks = []; let current = '';
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    let rest = line;
    while (rest.length) {
      const room = maxLength - current.length;
      if (!room) { chunks.push(current); current = ''; continue; }
      if (rest.length <= room) { current += rest; break; }
      if (current) { chunks.push(current); current = ''; continue; }
      let cut = rest.lastIndexOf(' ', maxLength);
      if (cut < maxLength / 2) cut = maxLength;
      current = rest.slice(0, cut); rest = rest.slice(cut);
      chunks.push(current); current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
app.post('/api/translate', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const direction = req.body?.direction;
  if (!['en-zh','zh-en'].includes(direction)) return res.status(400).json({error:'不支持的翻译方向'});
  if (!text.trim() || text.length > 50000) return res.status(400).json({error:'提示词不能为空或超过 50000 字符'});
  const [source, target] = direction === 'en-zh' ? ['en','zh-CN'] : ['zh-CN','en'];
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    const translated = [];
    for (const part of translationChunks(text)) {
      if (!part.trim()) { translated.push(part); continue; }
      translated.push(await googleTranslatePart(part, source, target, controller.signal));
    }
    if (!res.headersSent) res.json({text:translated.join('')});
  } catch (error) {
    if (!res.headersSent && !controller.signal.aborted) res.status(502).json({error:`Google 翻译失败：${error.message}`});
  }
});
app.post('/api/translate-segments', async (req, res) => {
  const segments = req.body?.segments;
  if (req.body?.direction !== 'en-zh' || !Array.isArray(segments) || !segments.length ||
      segments.length > 500 || segments.some(part => typeof part !== 'string') ||
      segments.reduce((sum, part) => sum + part.length, 0) > 50000) {
    return res.status(400).json({error:'翻译片段无效或过长'});
  }
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    const translated = [];
    for (const part of segments) {
      if (!part.trim()) { translated.push(part); continue; }
      const chunks = [];
      for (const chunk of translationChunks(part)) {
        chunks.push(await googleTranslatePart(chunk, 'en', 'zh-CN', controller.signal));
      }
      translated.push(chunks.join(''));
    }
    if (!res.headersSent) res.json({segments:translated});
  } catch (error) {
    if (!res.headersSent && !controller.signal.aborted) res.status(502).json({error:`Google 翻译失败：${error.message}`});
  }
});
app.get("/api/state", (_req, res) => res.json(sharedState));
app.put("/api/account", (req, res) => {
  sharedState.account = {
    loginName: String(req.body?.loginName || "").trim(),
    loginKey: String(req.body?.loginKey || "").trim(),
    googleTranslateKey: String(req.body?.googleTranslateKey || "").trim()
  };
  writeSharedState();
  res.json({ ok: true, account: sharedState.account, updatedAt: sharedState.updatedAt });
});
app.put("/api/preferences", (req, res) => {
  const allowedModes = new Set(["latest", "popular-day", "popular-week", "popular-month", "viewed", "favcount", "comment", "upvotes", "score", "rank", "mpixels", "favorites", "metadata"]);
  const validRatings = ["g", "s", "q", "e"];
  const body = req.body || {};
  const ratings = Array.isArray(body.ratings) ? body.ratings.filter(x => validRatings.includes(x)) : sharedState.preferences.ratings;
  sharedState.preferences = {
    mode: allowedModes.has(body.mode) ? body.mode : sharedState.preferences.mode,
    columns: Math.max(3, Math.min(8, Number(body.columns) || sharedState.preferences.columns || 5)),
    ratings: ratings.length ? [...new Set(ratings)] : sharedState.preferences.ratings,
    search: String(body.search ?? sharedState.preferences.search ?? "").slice(0, 1000),
    selectedTags: Array.isArray(body.selectedTags) ? [...new Set(body.selectedTags.map(String))].slice(0, 100) : sharedState.preferences.selectedTags
  };
  writeSharedState();
  res.json({ ok: true, preferences: sharedState.preferences, updatedAt: sharedState.updatedAt });
});
app.put("/api/favorites", (req, res) => {
  const values = Array.isArray(req.body?.favorites) ? req.body.favorites : [];
  // Browser copies may be stale: preserve worker-owned results and disk metadata.
  const oldById = new Map(sharedState.favorites.map(item => [Number(item.id), item]));
  sharedState.favorites = values.map(item => {
    const prior = oldById.get(Number(item?.id));
    return cleanFavorite(prior ? { ...item, folder: prior.folder, completed: prior.completed,
      preset: prior.preset, autoEnabled: prior.autoEnabled, queueOrder: prior.queueOrder, prompt: prior.prompt,
      resolvedPreset: prior.resolvedPreset, customInstruction: prior.customInstruction, reverseStatus: prior.reverseStatus,
      reverseError: prior.reverseError, cacheStatus: prior.cacheStatus,
      cacheFile: prior.cacheFile, cacheError: prior.cacheError, reverseStartedAt: prior.reverseStartedAt, wordedAt: prior.wordedAt } : item);
  }).filter(Boolean).slice(0, 5000);
  const kept = new Set(sharedState.favorites.map(item => item.id));
  for (const prior of oldById.values()) {
    if (kept.has(prior.id)) continue;
    const file = imagePath(prior);
    if (file) fs.rmSync(file, {force:true});
  }
  for (const item of sharedState.favorites) {
    if (item.cacheStatus === "ready" && !fs.existsSync(imagePath(item) || "")) {
      item.cacheFile = ""; item.cacheStatus = "idle"; item.cacheError = "";
    }
  }
  renumberReverseQueue();
  writeSharedState();
  for (const item of sharedState.favorites) if (item.cacheStatus === "idle" && item.folder !== "original") scheduleCache(item.id);
  for (const item of sharedState.favorites) if (!oldById.has(item.id) && item.folder === "original") scheduleCache(item.id);
  res.json({ ok: true, favorites: sharedState.favorites, updatedAt: sharedState.updatedAt });
});
// The reverse queue is local to this server. Never fetch originals for it.
const cacheJobs = new Set();
let cacheTail = Promise.resolve();
function favoriteById(id) { return sharedState.favorites.find(item => item.id === Number(id)); }
function imagePath(item) {
  if (!item.cacheFile || !/^[0-9]+\.(jpg|jpeg|png|webp|gif)$/i.test(item.cacheFile)) return null;
  return path.join(item.folder === "completed" ? COMPLETED_IMAGE_DIR : item.folder === "worded" ? WORDED_IMAGE_DIR : item.folder === "original" ? ORIGINAL_IMAGE_DIR : PENDING_IMAGE_DIR, item.cacheFile);
}
function scheduleCache(id) {
  const item = favoriteById(id);
  if (!item || item.cacheStatus === "ready" || cacheJobs.has(id)) return;
  cacheJobs.add(id);
  cacheTail = cacheTail.catch(() => {}).then(async () => {
    await new Promise(resolve => setTimeout(resolve, 850));
    const current = favoriteById(id);
    if (!current || current.cacheStatus === 'ready') { cacheJobs.delete(id); return; }
    current.cacheStatus = "loading"; current.cacheError = ""; writeSharedState();
    let tmp;
    try {
      const url = new URL(current.large_file_url);
      if (url.protocol !== "https:" || (url.hostname !== "donmai.us" && !url.hostname.endsWith(".donmai.us"))) throw Error("No valid large image URL");
      const response = await fetch(url, { headers: {"User-Agent":"DFlow/0.1 (local reverse cache)"}, signal:AbortSignal.timeout(60000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const type = (response.headers.get("content-type") || "").split(";")[0];
      const ext = {"image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif"}[type];
      if (!ext) throw Error("Response is not a supported image");
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length < 100 || body.length > 60 * 1024 * 1024) throw Error("Image size invalid or over 60 MB");
      const latest = favoriteById(id);
      if (!latest || latest.cacheStatus === 'ready') return;
      const dir = latest.folder === "completed" ? COMPLETED_IMAGE_DIR : latest.folder === "worded" ? WORDED_IMAGE_DIR : latest.folder === "original" ? ORIGINAL_IMAGE_DIR : PENDING_IMAGE_DIR;
      fs.mkdirSync(dir, {recursive:true});
      tmp = path.join(dir, `${id}.${ext}.part`);
      fs.writeFileSync(tmp, body);
      const filename = `${id}.${ext}`;
      fs.renameSync(tmp, path.join(dir, filename)); tmp = null;
      latest.cacheFile = filename; latest.cacheStatus = "ready"; latest.cacheError = "";
    } catch (error) {
      const latest = favoriteById(id);
      if (latest && latest.cacheStatus !== 'ready') {
        latest.cacheStatus = "error"; latest.cacheError = error.message;
      }
    } finally {
      if (tmp) fs.rmSync(tmp, {force:true});
      cacheJobs.delete(id);
      writeSharedState();
    }
  });
}
function moveCache(item, target) {
  const source = imagePath(item);
  if (source && fs.existsSync(source)) {
    const destDir = target === "completed" ? COMPLETED_IMAGE_DIR : target === "worded" ? WORDED_IMAGE_DIR : target === "original" ? ORIGINAL_IMAGE_DIR : PENDING_IMAGE_DIR;
    fs.mkdirSync(destDir, {recursive:true});
    fs.renameSync(source, path.join(destDir, item.cacheFile));
  }
}
app.patch("/api/favorites/:id", (req, res) => {
  const item = favoriteById(req.params.id);
  if (!item) return res.status(404).json({error:"Favorite not found"});
  const body = req.body || {};
  if (body.folder !== undefined) {
    if (!["original","pending","worded","completed"].includes(body.folder)) return res.status(400).json({error:"Invalid folder"});
    if (["pending","worded"].includes(item.folder) && body.folder === "completed" && (!item.prompt || item.cacheStatus !== "ready" || !fs.existsSync(imagePath(item) || ""))) return res.status(409).json({error:"Prompt and cached image required before release"});
    if (body.folder !== item.folder) moveCache(item, body.folder);
    item.folder = body.folder; item.completed = body.folder === "completed";
    if (body.folder === "pending") { item.autoEnabled = true; item.reverseStatus = "idle"; item.queueOrder = nextReverseOrder(); }
    if (body.folder === "worded") { item.autoEnabled = false; item.queueOrder = 0; item.wordedAt = new Date().toISOString(); }
  }
  if (body.prompt !== undefined) {
    if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 100000) return res.status(400).json({error:"提示词不能为空或超过 100000 字符"});
    item.prompt = body.prompt.trim();
    if (item.folder === "pending") { moveCache(item, "worded"); item.folder = "worded"; item.autoEnabled = false; item.queueOrder = 0; item.reverseStatus = "success"; item.wordedAt = new Date().toISOString(); }
  }
  if (body.customInstruction !== undefined) item.customInstruction = String(body.customInstruction || "").slice(0,4000);
  if (body.preset !== undefined) {
    if (!VALID_PRESETS.has(body.preset)) return res.status(400).json({error:"Invalid preset"});
    item.preset = body.preset;
  }
  if (typeof body.autoEnabled === "boolean") {
    if (body.autoEnabled && !item.autoEnabled && item.folder === "pending") {
      item.queueOrder = nextReverseOrder();
      // Enqueuing a finished card is an explicit request to regenerate it.
      item.reverseStatus = "idle"; item.reverseError = "";
    }
    item.autoEnabled = body.autoEnabled;
  }
  if (body.retryCache && item.folder === "pending") { item.cacheStatus = "idle"; item.cacheError = ""; }
  if (body.retryReverse && item.folder === "pending") { item.reverseStatus = "idle"; item.reverseError = ""; item.autoEnabled = true; item.queueOrder = nextReverseOrder(); }
  renumberReverseQueue();
  writeSharedState();
  if (item.cacheStatus === "idle") scheduleCache(item.id);
  res.json({ok:true, favorite:item, queue:reverseQueueSnapshot(), updatedAt:sharedState.updatedAt});
});
app.get("/api/reverse/queue", (_req, res) => {
  const pending = sharedState.favorites.filter(item => item.folder === "pending").sort((a,b) => (a.queueOrder || Infinity) - (b.queueOrder || Infinity));
  const manual=readWordIndex().filter(item=>item.folder==='pending');
  const all=[...pending.map(item=>({id:item.id,preset:item.preset,autoEnabled:item.autoEnabled,queueOrder:item.queueOrder,reverseStatus:item.reverseStatus,cacheStatus:item.cacheStatus,cacheError:item.cacheError,reverseError:item.reverseError,customInstruction:item.customInstruction,hasPrompt:Boolean(item.prompt),imagePath:item.cacheStatus==='ready'?imagePath(item):null})),...manual.map(item=>({id:item.id,preset:item.preset||'动漫专用',autoEnabled:item.autoEnabled!==false,queueOrder:item.queueOrder||0,reverseStatus:item.reverseStatus||'idle',cacheStatus:item.imageExt?'ready':'error',cacheError:'',reverseError:item.reverseError||'',customInstruction:'',hasPrompt:Boolean(item.positive),imagePath:item.imageExt?path.join(WORDED_IMAGE_DIR,item.id+'.'+item.imageExt):null}))];
  res.json({total:all.length, withoutPrompt:all.filter(item=>!item.hasPrompt).length,
    eligible:all.filter(item=>item.autoEnabled&&item.cacheStatus==='ready'&&item.reverseStatus==='idle').length,items:all});
});
app.post("/api/reverse/next", (_req, res) => {
  const item = sharedState.favorites.filter(x => x.folder === "pending" && x.autoEnabled && x.cacheStatus === "ready" && x.reverseStatus === "idle")
    .sort((a,b) => a.queueOrder - b.queueOrder)[0];
  if (!item) {
    const list=readWordIndex(),manual=list.filter(x=>x.folder==='pending'&&x.autoEnabled!==false&&x.imageExt&&(!x.reverseStatus||x.reverseStatus==='idle')).sort((a,b)=>(a.queueOrder||0)-(b.queueOrder||0))[0];
    if(!manual)return res.json({item:null});
    manual.reverseStatus='processing';saveWordIndex(list);
    return res.json({item:{id:manual.id,preset:manual.preset||'动漫专用',customInstruction:'',imagePath:path.join(WORDED_IMAGE_DIR,manual.id+'.'+manual.imageExt)}});
  }
  item.reverseStatus = "processing"; item.reverseError = ""; item.reverseStartedAt = new Date().toISOString();
  writeSharedState();
  res.json({item:{id:item.id, preset:item.preset, customInstruction:item.customInstruction, imagePath:imagePath(item)}});
});
app.post("/api/reverse/:id/result", (req, res) => {
  const item = favoriteById(req.params.id);
  if(!item){
    const list=readWordIndex(),manual=list.find(x=>x.id===req.params.id);
    if(!manual||manual.folder!=='pending'||manual.reverseStatus!=='processing')return res.status(409).json({error:'Item is not processing in the queue'});
    const prompt=String(req.body?.prompt||'').trim(),preset=String(req.body?.resolvedPreset||manual.preset||'动漫专用');
    if(!PRESET_NAMES.includes(preset)||(manual.preset!=='随机'&&preset!==(manual.preset||'动漫专用')))return res.status(400).json({error:'Preset mismatch'});
    if(prompt.length<(preset==='瑶光真人'?45:250))return res.status(422).json({error:'Prompt too short'});
    manual.positive=prompt.slice(0,100000);manual.folder='worded';manual.wordedAt=new Date().toISOString();manual.autoEnabled=false;manual.reverseStatus='success';manual.reverseError='';saveWordIndex(list);return res.json({ok:true,item:manual});
  }
  if (!item || item.folder !== "pending" || !item.autoEnabled || item.reverseStatus !== "processing") return res.status(409).json({error:"Item is not processing in the queue"});
  const prompt = String(req.body?.prompt || "").trim();
  const preset = String(req.body?.resolvedPreset || item.preset);
  if (!PRESET_NAMES.includes(preset) || (item.preset !== "随机" && preset !== item.preset)) return res.status(400).json({error:"Preset mismatch"});
  const minimum = preset === "瑶光真人" ? 45 : 250;
  if (prompt.length < minimum) return res.status(422).json({error:`Prompt too short (minimum ${minimum} characters)`});
  item.prompt = prompt.slice(0, 100000); item.resolvedPreset = preset;
  moveCache(item, "worded"); item.folder = "worded";
  item.reverseStatus = "success"; item.reverseError = ""; item.reverseStartedAt = ""; item.autoEnabled = false;
  renumberReverseQueue();
  writeSharedState();
  res.json({ok:true, favorite:item});
});
app.post("/api/reverse/:id/fail", (req, res) => {
  const item = favoriteById(req.params.id);
  if (!item || item.folder !== "pending") {
    const list=readWordIndex(),manual=list.find(x=>x.id===req.params.id&&x.folder==='pending');
    if(!manual)return res.status(404).json({error:'Item not pending'});
    manual.reverseStatus='failed';manual.reverseError=String(req.body?.reason||'Unknown error').slice(0,1000);saveWordIndex(list);return res.json({ok:true,item:manual});
  }
  item.reverseStatus = "failed"; item.reverseError = String(req.body?.reason || "Unknown error").slice(0,1000); item.reverseStartedAt = "";
  writeSharedState();
  res.json({ok:true, favorite:item});
});
app.put('/api/favorites/:id/image',express.raw({type:['image/png','image/jpeg','image/webp'],limit:'60mb'}),(req,res)=>{
  const item=favoriteById(req.params.id),body=req.body;
  if(!item)return res.status(404).json({error:'Favorite not found'});
  if(!Buffer.isBuffer(body)||body.length<24)return res.status(400).json({error:'Invalid image'});
  const png=body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg=body[0]===255&&body[1]===216&&body[2]===255;
  const webp=body.toString('ascii',0,4)==='RIFF'&&body.toString('ascii',8,12)==='WEBP';
  const ext=png?'png':jpg?'jpg':webp?'webp':'';
  if(!ext)return res.status(415).json({error:'Only PNG, JPEG, WebP supported'});
  const previous=imagePath(item),dir=item.folder==='completed'?COMPLETED_IMAGE_DIR:item.folder==='worded'?WORDED_IMAGE_DIR:item.folder==='original'?ORIGINAL_IMAGE_DIR:PENDING_IMAGE_DIR;
  fs.mkdirSync(dir,{recursive:true});
  const filename=`${item.id}.${ext}`,destination=path.join(dir,filename),temp=destination+'.upload';
  try{
    fs.writeFileSync(temp,body);fs.renameSync(temp,destination);
    if(previous&&previous!==destination)fs.rmSync(previous,{force:true});
    item.cacheFile=filename;item.cacheStatus='ready';item.cacheError='';
    item.image_width=Math.max(1,Math.min(20000,Number(req.query.width)||item.image_width));
    item.image_height=Math.max(1,Math.min(20000,Number(req.query.height)||item.image_height));
    writeSharedState();res.json({ok:true,favorite:item});
  }catch(error){fs.rmSync(temp,{force:true});res.status(500).json({error:error.message});}
});
app.get("/api/reverse/image/:id", (req, res) => {
  const item = favoriteById(req.params.id);
  const file = item && item.cacheStatus === "ready" ? imagePath(item) : null;
  if (!file || !fs.existsSync(file)) return res.status(404).send("Cached image not ready");
  res.set("Cache-Control", "private, no-store");
  res.sendFile(file);
});
// One-time migration from the old pending cache directory; preserve existing user images.
for(const item of sharedState.favorites.filter(x=>x.folder==='pending' && x.cacheFile)) {
  const old=path.join(REVERSE_DIR,'pending',item.cacheFile), dest=imagePath(item);
  if(fs.existsSync(old) && !fs.existsSync(dest)) { fs.mkdirSync(PENDING_IMAGE_DIR,{recursive:true}); fs.renameSync(old,dest); }
}
// Existing successful prompts leave the temporary AI queue. Keep a one-time state backup.
if (sharedState.favorites.some(item => item.folder === "pending" && item.prompt?.trim())) {
  fs.mkdirSync(DATA_DIR,{recursive:true});
  if (fs.existsSync(STATE_FILE) && !fs.existsSync(STATE_FILE + ".before-worded")) fs.copyFileSync(STATE_FILE, STATE_FILE + ".before-worded");
  fs.mkdirSync(WORDED_IMAGE_DIR,{recursive:true});
  for (const item of sharedState.favorites.filter(x => x.folder === "pending" && x.prompt?.trim())) {
    moveCache(item, "worded"); item.folder = "worded"; item.autoEnabled = false; item.queueOrder = 0;
    if (item.reverseStatus === "processing") item.reverseStatus = "idle";
  }
  renumberReverseQueue(); writeSharedState();
}
for (const item of sharedState.favorites) {
  if (!["pending","worded","completed"].includes(item.folder)) continue;
  if (item.folder === "pending" && item.autoEnabled && item.prompt && item.reverseStatus === "success") item.reverseStatus = "idle";
  if (item.reverseStatus === "processing") { item.reverseStatus = "idle"; item.reverseStartedAt = ""; }
  if (item.cacheStatus === "ready" && !fs.existsSync(imagePath(item) || "")) { item.cacheStatus = "error"; item.cacheError = "Cached file missing"; }
  if (item.cacheStatus !== "ready" && item.cacheStatus !== "error") scheduleCache(item.id);
}
function danbooruHeaders() { return {"User-Agent":"Aaalice-Nodes/1.0", "Accept":"application/json"}; }
// Serialize all metadata requests from every tab/device. Honor upstream cooldowns.
let upstreamTail = Promise.resolve();
let upstreamNextAt = 0;
let rateLimitStrikes = 0;
const UPSTREAM_GAP_MS = 1800;
function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - Date.now() || 0);
}
function pacedFetch(url, options, res) {
  const task = upstreamTail.then(async () => {
    const wait = upstreamNextAt - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    if (res.destroyed) throw new Error("Client disconnected");
    upstreamNextAt = Date.now() + UPSTREAM_GAP_MS;
    const response = await fetch(url, options);
    if (response.status === 420 || response.status === 429) {
      rateLimitStrikes = Math.min(rateLimitStrikes + 1, 4);
      const pause = Math.max(retryAfterMs(response.headers.get("retry-after")), 10000 * 2 ** (rateLimitStrikes - 1));
      upstreamNextAt = Math.max(upstreamNextAt, Date.now() + Math.min(pause, 120000));
      response.dflowRetryAfter = Math.ceil((upstreamNextAt - Date.now()) / 1000);
    } else if (response.ok) {
      rateLimitStrikes = 0;
    }
    return response;
  });
  upstreamTail = task.then(() => {}, () => {});
  return task;
}
function sendUpstream(res, response, text) {
  if (response.dflowRetryAfter) res.set("Retry-After", String(response.dflowRetryAfter));
  res.status(response.status).type(response.headers.get("content-type") || "application/json").send(text);
}

 function addDanbooruAuth(url, req) {
  const username = String(req.get("X-Danbooru-Username") || sharedState.account.loginName || "").trim();
  const apiKey = String(req.get("X-Danbooru-Key") || sharedState.account.loginKey || "").trim();
  if (username && apiKey) {
    // Same format as Aaalice-Nodes: Danbooru account name + Personal API Key.
    url.searchParams.set("login", username);
    url.searchParams.set("api_key", apiKey);
  }
  return { username, apiKey };
}
app.get("/api/auth-test", async (req, res) => {
  const upstream = new URL("/posts.json", DANBOORU);
  upstream.searchParams.set("limit", "1");
  upstream.searchParams.set("tags", "id:>0");
  const { username, apiKey } = addDanbooruAuth(upstream, req);
  if (!username || !apiKey) return res.status(400).json({ ok:false, message:"请同时填写 Danbooru 账户名称和 Personal API Key" });
  try {
    const response = await pacedFetch(upstream, { headers: danbooruHeaders(), signal: AbortSignal.timeout(15000) }, res);
    const text = await response.text();
    let detail = {};
    try { detail = JSON.parse(text); } catch {}
    if (!response.ok) {
      if (response.dflowRetryAfter) res.set("Retry-After", String(response.dflowRetryAfter));
      return res.status(response.status).json({ ok:false, status:response.status, error:detail.error || "authentication_failed", message:detail.message || `Danbooru 返回 HTTP ${response.status}` });
    }
    return res.json({ ok:true, message:"登录参数有效，Danbooru 已接受这组凭据" });
  } catch (error) { return res.status(502).json({ ok:false, message:"无法连接 Danbooru", detail:error.message }); }
});
app.get("/api/posts", async (req, res) => {
  const upstream = new URL("/posts.json", DANBOORU);
  for (const key of ["tags", "limit", "page"]) if (typeof req.query[key] === "string") upstream.searchParams.set(key, req.query[key]);
  if (typeof req.query.taxonomy === "string") upstream.searchParams.set("tags", `${req.query.taxonomy}:*`);
  upstream.searchParams.set("limit", String(Math.min(Number(req.query.limit) || 30, 60)));
  try {
    const headers=danbooruHeaders();
    // Danbooru API 认证使用查询参数 login + api_key；不要改成 Basic Auth。
    // Basic Auth 会导致 Danbooru 返回 401，即使用户名和 Key 都正确。
    addDanbooruAuth(upstream, req);
    const candidates = [upstream];
    // Danbooru 偶尔会让宽泛的 order:score 查询超时；保留排序语义，
    // 用 active 过滤作为服务端兜底，避免热门页整页空白。
    if (upstream.searchParams.get("tags")?.includes("order:score")) {
      const fallback = new URL(upstream);
      fallback.searchParams.set("tags", `${fallback.searchParams.get("tags")} status:active`);
      candidates.push(fallback);
    }
    let response;
    for (const candidate of candidates) {
      response = await pacedFetch(candidate, {headers, signal:AbortSignal.timeout(15000)}, res);
      if (response.ok || response.status < 500 || candidate === candidates.at(-1)) break;
    }
    sendUpstream(res, response, await response.text());
  } catch (error) { res.status(502).json({error:"无法连接到图片站点", detail:error.message}); }
});
app.get("/api/explore/popular", async (req, res) => {
  const scale = ["day", "week", "month"].includes(String(req.query.scale)) ? String(req.query.scale) : "day";
  const upstream = new URL("/explore/posts/popular.json", DANBOORU);
  upstream.searchParams.set("scale", scale);
  upstream.searchParams.set("limit", String(Math.min(Number(req.query.limit) || 30, 60)));
  if (typeof req.query.page === "string") upstream.searchParams.set("page", req.query.page);
  if (typeof req.query.tags === "string" && req.query.tags.trim()) upstream.searchParams.set("tags", req.query.tags.trim());
  addDanbooruAuth(upstream, req);
  try {
    const response = await pacedFetch(upstream, { headers: danbooruHeaders(), signal: AbortSignal.timeout(20000) }, res);
    sendUpstream(res, response, await response.text());
  } catch (error) {
    res.status(502).json({ error:"无法连接 Danbooru 热门榜", detail:error.message });
  }
});
app.get("/api/explore/viewed", async (req, res) => {
  const upstream = new URL("/explore/posts/viewed.json", DANBOORU);
  addDanbooruAuth(upstream, req);
  try {
    const response = await pacedFetch(upstream, { headers: danbooruHeaders(), signal: AbortSignal.timeout(20000) }, res);
    sendUpstream(res, response, await response.text());
  } catch (error) {
    res.status(502).json({ error:"无法连接 Danbooru 日浏览榜", detail:error.message });
  }
});
let popularTagsCache = { expires: 0, value: [] };
app.get("/api/tags", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 20), 200);
  if (popularTagsCache.expires > Date.now() && popularTagsCache.value.length >= limit) {
    return res.json(popularTagsCache.value.slice(0, limit));
  }
  const upstream = new URL("/tags.json", DANBOORU);
  upstream.searchParams.set("limit", String(limit));
  upstream.searchParams.set("search[order]", "count");
  upstream.searchParams.set("search[category]", "0");
  upstream.searchParams.set("search[hide_empty]", "yes");
  addDanbooruAuth(upstream, req);
  try {
    const response = await pacedFetch(upstream, { headers: danbooruHeaders(), signal: AbortSignal.timeout(15000) }, res);
    const text = await response.text();
    if (!response.ok) return sendUpstream(res, response, text);
    const values = JSON.parse(text);
    const tags = Array.isArray(values) ? values
      .filter(item => item && item.name && Number(item.post_count) > 0 && !item.is_deprecated)
      .map(item => ({ id:item.id, name:item.name, post_count:item.post_count, category:item.category, is_deprecated:false })) : [];
    popularTagsCache = { expires: Date.now() + 6 * 60 * 60 * 1000, value: tags };
    return res.json(tags.slice(0, limit));
  } catch (error) {
    return res.status(502).json({ error:"无法拉取热门标签", detail:error.message });
  }
});
// Images can arrive in large bursts when a masonry page enters the viewport.
// Keep a small separate CDN lane so thumbnails do not block metadata pages.
let imageActive = 0;
let imageNextAt = 0;
let imageCooldownAt = 0;
const imageWaiters = [];
async function withImageSlot(res, job) {
  if (imageActive >= 4) await new Promise(resolve => imageWaiters.push(resolve));
  imageActive++;
  try {
    const startAt = Math.max(Date.now(), imageNextAt, imageCooldownAt);
    imageNextAt = startAt + 350;
    const wait = startAt - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    const cooldown = imageCooldownAt - Date.now();
    if (cooldown > 0) await new Promise(resolve => setTimeout(resolve, cooldown));
    if (res.destroyed) return;
    return await job();
  } finally {
    imageActive--;
    imageWaiters.shift()?.();
  }
}
app.get("/api/image", async (req, res) => {
  try {
    const url = new URL(String(req.query.url || ""));
    if (url.protocol !== "https:" || (url.hostname !== "donmai.us" && !url.hostname.endsWith(".donmai.us"))) return res.status(400).json({error:"Invalid image URL"});
    await withImageSlot(res, async () => {
      const response = await fetch(url, {headers:{"User-Agent":"DFlow/0.1 (local image browser)"}, signal:AbortSignal.timeout(30000)});
      if (response.status === 420 || response.status === 429) {
        imageCooldownAt = Math.max(imageCooldownAt, Date.now() + Math.min(120000, Math.max(10000, retryAfterMs(response.headers.get("retry-after")))));
        res.set("Retry-After", String(Math.ceil((imageCooldownAt - Date.now()) / 1000)));
      }
      if (!response.ok) return res.status(response.status).send("Image unavailable");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (res.destroyed) return;
      res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(bytes);
    });
  } catch (error) {
    if (!res.headersSent && !res.destroyed) res.status(502).json({error:"Image proxy failed", detail:error.message});
  }
});
// Local imported PNGs and their parsed generation metadata are independent of favorites.
const META_DIR = path.join(DATA_DIR, "metadata");
for (const dir of [ORIGINAL_IMAGE_DIR,PENDING_IMAGE_DIR,WORDED_IMAGE_DIR,COMPLETED_IMAGE_DIR,META_DIR]) fs.mkdirSync(dir,{recursive:true});
const META_INDEX = path.join(META_DIR, "index.json");
function readMetaIndex() { try { const list=JSON.parse(fs.readFileSync(META_INDEX,'utf8'));return Array.isArray(list)?list:[]; } catch { return []; } }
function saveMetaIndex(list) { fs.mkdirSync(META_DIR,{recursive:true});fs.writeFileSync(META_INDEX,JSON.stringify(list,null,2)); }
const WORD_INDEX = path.join(WORDED_IMAGE_DIR, "index.json");
function readWordIndex() { try { const list=JSON.parse(fs.readFileSync(WORD_INDEX,'utf8'));return Array.isArray(list)?list:[]; } catch { return []; } }
function saveWordIndex(list) { fs.mkdirSync(WORDED_IMAGE_DIR,{recursive:true});fs.writeFileSync(WORD_INDEX,JSON.stringify(list,null,2)); }
// Migrate earlier hand-written cards, retaining an untouched copy of the old metadata index.
const oldManual = readMetaIndex().filter(item => item.source === '手写');
if (oldManual.length) {
  if (fs.existsSync(META_INDEX) && !fs.existsSync(META_INDEX + '.before-worded')) fs.copyFileSync(META_INDEX,META_INDEX + '.before-worded');
  const prior = readWordIndex(), existing = new Set(prior.map(item => item.id));
  for (const item of oldManual) {
    if (!existing.has(item.id)) prior.push(item);
    if (item.imageExt) {
      const src=path.join(META_DIR,item.id+'.'+item.imageExt), dst=path.join(WORDED_IMAGE_DIR,item.id+'.'+item.imageExt);
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src,dst);
    }
  }
  saveWordIndex(prior);
  saveMetaIndex(readMetaIndex().filter(item => item.source !== '手写'));
}
app.get('/api/metadata/images',(_req,res)=>res.json(readMetaIndex()));
app.get('/api/worded/entries',(_req,res)=>res.json(readWordIndex()));
app.patch('/api/worded/entries/:id',(req,res)=>{
  const list=readWordIndex(),item=list.find(x=>x.id===req.params.id);
  if(!item)return res.status(404).json({error:'有词卡片不存在'});
  const prompt=req.body?.prompt;
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>100000)return res.status(400).json({error:'提示词不能为空或超过 100000 字符'});
  item.positive=prompt.trim();if(item.folder==='pending')item.folder='worded';saveWordIndex(list);res.json(item);
});
app.patch('/api/worded/state/:id',(req,res)=>{
  const list=readWordIndex(), item=list.find(x=>x.id===req.params.id);
  if(!item)return res.status(404).json({error:'有词卡片不存在'});
  const folder=req.body?.folder;
  if(!['worded','pending','completed'].includes(folder))return res.status(400).json({error:'无效目录'});
  if(folder==='pending'&&!item.imageExt)return res.status(409).json({error:'请先在提示词窗口粘贴图片'});
  item.folder=folder;item.autoEnabled=folder==='pending';
  item.reverseStatus=folder==='pending'?'idle':'success';
  item.queueOrder=folder==='pending'?Date.now():0;
  saveWordIndex(list);res.json(item);
});
app.post('/api/worded/entries',(req,res)=>{
  const positive=String(req.body?.prompt||'').trim().slice(0,100000);
  if(!positive)return res.status(400).json({error:'提示词不能为空'});
  const summary=String(req.body?.summary||'').trim().slice(0,200);
  if(!summary && !req.body?.hasImage)return res.status(400).json({error:'请粘贴图片或填写概述'});
  const item={id:crypto.randomUUID(),name:'手写提示词',createdAt:new Date().toISOString(),source:'手写',positive,
    summary,model:'',negative:'',loras:[],cfg:null,steps:null,sampler:'',scheduler:'',seed:null,denoise:null,
    width:0,height:0,imageExt:'',folder:'worded',autoEnabled:false,queueOrder:0,preset:'动漫专用',reverseStatus:'success'};
  const list=readWordIndex();list.unshift(item);saveWordIndex(list);res.status(201).json(item);
});
app.put('/api/worded/images/:id',express.raw({type:['image/png','image/jpeg','image/webp'],limit:'60mb'}),(req,res)=>{
  const list=readWordIndex(),item=list.find(x=>x.id===req.params.id);
  if(!item)return res.sendStatus(404);
  const body=req.body;
  if(!Buffer.isBuffer(body)||body.length<24)return res.status(400).json({error:'图片无效'});
  const png=body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg=body[0]===255&&body[1]===216&&body[2]===255;
  const webp=body.toString('ascii',0,4)==='RIFF'&&body.toString('ascii',8,12)==='WEBP';
  const ext=png?'png':jpg?'jpg':webp?'webp':'';
  if(!ext)return res.status(415).json({error:'仅支持 PNG、JPEG、WebP'});
  if(item.imageExt)try{fs.rmSync(path.join(WORDED_IMAGE_DIR,item.id+'.'+item.imageExt),{force:true});}catch{}
  fs.writeFileSync(path.join(WORDED_IMAGE_DIR,item.id+'.'+ext),body);
  item.imageExt=ext;item.width=Math.max(0,Math.min(20000,Number(req.query.width)||0));
  item.height=Math.max(0,Math.min(20000,Number(req.query.height)||0));
  saveWordIndex(list);res.json(item);
});
app.get('/api/worded/images/:id',(req,res)=>{
  const item=readWordIndex().find(x=>x.id===req.params.id);
  if(!item?.imageExt)return res.sendStatus(404);
  res.set('Cache-Control','private, no-store');res.type(item.imageExt==='jpg'?'jpeg':item.imageExt).sendFile(path.join(WORDED_IMAGE_DIR,item.id+'.'+item.imageExt));
});
app.delete('/api/worded/entries/:id',(req,res)=>{
  const list=readWordIndex(),item=list.find(x=>x.id===req.params.id);
  if(!item)return res.sendStatus(404);
  saveWordIndex(list.filter(x=>x.id!==item.id));
  if(item.imageExt)try{fs.rmSync(path.join(WORDED_IMAGE_DIR,item.id+'.'+item.imageExt),{force:true});}catch{}
  res.json({ok:true});
});
app.patch('/api/metadata/entries/:id',(req,res)=>{
  const list=readMetaIndex(),item=list.find(x=>x.id===req.params.id);
  if(!item)return res.status(404).json({error:'元数据条目不存在'});
  const prompt=req.body?.prompt;
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>100000)return res.status(400).json({error:'提示词不能为空或超过 100000 字符'});
  item.positive=prompt.trim();saveMetaIndex(list);res.json(item);
});

app.post('/api/metadata/images', express.raw({type:'image/png',limit:'80mb'}),(req,res)=>{
  try {
    if(!Buffer.isBuffer(req.body)) return res.status(415).json({error:'请选择 PNG 图片'});
    const parsed=inspectPng(req.body);
    if(!parsed.hasMetadata) return res.status(422).json({error:'图片没有可识别的 ComfyUI / PNG 生成元数据，请导入原始 PNG'});
    const id=crypto.randomUUID();
    fs.mkdirSync(META_DIR,{recursive:true});
    fs.writeFileSync(path.join(META_DIR,id+'.png'),req.body);
    const name=String(req.query.name||'image.png').slice(0,160);
    const item={id,name,createdAt:new Date().toISOString(),imageExt:"png",...parsed};
    const list=readMetaIndex();list.unshift(item);saveMetaIndex(list);
    res.status(201).json(item);
  } catch(error) { res.status(400).json({error:error.message}); }
});
app.get('/api/metadata/images/:id',(req,res)=>{
  if(!/^[0-9a-f-]{36}$/.test(req.params.id) || !readMetaIndex().some(x=>x.id===req.params.id))return res.sendStatus(404);
  const item=readMetaIndex().find(x=>x.id===req.params.id);
   if(!item?.imageExt && item?.source==='手写')return res.sendStatus(404);
   const ext=item.imageExt||'png';res.type(ext==='jpg'?'jpeg':ext).sendFile(path.join(META_DIR,req.params.id+'.'+ext));
});
app.delete('/api/metadata/images/:id',(req,res)=>{
  const list=readMetaIndex(),next=list.filter(x=>x.id!==req.params.id);
  if(next.length===list.length)return res.sendStatus(404);
  saveMetaIndex(next);
  const old=list.find(x=>x.id===req.params.id);try { fs.unlinkSync(path.join(META_DIR,req.params.id+'.'+(old.imageExt||'png'))); } catch {}
  res.json({ok:true});
});
app.use((_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, HOST, () => console.log(`DFlow 已启动：http://${HOST}:${PORT}`));






