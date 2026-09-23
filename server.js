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
const COMPLETED_IMAGE_DIR = path.join(DATA_DIR, "favorites", "completed");
const PRESET_NAMES = ["动作扩写", "艺术导演扩写", "巨构提示词", "动漫专用", "瑶光真人", "通用扩写"];
const VALID_PRESETS = new Set([...PRESET_NAMES, "随机"]);
const favoriteFolderOf = post => ["original", "pending", "completed"].includes(post.folder) ? post.folder : (post.completed ? "completed" : "original");
const defaultSharedState = () => ({
  account: { loginName: "", loginKey: "" },
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
    autoEnabled: post.autoEnabled !== false, queueOrder: Math.max(0, Number(post.queueOrder) || 0), prompt: String(post.prompt || "").slice(0, 100000),
    resolvedPreset: String(post.resolvedPreset || ""), reverseStatus: String(post.reverseStatus || "idle"),
    reverseError: String(post.reverseError || "").slice(0, 1000),
    cacheStatus: String(post.cacheStatus || "idle"), cacheFile: String(post.cacheFile || ""),
    cacheError: String(post.cacheError || "").slice(0, 1000), reverseStartedAt: String(post.reverseStartedAt || "")
  };
}
app.get("/api/state", (_req, res) => res.json(sharedState));
app.put("/api/account", (req, res) => {
  sharedState.account = {
    loginName: String(req.body?.loginName || "").trim(),
    loginKey: String(req.body?.loginKey || "").trim()
  };
  writeSharedState();
  res.json({ ok: true, account: sharedState.account, updatedAt: sharedState.updatedAt });
});
app.put("/api/preferences", (req, res) => {
  const allowedModes = new Set(["latest", "popular-day", "popular-week", "popular-month", "viewed", "favcount", "comment", "upvotes", "score", "rank", "mpixels", "favorites"]);
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
      resolvedPreset: prior.resolvedPreset, reverseStatus: prior.reverseStatus,
      reverseError: prior.reverseError, cacheStatus: prior.cacheStatus,
      cacheFile: prior.cacheFile, cacheError: prior.cacheError, reverseStartedAt: prior.reverseStartedAt } : item);
  }).filter(Boolean).slice(0, 5000);
  const kept = new Set(sharedState.favorites.map(item => item.id));
  for (const prior of oldById.values()) {
    if (kept.has(prior.id)) continue;
    const file = imagePath(prior);
    if (file) fs.rmSync(file, {force:true});
  }
  for (const item of sharedState.favorites) {
    if (item.folder === "pending" && item.cacheStatus === "ready" && !fs.existsSync(imagePath(item) || "")) {
      item.cacheFile = ""; item.cacheStatus = "idle"; item.cacheError = "";
    }
  }
  renumberReverseQueue();
  writeSharedState();
  for (const item of sharedState.favorites) if (item.folder === "pending" && item.cacheStatus === "idle") scheduleCache(item.id);
  res.json({ ok: true, favorites: sharedState.favorites, updatedAt: sharedState.updatedAt });
});
// The reverse queue is local to this server. Never fetch originals for it.
const cacheJobs = new Set();
let cacheTail = Promise.resolve();
function favoriteById(id) { return sharedState.favorites.find(item => item.id === Number(id)); }
function imagePath(item) {
  if (!item.cacheFile || !/^[0-9]+\.(jpg|jpeg|png|webp|gif)$/i.test(item.cacheFile)) return null;
  return path.join(item.folder === "completed" ? COMPLETED_IMAGE_DIR : path.join(REVERSE_DIR, "pending"), item.cacheFile);
}
function scheduleCache(id) {
  const item = favoriteById(id);
  if (!item || item.folder !== "pending" || item.cacheStatus === "ready" || cacheJobs.has(id)) return;
  cacheJobs.add(id);
  cacheTail = cacheTail.catch(() => {}).then(async () => {
    const current = favoriteById(id);
    if (!current || current.folder !== "pending") { cacheJobs.delete(id); return; }
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
      if (!latest || latest.folder !== "pending") return;
      const dir = path.join(REVERSE_DIR, "pending");
      fs.mkdirSync(dir, {recursive:true});
      tmp = path.join(dir, `${id}.${ext}.part`);
      fs.writeFileSync(tmp, body);
      const filename = `${id}.${ext}`;
      fs.renameSync(tmp, path.join(dir, filename)); tmp = null;
      latest.cacheFile = filename; latest.cacheStatus = "ready"; latest.cacheError = "";
    } catch (error) {
      const latest = favoriteById(id);
      if (latest && latest.folder === "pending") {
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
    const destDir = target === "completed" ? COMPLETED_IMAGE_DIR : path.join(REVERSE_DIR, "pending");
    fs.mkdirSync(destDir, {recursive:true});
    fs.renameSync(source, path.join(destDir, item.cacheFile));
  }
}
app.patch("/api/favorites/:id", (req, res) => {
  const item = favoriteById(req.params.id);
  if (!item) return res.status(404).json({error:"Favorite not found"});
  const body = req.body || {};
  if (body.folder !== undefined) {
    if (!["original","pending","completed"].includes(body.folder)) return res.status(400).json({error:"Invalid folder"});
    if (item.folder === "pending" && body.folder === "completed" && (!item.prompt || item.cacheStatus !== "ready" || !fs.existsSync(imagePath(item) || ""))) return res.status(409).json({error:"Prompt and cached image required before release"});
    if (item.folder === "pending" && body.folder === "completed") moveCache(item, "completed");
    if (item.folder === "completed" && body.folder === "pending") moveCache(item, "pending");
    if (body.folder === "original" && item.folder !== "original") {
      const oldFile = imagePath(item);
      if (oldFile) fs.rmSync(oldFile, {force:true});
      item.cacheFile = ""; item.cacheStatus = "idle"; item.cacheError = "";
    }
    item.folder = body.folder; item.completed = body.folder === "completed";
    if (body.folder === "pending" && item.autoEnabled) item.queueOrder = nextReverseOrder();
  }
  if (body.preset !== undefined) {
    if (!VALID_PRESETS.has(body.preset)) return res.status(400).json({error:"Invalid preset"});
    item.preset = body.preset;
  }
  if (typeof body.autoEnabled === "boolean") {
    if (body.autoEnabled && !item.autoEnabled && item.folder === "pending") item.queueOrder = nextReverseOrder();
    item.autoEnabled = body.autoEnabled;
  }
  if (body.retryCache && item.folder === "pending") { item.cacheStatus = "idle"; item.cacheError = ""; }
  if (body.retryReverse && item.folder === "pending") { item.reverseStatus = "idle"; item.reverseError = ""; item.autoEnabled = true; item.queueOrder = nextReverseOrder(); }
  renumberReverseQueue();
  writeSharedState();
  if (item.folder === "pending" && item.cacheStatus === "idle") scheduleCache(item.id);
  res.json({ok:true, favorite:item, queue:reverseQueueSnapshot(), updatedAt:sharedState.updatedAt});
});
app.get("/api/reverse/queue", (_req, res) => {
  const pending = sharedState.favorites.filter(item => item.folder === "pending").sort((a,b) => (a.queueOrder || Infinity) - (b.queueOrder || Infinity));
  res.json({total:pending.length, withoutPrompt:pending.filter(item => !item.prompt).length,
    eligible:pending.filter(item => item.autoEnabled && !item.prompt && item.cacheStatus === "ready" && item.reverseStatus !== "failed" && item.reverseStatus !== "processing").length,
    items:pending.map(item => ({id:item.id, preset:item.preset, autoEnabled:item.autoEnabled, queueOrder:item.queueOrder, reverseStatus:item.reverseStatus,
      cacheStatus:item.cacheStatus, cacheError:item.cacheError, reverseError:item.reverseError, hasPrompt:Boolean(item.prompt),
      imagePath:item.cacheStatus === "ready" ? imagePath(item) : null}))});
});
app.post("/api/reverse/next", (_req, res) => {
  const item = sharedState.favorites.filter(x => x.folder === "pending" && x.autoEnabled && !x.prompt && x.cacheStatus === "ready" && x.reverseStatus === "idle")
    .sort((a,b) => a.queueOrder - b.queueOrder)[0];
  if (!item) return res.json({item:null});
  item.reverseStatus = "processing"; item.reverseError = ""; item.reverseStartedAt = new Date().toISOString();
  writeSharedState();
  res.json({item:{id:item.id, preset:item.preset, imagePath:imagePath(item)}});
});
app.post("/api/reverse/:id/result", (req, res) => {
  const item = favoriteById(req.params.id);
  if (!item || item.folder !== "pending" || item.reverseStatus !== "processing") return res.status(409).json({error:"Item is not processing"});
  const prompt = String(req.body?.prompt || "").trim();
  const preset = String(req.body?.resolvedPreset || item.preset);
  if (!PRESET_NAMES.includes(preset) || (item.preset !== "随机" && preset !== item.preset)) return res.status(400).json({error:"Preset mismatch"});
  const minimum = preset === "瑶光真人" ? 45 : 250;
  if (prompt.length < minimum) return res.status(422).json({error:`Prompt too short (minimum ${minimum} characters)`});
  item.prompt = prompt.slice(0, 100000); item.resolvedPreset = preset;
  item.reverseStatus = "success"; item.reverseError = ""; item.reverseStartedAt = ""; item.autoEnabled = false;
  renumberReverseQueue();
  writeSharedState();
  res.json({ok:true, favorite:item});
});
app.post("/api/reverse/:id/fail", (req, res) => {
  const item = favoriteById(req.params.id);
  if (!item || item.folder !== "pending") return res.status(404).json({error:"Item not pending"});
  item.reverseStatus = "failed"; item.reverseError = String(req.body?.reason || "Unknown error").slice(0,1000); item.reverseStartedAt = "";
  writeSharedState();
  res.json({ok:true, favorite:item});
});
app.get("/api/reverse/image/:id", (req, res) => {
  const item = favoriteById(req.params.id);
  const file = item && item.cacheStatus === "ready" ? imagePath(item) : null;
  if (!file || !fs.existsSync(file)) return res.status(404).send("Cached image not ready");
  res.set("Cache-Control", "private, max-age=3600");
  res.sendFile(file);
});
for (const item of sharedState.favorites) {
  if (item.folder !== "pending") continue;
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
const META_INDEX = path.join(META_DIR, "index.json");
function readMetaIndex() { try { const list=JSON.parse(fs.readFileSync(META_INDEX,'utf8'));return Array.isArray(list)?list:[]; } catch { return []; } }
function saveMetaIndex(list) { fs.mkdirSync(META_DIR,{recursive:true});fs.writeFileSync(META_INDEX,JSON.stringify(list,null,2)); }
app.get('/api/metadata/images',(_req,res)=>res.json(readMetaIndex()));
app.post('/api/metadata/images', express.raw({type:'image/png',limit:'80mb'}),(req,res)=>{
  try {
    if(!Buffer.isBuffer(req.body)) return res.status(415).json({error:'请选择 PNG 图片'});
    const parsed=inspectPng(req.body);
    if(!parsed.hasMetadata) return res.status(422).json({error:'图片没有可识别的 ComfyUI / PNG 生成元数据，请导入原始 PNG'});
    const id=crypto.randomUUID();
    fs.mkdirSync(META_DIR,{recursive:true});
    fs.writeFileSync(path.join(META_DIR,id+'.png'),req.body);
    const name=String(req.query.name||'image.png').slice(0,160);
    const item={id,name,createdAt:new Date().toISOString(),...parsed};
    const list=readMetaIndex();list.unshift(item);saveMetaIndex(list);
    res.status(201).json(item);
  } catch(error) { res.status(400).json({error:error.message}); }
});
app.get('/api/metadata/images/:id',(req,res)=>{
  if(!/^[0-9a-f-]{36}$/.test(req.params.id) || !readMetaIndex().some(x=>x.id===req.params.id))return res.sendStatus(404);
  res.type('png').sendFile(path.join(META_DIR,req.params.id+'.png'));
});
app.delete('/api/metadata/images/:id',(req,res)=>{
  const list=readMetaIndex(),next=list.filter(x=>x.id!==req.params.id);
  if(next.length===list.length)return res.sendStatus(404);
  saveMetaIndex(next);
  try { fs.unlinkSync(path.join(META_DIR,req.params.id+'.png')); } catch {}
  res.json({ok:true});
});
app.use((_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, HOST, () => console.log(`DFlow 已启动：http://${HOST}:${PORT}`));






