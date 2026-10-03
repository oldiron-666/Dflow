import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { inspectPng } from "./metadata.js";
import { presetDefaults, validatePresets, PRESET_STORE, readPresetLibrary, savePresetLibrary } from "./presets.js";
import { DshBridgeClient, DshBridgeError, publicBridgeError } from "./dsh-bridge.js";
import { fileURLToPath } from "node:url";
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const DANBOORU = "https://danbooru.donmai.us";
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));
const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version || "0.1.0"; } catch { return "0.1.0"; } })();
const LOCAL_COMMIT = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8", windowsHide: true }).trim(); } catch { return ""; } })();
const GITHUB_REPO = "oldiron-666/Dflow";
const GITHUB_BRANCH = "main";
const VERSION_HEADERS = { "Accept": "application/vnd.github+json", "User-Agent": "DFlow-Version-Checker/1.0" };
let versionCheckCache = { at: 0, latest: null };
app.get("/api/version", async (_req, res) => {
  const now = Date.now();
  if (!versionCheckCache.latest || now - versionCheckCache.at > 300000) {
    try {
      const [commitResponse, packageResponse] = await Promise.all([
        fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`, { headers: VERSION_HEADERS, signal: AbortSignal.timeout(8000) }),
        fetch(`https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/package.json`, { headers: VERSION_HEADERS, signal: AbortSignal.timeout(8000) })
      ]);
      const latest = {};
      if (commitResponse.ok) {
        const commit = await commitResponse.json();
        latest.commit = String(commit.sha || "");
        latest.message = String(commit.commit?.message || "").split("\n")[0];
        latest.date = commit.commit?.committer?.date || "";
      }
      if (packageResponse.ok) {
        const packageInfo = await packageResponse.json();
        latest.version = String(packageInfo.version || "");
      }
      if (!latest.commit && !latest.version) throw Error(`GitHub HTTP ${commitResponse.status}/${packageResponse.status}`);
      versionCheckCache = { at: now, latest };
    } catch (error) {
      if (!versionCheckCache.latest) return res.json({ ok: false, error: `\u65e0\u6cd5\u8bfb\u53d6 GitHub \u7248\u672c\uff1a${error.message}`, current: { version: APP_VERSION, commit: LOCAL_COMMIT } });
    }
  }
  const latest = versionCheckCache.latest;
  const commitChanged = Boolean(latest?.commit && (!LOCAL_COMMIT || latest.commit !== LOCAL_COMMIT));
  const versionChanged = Boolean(latest?.version && latest.version !== APP_VERSION);
  res.json({ ok: true, current: { version: APP_VERSION, commit: LOCAL_COMMIT }, latest, updateAvailable: commitChanged || versionChanged });
});

const DATA_DIR = process.env.DFLOW_DATA_DIR ? path.resolve(process.env.DFLOW_DATA_DIR) : path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "dflow-state.json");
const REVERSE_DIR = path.join(DATA_DIR, "reverse");
const ORIGINAL_IMAGE_DIR = path.join(DATA_DIR, "favorites", "original");
const PENDING_IMAGE_DIR = path.join(DATA_DIR, "favorites", "pending");
const COMPLETED_IMAGE_DIR = path.join(DATA_DIR, "favorites", "completed");
const WORDED_IMAGE_DIR = path.join(DATA_DIR, "favorites", "worded");
const PRESET_FILE = path.join(DATA_DIR, PRESET_STORE);
function readPresets() {
  try { return readPresetLibrary(DATA_DIR); }
  catch (error) {
    // Migrate the old combined JSON once. Never delete it: it is a safety backup.
    if (fs.existsSync(path.join(DATA_DIR, 'mcp-presets', 'config.json'))) {
      console.error('读取预设文件夹失败，未覆盖文件：', error.message);
      return presetDefaults();
    }
    try {
      const legacy = validatePresets(JSON.parse(fs.readFileSync(PRESET_FILE, 'utf8')));
      return savePresetLibrary(DATA_DIR, legacy);
    } catch { return presetDefaults(); }
  }
}
let presets = readPresets();
const expansionNames = () => presets.expansion.map(x => x.name);
const validExpansion = name => name === '随机' || expansionNames().includes(name);
const validReverse = name => presets.reverse.some(x => x.name === name);
const chosenExpansion = name => validExpansion(name) ? name : presets.defaultExpansion;
const chosenReverse = name => validReverse(name) ? name : presets.defaultReverse;
const mcpSessions = new Map();
let directTargetSessionId = '';
const dshBridge = new DshBridgeClient();
const DSH_TARGET_FILE = path.join(DATA_DIR, 'dsh-target.json');
function readDshTarget() {
  try {
    const value = JSON.parse(fs.readFileSync(DSH_TARGET_FILE, 'utf8'));
    return { sessionId: String(value?.sessionId || ''), title: String(value?.title || ''), updatedAt: String(value?.updatedAt || '') };
  } catch { return { sessionId: '', title: '', updatedAt: '' }; }
}
function writeDshTarget(session) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!session?.sessionId) {
    try { fs.unlinkSync(DSH_TARGET_FILE); } catch { /* already cleared */ }
    return readDshTarget();
  }
  const next = { sessionId: String(session.sessionId), title: String(session.title || ''), updatedAt: new Date().toISOString() };
  fs.writeFileSync(DSH_TARGET_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
function dshSessionLive(session) {
  return Boolean(session?.metadata?.live) && session?.metadata?.readOnly !== true;
}
function dshSessionPayload(session, selectedId = '') {
  return {
    sessionId: String(session?.sessionId || ''),
    externalSessionId: String(session?.externalSessionId || ''),
    title: String(session?.title || '未命名 DSH 窗口'),
    cwd: String(session?.cwd || ''),
    orderingTime: String(session?.orderingTime || ''),
    live: dshSessionLive(session),
    persisted: Boolean(session?.metadata?.persisted),
    readOnly: session?.metadata?.readOnly === true,
    selected: String(session?.sessionId || '') === String(selectedId || '')
  };
}
async function readDshStatus() {
  const configured = readDshTarget();
  const envTarget = String(process.env.DFLOW_DSH_SESSION_ID || '').trim();
  try {
    const sessions = await dshBridge.listSessions();
    const selectedId = configured.sessionId || envTarget;
    return { ok: true, available: true, configuredSessionId: selectedId, configuredTitle: configured.title, sessions: sessions.map(session => dshSessionPayload(session, selectedId)) };
  } catch (error) {
    return { ok: false, available: false, configuredSessionId: configured.sessionId || envTarget, configuredTitle: configured.title, sessions: [], error: publicBridgeError(error) };
  }
}
const localRequest = req => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.ip);
function activeMcpSessions() {
  const now = Date.now();
  return [...mcpSessions.values()].filter(session => !session.revoked && now - session.seenAt < 60000);
}
// The browser needs to be able to see connected agents over the LAN so a tablet
// can choose a direct-reverse target.  Creating, heartbeating and revoking a
// session remain local-only: a LAN browser must never be able to impersonate an
// MCP client or disconnect one.
app.get('/api/mcp/sessions', (_req, res) => {
  res.json(activeMcpSessions().map(({id,name,version,since,seenAt}) => ({id,name,version,since,seenAt})));
});
app.get('/api/mcp/direct-target', (_req, res) => {
  const target = directTargetSessionId ? directSessionById(directTargetSessionId) : null;
  if (directTargetSessionId && !target) directTargetSessionId = '';
  res.json({ sessionId: directTargetSessionId, online: Boolean(target) });
});
app.put('/api/mcp/direct-target', (req, res) => {
  const id = String(req.body?.sessionId || '').trim();
  if (id && !directSessionById(id)) return res.status(409).json({ error: '指定的 MCP Agent 当前不在线' });
  directTargetSessionId = id;
  res.json({ sessionId: directTargetSessionId, online: Boolean(id) });
});
app.post('/api/mcp/sessions', (req,res) => {
  if (!localRequest(req)) return res.sendStatus(403);
  const id=crypto.randomUUID();
  mcpSessions.set(id,{id,name:String(req.body?.name||'未知 Agent').slice(0,80),version:String(req.body?.version||'').slice(0,40),since:Date.now(),seenAt:Date.now(),revoked:false});
  res.json({id});
});
app.post('/api/mcp/sessions/:id/heartbeat', (req,res) => {
  if (!localRequest(req)) return res.sendStatus(403);
  const session=mcpSessions.get(req.params.id);
  if (!session || session.revoked) return res.sendStatus(410);
  session.seenAt=Date.now(); res.json({ok:true});
});
app.delete('/api/mcp/sessions/:id', (req,res) => {
  if (!localRequest(req)) return res.sendStatus(403);
  const session=mcpSessions.get(req.params.id);
  if (!session) return res.sendStatus(404);
  session.revoked=true;res.json({ok:true});
});
app.get('/api/mcp/setup', (req,res)=>{if(!localRequest(req))return res.sendStatus(403);res.json({command:process.execPath,args:[path.join(__dirname,'mcp-server.js')],port:PORT});});

// DSH Desktop's local bridge is optional. It is used only to send a short
// wake-up message to the selected DSH chat; the actual image workflow still
// runs through the normal stdio MCP tools and the persisted DFlow queue.
app.get('/api/dsh/status', async (_req, res) => res.json(await readDshStatus()));
app.get('/api/dsh/sessions', async (_req, res) => res.json(await readDshStatus()));
app.put('/api/dsh/target', async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  if (!sessionId) return res.json({ ok: true, target: writeDshTarget(null) });
  const status = await readDshStatus();
  if (!status.available) return res.status(503).json({ error: status.error || 'DSH Bridge 不可用' });
  const session = status.sessions.find(item => item.sessionId === sessionId && item.live && !item.readOnly);
  if (!session) return res.status(409).json({ error: '指定的 DSH 窗口当前不在线或不可写入' });
  const target = writeDshTarget({ sessionId: session.sessionId, title: session.title });
  res.json({ ok: true, target });
});

// A direct request is deliberately persisted in data/ so a tablet can enqueue
// one image while the connected MCP client claims it a moment later.  The data
// directory is ignored by git and may contain private favorites/cache files.
const DIRECT_REQUEST_FILE = path.join(REVERSE_DIR, 'direct-requests.json');
function readDirectRequests() {
  try {
    const list = JSON.parse(fs.readFileSync(DIRECT_REQUEST_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function writeDirectRequests(list) {
  fs.mkdirSync(REVERSE_DIR, { recursive: true });
  const serialized = JSON.stringify(list.slice(-1000), null, 2);
  // Keep the queue readable even if the process is interrupted while writing.
  // On Windows rename can reject an existing destination, so remove it only
  // after the complete temporary file has been flushed.
  const temporary = `${DIRECT_REQUEST_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, serialized, 'utf8');
  try {
    fs.renameSync(temporary, DIRECT_REQUEST_FILE);
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
    fs.rmSync(DIRECT_REQUEST_FILE, { force: true });
    fs.renameSync(temporary, DIRECT_REQUEST_FILE);
  }
}
function activeDirectRequestIn(list, itemId) {
  return list.filter(request => String(request.itemId) === String(itemId) && ['queued', 'processing'].includes(request.status))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0] || null;
}
function activeDirectRequest(itemId) {
  return activeDirectRequestIn(readDirectRequests(), itemId);
}
// Every direct-request read/modify/write operation goes through this queue.
// The browser, DSH bridge dispatch, and MCP claim can all arrive at the same
// time; without serialization, a stale snapshot could overwrite a newer
// request and make the DSH Agent receive an ID that no longer exists.
let directRequestMutationTail = Promise.resolve();
function mutateDirectRequests(mutator) {
  const operation = directRequestMutationTail.then(() => {
    const list = readDirectRequests();
    const result = mutator(list);
    writeDirectRequests(list);
    return result;
  });
  directRequestMutationTail = operation.catch(() => undefined);
  return operation;
}
function findReverseTarget(id, pendingOnly = true) {
  const favorite = favoriteById(id);
  if (favorite && (!pendingOnly || favorite.folder === 'pending')) return { kind: 'favorite', item: favorite };
  const manual = readWordIndex().find(item => String(item.id) === String(id) && (!pendingOnly || item.folder === 'pending'));
  return manual ? { kind: 'worded', item: manual } : null;
}
function directTargetPayload(target) {
  if (!target) return null;
  const item = target.item;
  const payload = target.kind === 'favorite'
    ? cleanFavorite(item)
    : { ...item, id: String(item.id), imagePath: item.imageExt ? path.join(WORDED_IMAGE_DIR, `${item.id}.${item.imageExt}`) : '' };
  const request = activeDirectRequest(item.id);
  if (request?.dshDispatch) payload.dshDispatch = request.dshDispatch;
  return payload;
}
function directSessionById(id) {
  return activeMcpSessions().find(session => String(session.id) === String(id)) || null;
}
function latestDirectSession() {
  return activeMcpSessions().sort((a, b) => b.seenAt - a.seenAt)[0] || null;
}
function isDshMcpSession(session) {
  const label = `${session?.name || ''} ${session?.version || ''}`.toLowerCase();
  return label.includes('dsh') || label.includes('deepseek desktop') || label.includes('deepseek-harness');
}
function latestDshMcpSession() {
  return activeMcpSessions().filter(isDshMcpSession).sort((a, b) => b.seenAt - a.seenAt)[0] || null;
}
function chooseDirectMcpSession(requestedSessionId = '') {
  if (requestedSessionId) return directSessionById(requestedSessionId);
  // AI直推 is awakened through the DSH Bridge. Prefer the MCP process owned by
  // DSH when several local Agent clients are connected; otherwise the request
  // can be delivered to DSH while remaining locked to a different client.
  return latestDshMcpSession() || latestDirectSession();
}
function chooseDshSession(sessions) {
  const configured = readDshTarget();
  const requestedId = configured.sessionId || String(process.env.DFLOW_DSH_SESSION_ID || '').trim();
  const live = sessions.filter(dshSessionLive);
  if (requestedId) {
    const selected = live.find(session => String(session.sessionId) === requestedId);
    if (!selected) throw new DshBridgeError(configured.title ? `固定 DSH 窗口“${configured.title}”当前不在线` : '固定 DSH 窗口当前不在线，请在 MCP 设置中重新选择', 'DSH_TARGET_OFFLINE');
    return selected;
  }
  if (live.length === 1) return live[0];
  if (!live.length) throw new DshBridgeError('没有在线且可写入的 DSH 窗口，请先打开 DSH Desktop', 'DSH_TARGET_UNAVAILABLE');
  throw new DshBridgeError('检测到多个在线 DSH 窗口，请在 MCP 设置中选择 AI直推窗口', 'DSH_TARGET_REQUIRED');
}
function directDispatchPrompt(request) {
  return [
    '请立即处理 DFlow 网页发起的 AI直推任务。',
    `DFlow 直推请求 ID：${request.id}`,
    `不要只回复说明，也不要等待用户确认。现在立即调用 dflow-local MCP 的 claim_direct_reverse 工具，requestId 参数先填写：${request.id}。如果工具返回 request 为 null，说明 DSH 保留了旧消息或服务刚重启；请立即再次调用不带 requestId 的 claim_direct_reverse，领取当前最早的直推任务。不要只把任务编号发回聊天，也不要在这两次都没有任务时自行编造结果。`,
    '领取后严格执行工具返回的完整流程：读取本地缓存高清图，先按反推流程完成忠实观察与反推，再按扩写预设完整扩写；成功调用 complete_pending 写回，失败调用 fail_pending。',
    '聊天窗口只报告“开始第几张、成功或失败及失败原因”，不要输出完整提示词正文。'
  ].join('\n');
}
async function dispatchDirectRequest(requestId) {
  // Claim the dispatch slot atomically. A browser click, the automatic
  // dispatch started by POST /direct, and the retry button may all call this
  // endpoint at once; only the caller that changes pending -> dispatching may
  // send a DSH message.
  const started = await mutateDirectRequests(list => {
    const request = list.find(entry => String(entry.id) === String(requestId));
    if (!request) return { ok: false, error: '直推请求不存在', request: null, shouldDispatch: false };
    if (request.status !== 'queued') return { ok: true, request, shouldDispatch: false };
    if (request.dshDispatch?.status === 'sent' || request.dshDispatch?.status === 'dispatching') {
      return { ok: true, request, shouldDispatch: false };
    }
    request.dshDispatch = { status: 'dispatching', sessionId: '', title: '', sentAt: '', error: '' };
    return { ok: true, request, shouldDispatch: true };
  });
  if (!started.request || !started.shouldDispatch) return started;

  try {
    const session = chooseDshSession(await dshBridge.listSessions());
    await dshBridge.startTurn(session.sessionId, directDispatchPrompt(started.request));
    const sent = await mutateDirectRequests(list => {
      const current = list.find(entry => String(entry.id) === String(requestId));
      if (!current) return { ok: false, error: '直推请求在唤起期间已不存在', request: null };
      // MCP may claim the task as soon as DSH receives the message. Do not
      // turn a processing/cancelled request back into queued here; only update
      // the dispatch metadata.
      if (current.status !== 'cancelled' && current.status !== 'completed' && current.status !== 'failed') {
        current.dshDispatch = { status: 'sent', sessionId: session.sessionId, title: session.title, sentAt: new Date().toISOString(), error: '' };
      }
      return { ok: true, request: current };
    });
    return sent;
  } catch (error) {
    const message = publicBridgeError(error);
    const failed = await mutateDirectRequests(list => {
      const current = list.find(entry => String(entry.id) === String(requestId));
      if (!current) return { ok: false, error: '直推请求在唤起期间已不存在', request: null };
      // If the Agent claimed the request while the bridge call was in flight,
      // preserve its processing state and let the UI continue polling.
      if (current.status === 'queued' && current.dshDispatch?.status === 'dispatching') {
        current.dshDispatch = { status: 'failed', sessionId: '', title: '', sentAt: '', error: message };
      }
      return { ok: false, request: current, error: message };
    });
    return { ok: false, request: failed.request || started.request, error: failed.error || message };
  }
}
app.get('/api/mcp/presets', (_req,res)=>res.json(presets));
app.put('/api/mcp/presets', (req,res)=>{
  try {
    const next=validatePresets(req.body);
    presets=savePresetLibrary(DATA_DIR,next);res.json(presets);
  } catch(error) {res.status(400).json({error:error.message});}
});
const favoriteFolderOf = post => ["original", "pending", "worded", "completed"].includes(post.folder) ? post.folder : (post.completed ? "completed" : "original");
const defaultSharedState = () => ({
  account: {
    loginName: "", loginKey: "", googleTranslateKey: "",
    pixivCookie: "", pixivRefreshToken: "",
    primaryTranslator: "deepl",
    translateFallback: true,
    deeplKey: "",
    tencentSecretId: "", tencentSecretKey: "",
    volcAccessKey: "", volcSecretKey: ""
  },
  favorites: [],
  preferences: { mode: "latest", columns: 5, ratings: ["g", "s", "q", "e"], pixivRating: "safe", pixivDates: {}, search: "", selectedTags: [] },
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
// Queue numbers are display/order metadata, not timestamps.  Older versions
// accidentally stored Date.now() here, which made the circular button show
// values such as "1790" after the long number overflowed its fixed width.
const MAX_QUEUE_ORDER = 1000000;
function safeQueueOrder(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_QUEUE_ORDER ? number : null;
}
function renumberReverseQueue() {
  const entries = sharedState.favorites.map((item, index) => ({item, index}))
    .filter(({item}) => item.folder === "pending" && item.autoEnabled !== false);
  entries.sort((a, b) =>
    (safeQueueOrder(a.item.queueOrder) ?? Infinity) - (safeQueueOrder(b.item.queueOrder) ?? Infinity) ||
    a.index - b.index
  );
  entries.forEach(({item}, index) => { item.queueOrder = index + 1; });
  sharedState.favorites.filter(item => item.folder !== "pending" || item.autoEnabled === false)
    .forEach(item => { item.queueOrder = 0; });
}
function nextReverseOrder() {
  let maximum = Math.max(0, ...sharedState.favorites.map(item =>
    item.folder === "pending" && item.autoEnabled !== false ? (safeQueueOrder(item.queueOrder) || 0) : 0
  ));
  // The worded index is initialized later in this file.  All callers run
  // after startup, so include its pending cards when assigning a new order.
  try {
    const manual = readWordIndex();
    maximum = Math.max(maximum, ...manual.map(item =>
      item.folder === "pending" && item.autoEnabled !== false ? (safeQueueOrder(item.queueOrder) || 0) : 0
    ));
  } catch { /* the index is not ready during module initialization */ }
  return maximum + 1;
}
function reverseQueueSnapshot() {
  const queue = renumberAllPendingQueue();
  return queue.items.map(({item}) => ({id:item.id, autoEnabled:item.autoEnabled, queueOrder:item.queueOrder}));
}
renumberReverseQueue();
function writeSharedState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  sharedState.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(sharedState, null, 2), "utf8");
}
function cleanFavorite(post) {
  if (!post) return null;
  const isPixiv = (typeof post.id === "string" && post.id.startsWith("px_")) || post.source === "pixiv";
  const id = isPixiv ? String(post.id) : Number(post.id);
  if (!id) return null;
  return {
    id,
    source: isPixiv ? "pixiv" : "danbooru",
    pixiv_id: post.pixiv_id || (isPixiv ? String(post.id).replace(/^px_/, "").split("_")[0] : null),
    page_count: Number(post.page_count) || 1,
    title: String(post.title || "").slice(0, 300),
    author: String(post.author || post.user_name || "").slice(0, 100),
    rating: String(post.rating || "g"),
    preview_file_url: String(post.preview_file_url || ""),
    large_file_url: String(post.large_file_url || ""),
    file_url: String(post.file_url || ""),
    image_width: Number(post.image_width) || 0,
    image_height: Number(post.image_height) || 0,
    tag_string_general: String(post.tag_string_general || post.tag_string || ""),
    tag_string_character: String(post.tag_string_character || ""),
    tag_string_copyright: String(post.tag_string_copyright || ""),
    created_at: String(post.created_at || ""),
    completed: favoriteFolderOf(post) === "completed",
    folder: favoriteFolderOf(post),
    preset: chosenExpansion(post.preset),
    reversePreset: chosenReverse(post.reversePreset),
    autoEnabled: post.autoEnabled !== false,
    queueOrder: Math.max(0, Number(post.queueOrder) || 0),
    prompt: String(post.prompt || "").slice(0, 100000),
    customInstruction: String(post.customInstruction || "").slice(0, 4000),
    resolvedPreset: String(post.resolvedPreset || ""),
    reverseStatus: String(post.reverseStatus || "idle"),
    reverseError: String(post.reverseError || "").slice(0, 1000),
    cacheStatus: String(post.cacheStatus || "idle"),
    cacheFile: String(post.cacheFile || ""),
    cacheError: String(post.cacheError || "").slice(0, 1000),
    reverseStartedAt: String(post.reverseStartedAt || ""),
    promptWrittenAt: String(post.promptWrittenAt || ""),
    wordedAt: String(post.wordedAt || ""),
    completedAt: String(post.completedAt || ""),
    directRequestId: String(post.directRequestId || ""),
    directStatus: String(post.directStatus || ""),
    createdAt: String(post.createdAt || post.created_at || ""),
    updatedAt: String(post.updatedAt || "")
  };
}
// Multi-engine Translation System (DeepL, Tencent Cloud TMT, Volcengine, Google) with Failover
const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
const getGoogleTranslateKey = () => (sharedState.account?.googleTranslateKey || GOOGLE_TRANSLATE_API_KEY || "").trim();

async function translateDeepL(text, source, target, key, signal) {
  if (!key) throw Error("未配置 DeepL Auth Key");
  const host = key.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
  const targetLang = target.toUpperCase().startsWith("ZH") ? "ZH" : "EN";
  const sourceLang = source.toUpperCase().startsWith("ZH") ? "ZH" : "EN";
  const response = await fetch(`https://${host}/v2/translate`, {
    method: "POST",
    headers: {
      "Authorization": `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: [text],
      target_lang: targetLang,
      source_lang: sourceLang
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])
  });
  if (!response.ok) {
    const errText = await response.text();
    throw Error(`DeepL HTTP ${response.status}: ${errText.slice(0, 120)}`);
  }
  const data = await response.json();
  const resText = data.translations?.[0]?.text;
  if (!resText) throw Error("DeepL 未返回翻译结果");
  return resText;
}

async function translateTencent(text, source, target, secretId, secretKey, signal) {
  if (!secretId || !secretKey) throw Error("未配置腾讯云 SecretId 或 SecretKey");
  const host = "tmt.tencentcloudapi.com";
  const action = "TextTranslate";
  const version = "2018-03-21";
  const region = "ap-guangzhou";
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().split("T")[0];
  const payload = JSON.stringify({
    SourceText: text,
    Source: source.startsWith("zh") ? "zh" : "en",
    Target: target.startsWith("zh") ? "zh" : "en",
    ProjectId: 0
  });

  const hashedPayload = crypto.createHash("sha256").update(payload).digest("hex");
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;

  const hashedCanonicalRequest = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${date}/tmt/tc3_request\n${hashedCanonicalRequest}`;

  const kDate = crypto.createHmac("sha256", "TC3" + secretKey).update(date).digest();
  const kService = crypto.createHmac("sha256", kDate).update("tmt").digest();
  const kSigning = crypto.createHmac("sha256", kService).update("tc3_request").digest();
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${date}/tmt/tc3_request, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      "Authorization": authorization,
      "Content-Type": "application/json; charset=utf-8",
      "Host": host,
      "X-TC-Action": action,
      "X-TC-Version": version,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": region
    },
    body: payload,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])
  });

  const data = await response.json();
  if (data?.Response?.Error) {
    throw Error(`腾讯云翻译 [${data.Response.Error.Code}]: ${data.Response.Error.Message}`);
  }
  const translated = data?.Response?.TargetText;
  if (!translated) throw Error("腾讯云未返回有效翻译结果");
  return translated;
}

async function translateVolcengine(text, source, target, accessKey, secretKey, signal) {
  if (!accessKey || !secretKey) throw Error("未配置火山引擎 AccessKey 或 SecretKey");
  const service = "translate";
  const version = "2020-06-01";
  const region = "cn-north-1";
  const host = "translate.volcengineapi.com";
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const payload = JSON.stringify({
    TargetLanguage: target.startsWith("zh") ? "zh" : "en",
    SourceLanguage: source.startsWith("zh") ? "zh" : "en",
    TextList: [text]
  });

  const hashedPayload = crypto.createHash("sha256").update(payload).digest("hex");
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-content-sha256:${hashedPayload}\nx-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = `POST\n/\nAction=TranslateText&Version=${version}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;

  const hashedCanonical = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = `HMAC-SHA256\n${amzDate}\n${dateStamp}/${region}/${service}/request\n${hashedCanonical}`;

  const kDate = crypto.createHmac("sha256", secretKey).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(service).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("request").digest();
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization = `HMAC-SHA256 Credential=${accessKey}/${dateStamp}/${region}/${service}/request, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}/?Action=TranslateText&Version=${version}`, {
    method: "POST",
    headers: {
      "Authorization": authorization,
      "Content-Type": "application/json",
      "Host": host,
      "X-Date": amzDate,
      "X-Content-Sha256": hashedPayload
    },
    body: payload,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])
  });

  const data = await response.json();
  if (data?.ResponseMetadata?.Error) {
    throw Error(`火山引擎翻译 [${data.ResponseMetadata.Error.Code}]: ${data.ResponseMetadata.Error.Message}`);
  }
  const translated = data?.TranslationList?.[0]?.Translation;
  if (!translated) throw Error("火山引擎未返回翻译结果");
  return translated;
}

async function googleTranslatePart(part, source, target, signal) {
  const gKey = getGoogleTranslateKey();
  if (gKey) {
    const response = await fetch('https://translation.googleapis.com/language/translate/v2', {
      method: 'POST',
      headers: {'Content-Type':'application/json', 'X-goog-api-key': gKey},
      body: JSON.stringify({q:part, source, target, format:'text'}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)])
    });
    if (!response.ok) throw Error(`Google Cloud Translation HTTP ${response.status}`);
    const data = await response.json();
    const translated = data?.data?.translations?.[0]?.translatedText;
    if (typeof translated !== 'string') throw Error('Google Cloud Translation 响应格式错误');
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
    ? 'Google 网页翻译返回 429（请在设置中配置 DeepL、腾讯云或火山引擎）'
    : `Google 网页翻译 HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data?.[0])) throw Error('Google 网页翻译响应格式错误');
  return data[0].map(segment => segment?.[0] || '').join('');
}

async function runTranslationWithFailover(text, source, target, signal) {
  const account = sharedState.account || {};
  const primary = account.primaryTranslator || "deepl";
  const fallback = account.translateFallback !== false;

  const engines = [
    {
      id: "deepl",
      name: "DeepL",
      available: Boolean(account.deeplKey?.trim()),
      fn: () => translateDeepL(text, source, target, account.deeplKey.trim(), signal)
    },
    {
      id: "tencent",
      name: "腾讯云 TMT",
      available: Boolean(account.tencentSecretId?.trim() && account.tencentSecretKey?.trim()),
      fn: () => translateTencent(text, source, target, account.tencentSecretId.trim(), account.tencentSecretKey.trim(), signal)
    },
    {
      id: "volcengine",
      name: "火山引擎",
      available: Boolean(account.volcAccessKey?.trim() && account.volcSecretKey?.trim()),
      fn: () => translateVolcengine(text, source, target, account.volcAccessKey.trim(), account.volcSecretKey.trim(), signal)
    },
    {
      id: "google",
      name: "Google 翻译",
      available: true,
      fn: () => googleTranslatePart(text, source, target, signal)
    }
  ];

  const order = [
    ...engines.filter(e => e.id === primary),
    ...engines.filter(e => e.id !== primary)
  ];

  const errors = [];
  for (let i = 0; i < order.length; i++) {
    const engine = order[i];
    if (i > 0 && !fallback) break;
    if (!engine.available && engine.id !== "google") continue;

    try {
      const result = await engine.fn();
      return { text: result, engine: engine.name, usedFallback: i > 0 };
    } catch (err) {
      errors.push(`${engine.name}: ${err.message}`);
    }
  }

  throw Error(`全部翻译引擎尝试失败：\n${errors.join("\n")}`);
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
    let lastEngine = '';
    let fallbackHappened = false;
    for (const part of translationChunks(text)) {
      if (!part.trim()) { translated.push(part); continue; }
      const resObj = await runTranslationWithFailover(part, source, target, controller.signal);
      translated.push(resObj.text);
      lastEngine = resObj.engine;
      if (resObj.usedFallback) fallbackHappened = true;
    }
    if (!res.headersSent) res.json({text: translated.join(''), engine: lastEngine, usedFallback: fallbackHappened});
  } catch (error) {
    if (!res.headersSent && !controller.signal.aborted) res.status(502).json({error:`翻译失败：${error.message}`});
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
    let lastEngine = '';
    let fallbackHappened = false;
    for (const part of segments) {
      if (!part.trim()) { translated.push(part); continue; }
      const chunks = [];
      for (const chunk of translationChunks(part)) {
        const resObj = await runTranslationWithFailover(chunk, 'en', 'zh-CN', controller.signal);
        chunks.push(resObj.text);
        lastEngine = resObj.engine;
        if (resObj.usedFallback) fallbackHappened = true;
      }
      translated.push(chunks.join(''));
    }
    if (!res.headersSent) res.json({segments: translated, engine: lastEngine, usedFallback: fallbackHappened});
  } catch (error) {
    if (!res.headersSent && !controller.signal.aborted) res.status(502).json({error:`翻译失败：${error.message}`});
  }
});

app.post('/api/translate-test', async (req, res) => {
  const engine = req.body?.engine || req.body?.primaryTranslator || sharedState.account.primaryTranslator || "deepl";
  const text = req.body?.text || "erotic lingerie girl with exposed cleavage, beautiful anime face, highly detailed";
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    let result = '';
    if (engine === 'deepl') {
      result = await translateDeepL(text, 'en', 'zh-CN', req.body?.deeplKey || sharedState.account.deeplKey, controller.signal);
    } else if (engine === 'tencent') {
      result = await translateTencent(text, 'en', 'zh-CN', req.body?.tencentSecretId || sharedState.account.tencentSecretId, req.body?.tencentSecretKey || sharedState.account.tencentSecretKey, controller.signal);
    } else if (engine === 'volcengine') {
      result = await translateVolcengine(text, 'en', 'zh-CN', req.body?.volcAccessKey || sharedState.account.volcAccessKey, req.body?.volcSecretKey || sharedState.account.volcSecretKey, controller.signal);
    } else {
      result = await googleTranslatePart(text, 'en', 'zh-CN', controller.signal);
    }
    res.json({ ok: true, engine, original: text, translated: result });
  } catch (error) {
    res.status(502).json({ ok: false, engine, error: error.message });
  }
});

app.get("/api/state", (_req, res) => {
  if (reconcileFavoriteCaches()) writeSharedState();
  renumberAllPendingQueue();
  for (const item of sharedState.favorites) if (item.cacheStatus === "idle") scheduleCache(item.id);
  res.json(sharedState);
});
app.put("/api/account", (req, res) => {
  const body = req.body || {};
  sharedState.account = {
    ...sharedState.account,
    loginName: String(body.loginName ?? sharedState.account.loginName ?? "").trim(),
    loginKey: String(body.loginKey ?? sharedState.account.loginKey ?? "").trim(),
    googleTranslateKey: String(body.googleTranslateKey ?? sharedState.account.googleTranslateKey ?? "").trim(),
    pixivCookie: String(body.pixivCookie ?? sharedState.account.pixivCookie ?? "").trim(),
    pixivRefreshToken: String(body.pixivRefreshToken ?? sharedState.account.pixivRefreshToken ?? "").trim(),
    primaryTranslator: String(body.primaryTranslator ?? sharedState.account.primaryTranslator ?? "deepl").trim(),
    translateFallback: body.translateFallback !== undefined ? Boolean(body.translateFallback) : (sharedState.account.translateFallback !== false),
    deeplKey: String(body.deeplKey ?? sharedState.account.deeplKey ?? "").trim(),
    tencentSecretId: String(body.tencentSecretId ?? sharedState.account.tencentSecretId ?? "").trim(),
    tencentSecretKey: String(body.tencentSecretKey ?? sharedState.account.tencentSecretKey ?? "").trim(),
    volcAccessKey: String(body.volcAccessKey ?? sharedState.account.volcAccessKey ?? "").trim(),
    volcSecretKey: String(body.volcSecretKey ?? sharedState.account.volcSecretKey ?? "").trim()
  };
  writeSharedState();
  res.json({ ok: true, account: sharedState.account, updatedAt: sharedState.updatedAt });
});
app.put("/api/preferences", (req, res) => {
  const allowedModes = new Set([
    "latest", "popular-day", "popular-week", "popular-month", "viewed", "favcount", "comment", "upvotes", "score", "rank", "mpixels", "favorites", "metadata",
    "pixiv-daily", "pixiv-weekly", "pixiv-monthly", "pixiv-ai", "pixiv-r18-daily", "pixiv-r18-weekly", "pixiv-r18-ai", "pixiv-r18"
  ]);
  const validRatings = ["g", "s", "q", "e"];
  const body = req.body || {};
  const ratings = Array.isArray(body.ratings) ? body.ratings.filter(x => validRatings.includes(x)) : sharedState.preferences.ratings;
  const pixivRating = body.pixivRating === 'r18' ? 'r18' : (body.pixivRating === 'safe' ? 'safe' : (sharedState.preferences.pixivRating || 'safe'));
  const pixivDates = body.pixivDates && typeof body.pixivDates === 'object' ? Object.fromEntries(Object.entries(body.pixivDates).filter(([key, value]) => /^pixiv(?:-r18)?-(?:daily|weekly|monthly|ai)$/.test(key) && /^\d{4}-\d{2}-\d{2}$/.test(String(value)))) : (sharedState.preferences.pixivDates || {});
  sharedState.preferences = {
    mode: allowedModes.has(body.mode) ? body.mode : sharedState.preferences.mode,
    columns: Math.max(3, Math.min(8, Number(body.columns) || sharedState.preferences.columns || 5)),
    ratings: ratings.length ? [...new Set(ratings)] : sharedState.preferences.ratings,
    pixivRating,
    pixivDates,
    search: String(body.search ?? sharedState.preferences.search ?? "").slice(0, 1000),
    selectedTags: Array.isArray(body.selectedTags) ? [...new Set(body.selectedTags.map(String))].slice(0, 100) : sharedState.preferences.selectedTags
  };
  writeSharedState();
  res.json({ ok: true, preferences: sharedState.preferences, updatedAt: sharedState.updatedAt });
});
app.put("/api/favorites", (req, res) => {
  try {
    const values = Array.isArray(req.body?.favorites) ? req.body.favorites : [];
    // Browser copies may be stale: preserve worker-owned results and disk metadata.
    const oldById = new Map(sharedState.favorites.map(item => [String(item.id), item]));
    sharedState.favorites = values.map(item => {
      const prior = oldById.get(String(item?.id));
      const incoming = prior ? { ...item, folder: prior.folder, completed: prior.completed,
        preset: prior.preset, reversePreset:prior.reversePreset, autoEnabled: prior.autoEnabled, queueOrder: prior.queueOrder, prompt: prior.prompt,
        resolvedPreset: prior.resolvedPreset, customInstruction: prior.customInstruction, reverseStatus: prior.reverseStatus,
        reverseError: prior.reverseError, cacheStatus: prior.cacheStatus,
        cacheFile: prior.cacheFile, cacheError: prior.cacheError, reverseStartedAt: prior.reverseStartedAt, promptWrittenAt: prior.promptWrittenAt, wordedAt: prior.wordedAt, completedAt: prior.completedAt, createdAt: prior.createdAt, updatedAt: prior.updatedAt } : item;
      if (incoming && !incoming.createdAt) incoming.createdAt = incoming.created_at || new Date().toISOString();
      return cleanFavorite(incoming);
    }).filter(Boolean).slice(0, 5000);
    const kept = new Set(sharedState.favorites.map(item => String(item.id)));
    for (const prior of oldById.values()) {
      if (kept.has(String(prior.id))) continue;
      // A favorite can be removed while a previous folder move is still
      // being reconciled.  Do not only use the recorded folder here: locate
      // and remove every managed copy belonging to this id so an old cache is
      // not left behind on disk.
      removeFavoriteCaches(prior);
    }
    reconcileFavoriteCaches();
    const changedAt = new Date().toISOString();
    for (const item of sharedState.favorites) item.updatedAt = item.updatedAt || changedAt;
    renumberAllPendingQueue();
    writeSharedState();
    // New and old favorites with no usable cache are both eligible. This also
    // repairs clients that reconnect after a previous download failure.
    for (const item of sharedState.favorites) if (item.cacheStatus === "idle") scheduleCache(item.id);
    res.json({ ok: true, favorites: sharedState.favorites, updatedAt: sharedState.updatedAt });
  } catch (error) {
    console.error('保存收藏失败：', error);
    res.status(500).json({ ok: false, error: error.message || '保存收藏失败' });
  }
});
// Missing favorites are downloaded serially, independently of the reverse queue.
const cacheJobs = new Set();
let cacheTail = Promise.resolve();
function favoriteById(id) { return sharedState.favorites.find(item => String(item.id) === String(id)); }
function imagePath(item) {
  if (!item.cacheFile || !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i.test(item.cacheFile)) return null;
  return path.join(item.folder === "completed" ? COMPLETED_IMAGE_DIR : item.folder === "worded" ? WORDED_IMAGE_DIR : item.folder === "original" ? ORIGINAL_IMAGE_DIR : PENDING_IMAGE_DIR, item.cacheFile);
}
function cacheDirectory(folder) {
  return folder === "completed" ? COMPLETED_IMAGE_DIR : folder === "worded" ? WORDED_IMAGE_DIR : folder === "original" ? ORIGINAL_IMAGE_DIR : PENDING_IMAGE_DIR;
}
const FAVORITE_CACHE_DIRS = [ORIGINAL_IMAGE_DIR, PENDING_IMAGE_DIR, WORDED_IMAGE_DIR, COMPLETED_IMAGE_DIR];
const FAVORITE_CACHE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];
function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}
function locateFavoriteCache(item) {
  const recorded = imagePath(item);
  if (recorded && isFile(recorded)) return { file: recorded, filename: path.basename(recorded) };

  // First look for the recorded filename in every managed folder.  This also
  // repairs a state file whose folder field was updated before the disk move.
  const recordedName = typeof item?.cacheFile === "string" && /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i.test(item.cacheFile)
    ? item.cacheFile : "";
  if (recordedName) {
    const expectedDir = cacheDirectory(item.folder);
    const dirs = [expectedDir, ...FAVORITE_CACHE_DIRS.filter(dir => dir !== expectedDir)];
    for (const dir of dirs) {
      const file = path.join(dir, recordedName);
      if (isFile(file)) return { file, filename: recordedName };
    }
  }

  // Cache filenames are normally generated from the favorite ID. Search its
  // current folder first, then other managed folders for an interrupted move.
  const id = String(item?.id ?? "");
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const expectedDir = cacheDirectory(item.folder);
  const dirs = [expectedDir, ...FAVORITE_CACHE_DIRS.filter(dir => dir !== expectedDir)];
  for (const dir of dirs) {
    for (const ext of FAVORITE_CACHE_EXTENSIONS) {
      const filename = id + "." + ext;
      const file = path.join(dir, filename);
      if (isFile(file)) return { file, filename };
    }
  }
  return null;
}
function cachedImagePath(item) {
  return locateFavoriteCache(item)?.file || null;
}
function removeFavoriteCaches(item) {
  const names = new Set();
  const recorded = typeof item?.cacheFile === "string" && /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i.test(item.cacheFile)
    ? item.cacheFile : "";
  if (recorded) names.add(recorded);
  const id = String(item?.id ?? "");
  if (/^[a-zA-Z0-9_-]+$/.test(id)) {
    for (const ext of FAVORITE_CACHE_EXTENSIONS) names.add(`${id}.${ext}`);
  }
  for (const dir of FAVORITE_CACHE_DIRS) {
    for (const name of names) {
      try { fs.rmSync(path.join(dir, name), { force: true }); } catch (error) { console.error("清理收藏缓存失败：", error.message); }
    }
  }
}
function reconcileFavoriteCache(item) {
  if (!item || !["original", "pending", "worded", "completed"].includes(item.folder)) return false;
  const id = String(item.id);
  const expectedDir = cacheDirectory(item.folder);
  const found = locateFavoriteCache(item);
  let changed = false;

  if (found) {
    const target = path.join(expectedDir, found.filename);
    if (path.resolve(found.file) !== path.resolve(target)) {
      try {
        fs.mkdirSync(expectedDir, { recursive: true });
        if (isFile(target)) {
          // The target is already a usable copy.  Prefer it and discard only
          // the misplaced duplicate; never make state reconciliation fail.
          fs.rmSync(found.file, { force: true });
        } else {
          try {
            fs.renameSync(found.file, target);
          } catch (renameError) {
            // Rename can fail across volumes or when another process briefly
            // holds the file.  Copy+remove is a safe fallback; if that also
            // fails, keep the original file and continue reporting it ready.
            try {
              fs.copyFileSync(found.file, target);
              fs.rmSync(found.file, { force: true });
            } catch (copyError) {
              console.error("校准收藏缓存位置失败：", copyError.message || renameError.message);
            }
          }
        }
      } catch (error) {
        // Cache repair is best effort.  A bad/moving cache must not turn the
        // whole /api/state request into HTTP 500.
        console.error("校准收藏缓存失败：", error.message);
      }
    }
    if (item.cacheFile !== found.filename || item.cacheStatus !== "ready" || item.cacheError) {
      item.cacheFile = found.filename;
      item.cacheStatus = "ready";
      item.cacheError = "";
      changed = true;
    }
    return changed;
  }

  if (item.cacheFile) { item.cacheFile = ""; changed = true; }
  if (item.cacheStatus === "ready" || (item.cacheStatus === "loading" && !cacheJobs.has(id))) {
    item.cacheStatus = "idle";
    item.cacheError = "";
    changed = true;
  } else if (!item.cacheStatus) {
    item.cacheStatus = "idle";
    changed = true;
  }
  return changed;
}
function reconcileFavoriteCaches() {
  let changed = false;
  for (const item of sharedState.favorites) changed = reconcileFavoriteCache(item) || changed;
  return changed;
}
function hasUsableCache(item) {
  return Boolean(locateFavoriteCache(item));
}
function resetCacheForRetry(item) {
  removeFavoriteCaches(item);
  item.cacheFile = "";
  item.cacheStatus = "idle";
  item.cacheError = "";
}

function fileCreationTime(file) {
  if (!file) return '';
  try {
    const stat = fs.statSync(file);
    const ms = Number(stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs || 0);
    return ms > 0 ? new Date(ms).toISOString() : '';
  } catch { return ''; }
}
function wordedImagePath(item) {
  return item?.imageExt && /^[a-z0-9]+$/i.test(String(item.imageExt))
    ? path.join(WORDED_IMAGE_DIR, `${item.id}.${item.imageExt}`) : '';
}
// Prompt ordering is based on when the prompt was written, never on image-cache timestamps.
function ensurePromptWrittenTimes() {
  let changed = false;
  let previousState = new Map();
  try {
    const old = JSON.parse(fs.readFileSync(STATE_FILE + '.before-worded', 'utf8'));
    if (Array.isArray(old.favorites)) previousState = new Map(old.favorites.map(item => [String(item.id), item]));
  } catch {}
  for (const item of sharedState.favorites) {
    if (!item.prompt?.trim() || item.promptWrittenAt) continue;
    const previous = previousState.get(String(item.id));
    // Before this fix, startup could replace wordedAt with the cached image's
    // filesystem time. Recover a genuine saved value from the pre-migration
    // snapshot when possible. Completed favorites kept their original wordedAt.
    const recovered = previous?.wordedAt || (item.folder === 'completed' ? item.wordedAt : '');
    item.promptWrittenAt = String(recovered || item.updatedAt || item.createdAt || item.created_at || '');
    if (item.promptWrittenAt) changed = true;
  }
  if (changed) writeSharedState();
  const list = readWordIndex();
  let wordChanged = false;
  for (const item of list) {
    if (!item.positive?.trim() || item.promptWrittenAt) continue;
    // Handwritten cards have a true card-creation time; generated legacy cards
    // retain their recorded wordedAt when available.
    item.promptWrittenAt = String(item.source === '手写' ? (item.createdAt || item.wordedAt || '') : (item.wordedAt || item.createdAt || item.created_at || ''));
    if (item.promptWrittenAt) wordChanged = true;
  }
  if (wordChanged) saveWordIndex(list);
}
function scheduleCache(id) {
  id = String(id);
  const item = favoriteById(id);
  if (!item || item.cacheStatus === "ready" || cacheJobs.has(String(id))) return;
  cacheJobs.add(String(id));
  cacheTail = cacheTail.catch(() => {}).then(async () => {
    await new Promise(resolve => setTimeout(resolve, 850));
    const current = favoriteById(id);
    if (!current || current.cacheStatus === 'ready') { cacheJobs.delete(String(id)); return; }
    let tmp;
    try {
      current.cacheStatus = "loading"; current.cacheError = ""; writeSharedState();
      const sources = [...new Set([current.large_file_url, current.file_url, current.preview_file_url].filter(Boolean))];
      if (!sources.length) throw Error("No image URL available");
      // Danbooru's CDN rejects browser-spoofed download headers from this
      // server's network path. The same lightweight proxy identity used by
      // /api/image is accepted, while Pixiv still needs a browser UA + referer.
      const headersFor = isPixiv => isPixiv ? ({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Referer": "https://www.pixiv.net/"
      }) : ({
        "User-Agent": "DFlow/0.1",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Cache-Control": "no-cache"
      });
      let body = null;
      let ext = "";
      let lastError = null;
      for (const sourceUrl of sources) {
        try {
          const url = new URL(sourceUrl);
          const isDanbooru = url.hostname === "donmai.us" || url.hostname.endsWith(".donmai.us");
          const isPixiv = url.hostname.endsWith("pximg.net") || url.hostname.endsWith("pixiv.net") || current.source === 'pixiv';
          if (!isDanbooru && !isPixiv) throw Error("No valid image URL");
          const response = await fetch(url, { headers: headersFor(isPixiv), redirect: 'follow', signal: AbortSignal.timeout(60000) });
          if (!response.ok) throw Error(`HTTP ${response.status}`);
          const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
          const fromType = {"image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif"}[type];
          const fromPath = path.extname(url.pathname).replace(/^\./, '').toLowerCase();
          const candidateExt = fromType || (['jpg','jpeg','png','webp','gif'].includes(fromPath) ? fromPath : '');
          if (!candidateExt) throw Error("Response is not a supported image");
          const candidateBody = Buffer.from(await response.arrayBuffer());
          if (candidateBody.length < 100 || candidateBody.length > 60 * 1024 * 1024) throw Error("Image size invalid or over 60 MB");
          body = candidateBody;
          ext = candidateExt;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!body || !ext) throw lastError || Error("Unable to download image");
      const latest = favoriteById(id);
      if (!latest || latest.cacheStatus === 'ready') return;
      const dir = cacheDirectory(latest.folder);
      fs.mkdirSync(dir, {recursive:true});
      tmp = path.join(dir, `${id}.${ext}.part`);
      fs.writeFileSync(tmp, body);
      const filename = `${id}.${ext}`;
      fs.renameSync(tmp, path.join(dir, filename)); tmp = null;
      if (latest.cacheFile && latest.cacheFile !== filename) {
        const old = path.join(dir, latest.cacheFile);
        if (old !== path.join(dir, filename)) fs.rmSync(old, {force:true});
      }
      latest.cacheFile = filename; latest.cacheStatus = "ready"; latest.cacheError = "";
    } catch (error) {
      const latest = favoriteById(id);
      if (latest && latest.cacheStatus !== 'ready') {
        latest.cacheStatus = "error"; latest.cacheError = error.message;
      }
    } finally {
      if (tmp) { try { fs.rmSync(tmp, {force:true}); } catch (error) { console.error("清理临时缓存失败：", error.message); } }
      cacheJobs.delete(id);
      try { writeSharedState(); } catch (error) { console.error('写入缓存状态失败：', error); }
    }
  });
}
app.post('/api/favorites/retry-cache', (req, res) => {
  try {
    const requestedFolder = String(req.body?.folder || 'all');
    const allowed = new Set(['all', 'original', 'pending', 'worded', 'completed']);
    if (!allowed.has(requestedFolder)) return res.status(400).json({ok:false, error:'Invalid folder'});
    let queued = 0;
    for (const item of sharedState.favorites) {
      if (requestedFolder !== 'all' && item.folder !== requestedFolder) continue;
      reconcileFavoriteCache(item);
      if (hasUsableCache(item)) continue;
      if (cacheJobs.has(String(item.id))) { queued++; continue; }
      resetCacheForRetry(item);
      queued++;
    }
    const changedAt = new Date().toISOString();
    for (const item of sharedState.favorites) if (item.cacheStatus === 'idle') item.updatedAt = changedAt;
    writeSharedState();
    for (const item of sharedState.favorites) if (item.cacheStatus === 'idle') scheduleCache(item.id);
    res.json({ok:true, queued, favorites:sharedState.favorites, updatedAt:sharedState.updatedAt});
  } catch (error) {
    console.error('重新下载收藏缓存失败：', error);
    res.status(500).json({ok:false, error:error.message || '重新下载失败'});
  }
});
function moveCache(item, target) {
  const found = locateFavoriteCache(item);
  if (!found) return false;
  const source = found.file;
  const filename = found.filename;
  const destDir = cacheDirectory(target);
  const destination = path.join(destDir, filename);
  if (path.resolve(source) === path.resolve(destination)) {
    item.cacheFile = filename;
    item.cacheStatus = "ready";
    return true;
  }
  try {
    fs.mkdirSync(destDir, {recursive:true});
    if (isFile(destination)) fs.rmSync(source, {force:true});
    else {
      try { fs.renameSync(source, destination); }
      catch (renameError) {
        try { fs.copyFileSync(source, destination); fs.rmSync(source, {force:true}); }
        catch (copyError) {
          console.error("移动收藏缓存失败：", copyError.message || renameError.message);
          return false;
        }
      }
    }
    item.cacheFile = filename;
    item.cacheStatus = "ready";
    item.cacheError = "";
    return true;
  } catch (error) {
    console.error("移动收藏缓存失败：", error.message);
    return false;
  }
}
app.patch("/api/favorites/:id", (req, res) => {
  const item = favoriteById(req.params.id);
  if (!item) return res.status(404).json({error:"Favorite not found"});
  const body = req.body || {};
  const changedAt = new Date().toISOString();
  // Repair an existing on-disk cache before validating a folder move.  This
  // lets a cache whose recorded path is stale remain usable.
  reconcileFavoriteCache(item);
  if (body.folder !== undefined) {
    if (!["original","pending","worded","completed"].includes(body.folder)) return res.status(400).json({error:"Invalid folder"});
    if (["pending","worded"].includes(item.folder) && body.folder === "completed" && (!item.prompt || !hasUsableCache(item))) return res.status(409).json({error:"Prompt and cached image required before release"});
    if (body.folder !== item.folder) moveCache(item, body.folder);
    item.folder = body.folder; item.completed = body.folder === "completed";
    if (body.folder === "pending") { item.autoEnabled = true; item.reverseStatus = "idle"; item.queueOrder = nextReverseOrder(); }
    if (body.folder === "worded") { item.autoEnabled = false; item.queueOrder = 0; }
    if (body.folder === "completed") { item.completedAt = changedAt; }
  }
  if (body.prompt !== undefined) {
    if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 100000) return res.status(400).json({error:"提示词不能为空或超过 100000 字符"});
    item.prompt = body.prompt.trim();
    item.promptWrittenAt = changedAt; item.wordedAt = changedAt;
    if (item.folder === "pending") { moveCache(item, "worded"); item.folder = "worded"; item.autoEnabled = false; item.queueOrder = 0; item.reverseStatus = "success"; }
  }
  if (body.customInstruction !== undefined) item.customInstruction = String(body.customInstruction || "").slice(0,4000);
  if (body.preset !== undefined) {
    if (!validExpansion(body.preset)) return res.status(400).json({error:"Invalid preset"});
    item.preset = body.preset;
  }
  if (body.reversePreset !== undefined) {
    if (!validReverse(body.reversePreset)) return res.status(400).json({error:"Invalid reverse preset"});
    item.reversePreset = body.reversePreset;
  }
  if (typeof body.autoEnabled === "boolean") {
    if (body.autoEnabled && !item.autoEnabled && item.folder === "pending") {
      item.queueOrder = nextReverseOrder();
      // Enqueuing a finished card is an explicit request to regenerate it.
      item.reverseStatus = "idle"; item.reverseError = "";
    }
    item.autoEnabled = body.autoEnabled;
  }
  if (body.retryCache) resetCacheForRetry(item);
  if (body.retryReverse && item.folder === "pending") { item.reverseStatus = "idle"; item.reverseError = ""; item.autoEnabled = true; item.queueOrder = nextReverseOrder(); }
  renumberAllPendingQueue();
  writeSharedState();
  if (item.cacheStatus === "idle") scheduleCache(item.id);
  res.json({ok:true, favorite:item, queue:reverseQueueSnapshot(), updatedAt:sharedState.updatedAt});
});
app.get("/api/reverse/queue", (_req, res) => {
  const queue = renumberAllPendingQueue();
  // Keep the old API contract: list every pending card, not only cards that
  // are currently enabled for automatic processing.  Active cards come from
  // the single renumbered queue; cards that were removed with the + button are
  // appended with queueOrder 0 so MCP can still show them and their prompt
  // status without treating them as eligible work.
  const records = [
    ...queue.items,
    ...sharedState.favorites
      .filter(item => item.folder === 'pending' && item.autoEnabled === false)
      .map(item => ({kind: 'favorite', item})),
    ...queue.worded
      .filter(item => item.folder === 'pending' && item.autoEnabled === false)
      .map(item => ({kind: 'worded', item}))
  ];
  const all = records.map(({kind, item}) => kind === 'favorite'
    ? ({
        id:item.id, preset:item.preset, reversePreset:chosenReverse(item.reversePreset),
        autoEnabled:item.autoEnabled !== false, queueOrder:item.queueOrder || 0,
        reverseStatus:item.reverseStatus, cacheStatus:item.cacheStatus,
        cacheError:item.cacheError, reverseError:item.reverseError,
        customInstruction:item.customInstruction, hasPrompt:Boolean(item.prompt),
        imagePath:hasUsableCache(item) ? cachedImagePath(item) : null
      })
    : ({
        id:item.id, preset:chosenExpansion(item.preset), reversePreset:chosenReverse(item.reversePreset),
        autoEnabled:item.autoEnabled !== false, queueOrder:item.queueOrder || 0,
        reverseStatus:item.reverseStatus || 'idle',
        cacheStatus:item.imageExt && fs.existsSync(path.join(WORDED_IMAGE_DIR,item.id+'.'+item.imageExt)) ? 'ready' : 'error',
        cacheError:'', reverseError:item.reverseError || '', customInstruction:'',
        hasPrompt:Boolean(item.positive),
        imagePath:item.imageExt ? path.join(WORDED_IMAGE_DIR,item.id+'.'+item.imageExt) : null
      }));
  res.json({total:all.length, withoutPrompt:all.filter(item=>!item.hasPrompt).length,
    eligible:all.filter(item=>item.autoEnabled&&item.cacheStatus==='ready'&&(!item.reverseStatus||item.reverseStatus==='idle')).length,items:all});
});
app.post("/api/reverse/next", (_req, res) => {
  const queue = renumberAllPendingQueue();
  const candidate = queue.items.find(({kind, item}) =>
    item.autoEnabled !== false &&
    (kind === 'favorite' ? hasUsableCache(item) : Boolean(item.imageExt && fs.existsSync(path.join(WORDED_IMAGE_DIR, item.id+'.'+item.imageExt)))) &&
    (!item.reverseStatus || item.reverseStatus === 'idle')
  );
  if (!candidate) return res.json({item:null});
  const {kind, item} = candidate;
  item.reverseStatus = 'processing';
  item.reverseError = '';
  item.reverseStartedAt = new Date().toISOString();
  if (kind === 'favorite') {
    writeSharedState();
    return res.json({item:{id:item.id, preset:item.preset, reversePreset:chosenReverse(item.reversePreset), customInstruction:item.customInstruction, imagePath:cachedImagePath(item)}});
  }
  saveWordIndex(queue.worded);
  return res.json({item:{id:item.id, preset:chosenExpansion(item.preset), reversePreset:chosenReverse(item.reversePreset), customInstruction:'', imagePath:path.join(WORDED_IMAGE_DIR,item.id+'.'+item.imageExt)}});
});
function updateReverseTarget(id, update) {
  const favorite = favoriteById(id);
  if (favorite) {
    update(favorite, 'favorite');
    writeSharedState();
    return { kind: 'favorite', item: favorite };
  }
  const list = readWordIndex();
  const manual = list.find(item => String(item.id) === String(id));
  if (!manual) return null;
  update(manual, 'worded');
  saveWordIndex(list);
  return { kind: 'worded', item: manual };
}
async function finishDirectRequest(itemId, status, error = '') {
  return mutateDirectRequests(list => {
    const request = activeDirectRequestIn(list, itemId);
    if (!request) return null;
    request.status = status;
    request.error = String(error || '').slice(0, 1000);
    if (status === 'processing') request.startedAt = new Date().toISOString();
    else request.completedAt = new Date().toISOString();
    return request;
  });
}
app.post("/api/reverse/:id/direct", async (req, res) => {
  const target = findReverseTarget(req.params.id, true);
  if (!target) return res.status(404).json({ error: '图片不在待反推区' });
  const item = target.item;
  const cached = target.kind === 'favorite'
    ? hasUsableCache(item)
    : Boolean(item.imageExt && fs.existsSync(path.join(WORDED_IMAGE_DIR, `${item.id}.${item.imageExt}`)));
  if (!cached) return res.status(409).json({ error: '高清缓存尚未完成，缓存完成后才能直推' });

  const requestedSessionId = String(req.body?.targetSessionId || directTargetSessionId || '').trim();
  let outcome;
  try {
    outcome = await mutateDirectRequests(list => {
      const existing = activeDirectRequestIn(list, item.id);
      if (existing) return { request: existing, reused: true };
      const session = chooseDirectMcpSession(requestedSessionId);
      if (!session) {
        const error = new Error(requestedSessionId ? '指定的 MCP Agent 已离线，请刷新连接后重试' : '没有在线的 MCP Agent，请先连接 DSH 的 DFlow MCP');
        error.statusCode = 409;
        throw error;
      }
      const request = {
        id: crypto.randomUUID(), itemId: String(item.id), kind: target.kind,
        createdAt: new Date().toISOString(), status: 'queued', targetSessionId: session.id,
        sessionId: '', agentName: session.name, error: '', startedAt: '', completedAt: '',
        dshDispatch: { status: 'pending', sessionId: '', title: '', sentAt: '', error: '' }
      };
      updateReverseTarget(item.id, current => {
        current.directRequestId = request.id;
        current.directStatus = 'queued';
        current.reverseStatus = 'direct-queued';
        current.reverseError = '';
      });
      list.push(request);
      return { request, reused: false };
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || '创建直推请求失败' });
  }

  const request = outcome.request;
  if (!request) return res.status(500).json({ error: '服务未创建直推请求' });
  const updated = findReverseTarget(item.id, false);
  // A second click on an existing queued request is intentionally a wake-up,
  // not a second queue entry.
  if (request.status === 'queued') void dispatchDirectRequest(request.id).catch(error => console.error('DFlow 直推自动唤起失败:', error));
  res.status(outcome.reused ? 200 : 202).json({ request, item: directTargetPayload(updated) });
});
app.get("/api/reverse/direct/:requestId", (req, res) => {
  const request = readDirectRequests().find(entry => String(entry.id) === String(req.params.requestId));
  if (!request) return res.status(404).json({ error: '直推请求不存在' });
  const target = findReverseTarget(request.itemId, false);
  res.json({ request, item: directTargetPayload(target) });
});
app.get("/api/reverse/direct", (_req, res) => {
  res.json(readDirectRequests().slice().reverse().slice(0, 200));
});
app.post("/api/reverse/direct/:requestId/dispatch", async (req, res) => {
  const result = await dispatchDirectRequest(req.params.requestId);
  if (!result.request) return res.status(404).json({ error: result.error || '直推请求不存在' });
  const target = findReverseTarget(result.request.itemId, false);
  res.status(result.ok ? 202 : 503).json({ ok: result.ok, error: result.error || '', request: result.request, item: directTargetPayload(target) });
});
app.post("/api/reverse/direct/claim", async (req, res) => {
  const sessionId = String(req.get('X-DFlow-MCP-Session') || '').trim();
  const session = directSessionById(sessionId);
  if (!session) return res.status(401).json({ error: 'MCP 会话无效或已离线，请重新连接 DFlow MCP' });
  session.seenAt = Date.now();
  const requestId = String(req.body?.requestId || '').trim();
  const result = await mutateDirectRequests(list => {
    const eligible = list
      .filter(entry => {
        if (entry.status !== 'queued') return false;
        if (!entry.targetSessionId || String(entry.targetSessionId) === String(session.id)) return true;
        // If the originally pinned MCP process disappeared and reconnected,
        // let the current live DSH MCP reclaim the task instead of leaving it
        // permanently invisible behind a dead session ID.
        return !directSessionById(entry.targetSessionId);
      })
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    let request = requestId ? eligible.find(entry => String(entry.id) === requestId) : eligible[0];
    // A DSH chat can retain a previous wake-up message after DFlow has been
    // restarted. If that ID is no longer in persistence, claim the oldest
    // queued task for this live MCP session instead of silently doing nothing.
    const requestedIdExists = requestId ? list.some(entry => String(entry.id) === requestId) : false;
    if (!request && requestId && !requestedIdExists) request = eligible[0];
    if (!request) return { request: null, item: null, requestIdMissing: Boolean(requestId && !requestedIdExists) };
    const target = findReverseTarget(request.itemId, true);
    if (!target) {
      request.status = 'failed'; request.error = '待反推图片已不存在'; request.completedAt = new Date().toISOString();
      return { gone: true, error: request.error, request };
    }
    request.status = 'processing'; request.targetSessionId = session.id; request.sessionId = session.id; request.agentName = session.name; request.startedAt = new Date().toISOString();
    updateReverseTarget(request.itemId, item => {
      item.reverseStatus = 'processing'; item.reverseError = ''; item.reverseStartedAt = request.startedAt;
      item.directStatus = 'processing';
    });
    return { request, item: target };
  });
  if (result.gone) return res.status(410).json({ error: result.error, request: result.request });
  if (!result.request) return res.json({ request: null, item: null });
  const updated = findReverseTarget(result.request.itemId, false);
  res.json({ request: result.request, item: directTargetPayload(updated) });
});
app.post("/api/reverse/direct/:requestId/cancel", async (req, res) => {
  const result = await mutateDirectRequests(list => {
    const request = list.find(entry => String(entry.id) === String(req.params.requestId));
    if (!request) return { missing: true };
    if (!['queued', 'processing'].includes(request.status)) return { request };
    request.status = 'cancelled'; request.completedAt = new Date().toISOString(); request.error = '用户取消直推';
    updateReverseTarget(request.itemId, item => {
      item.directRequestId = '';
      item.directStatus = '';
      item.reverseStatus = 'idle';
      item.reverseError = '';
      item.reverseStartedAt = '';
    });
    return { request };
  });
  if (result.missing) return res.status(404).json({ error: '直推请求不存在' });
  res.json({ request: result.request, item: directTargetPayload(findReverseTarget(result.request.itemId, false)) });
});

app.post("/api/reverse/:id/result", async (req, res) => {
  const id = String(req.params.id);
  const direct = activeDirectRequest(id);
  const item = favoriteById(id);
  if (!item) {
    const list = readWordIndex();
    const manual = list.find(x => String(x.id) === id);
    if (!manual || manual.folder !== 'pending' || (!direct && manual.reverseStatus !== 'processing') || (direct && direct.status !== 'processing')) {
      return res.status(409).json({error:'Item is not processing in the queue'});
    }
    const prompt = String(req.body?.prompt || '').trim();
    const preset = String(req.body?.resolvedPreset || chosenExpansion(manual.preset));
    if (!expansionNames().includes(preset) || (manual.preset !== '随机' && preset !== chosenExpansion(manual.preset))) return res.status(400).json({error:'Preset mismatch'});
    const minimum = preset === '瑶光真人' ? 45 : 250;
    if (prompt.length < minimum) return res.status(422).json({error:'Prompt too short'});
    manual.positive = prompt.slice(0, 100000);
    manual.folder = 'worded';
    manual.promptWrittenAt = new Date().toISOString();
    manual.wordedAt = manual.promptWrittenAt;
    manual.autoEnabled = false;
    manual.queueOrder = 0;
    manual.reverseStatus = 'success';
    manual.reverseError = '';
    if (direct) {
      manual.directStatus = 'completed';
      manual.directRequestId = '';
      await finishDirectRequest(id, 'completed');
    }
    saveWordIndex(list);
    renumberAllPendingQueue();
    return res.json({ok:true,item:readWordIndex().find(entry=>entry.id===manual.id)||manual});
  }

  const isDirect = Boolean(direct && direct.status === 'processing');
  const normalQueueItem = item.folder === 'pending' && item.autoEnabled && item.reverseStatus === 'processing';
  const directQueueItem = item.folder === 'pending' && item.reverseStatus === 'processing';
  if (!item || !directQueueItem || (!isDirect && !normalQueueItem)) return res.status(409).json({error:"Item is not processing in the queue"});

  const prompt = String(req.body?.prompt || '').trim();
  const preset = String(req.body?.resolvedPreset || item.preset);
  if (!expansionNames().includes(preset) || (item.preset !== "随机" && preset !== item.preset)) return res.status(400).json({error:"Preset mismatch"});
  const minimum = preset === "瑶光真人" ? 45 : 250;
  if (prompt.length < minimum) return res.status(422).json({error:`Prompt too short (minimum ${minimum} characters)`});
  item.prompt = prompt.slice(0, 100000);
  item.resolvedPreset = preset;
  item.promptWrittenAt = new Date().toISOString();
  item.wordedAt = item.promptWrittenAt;
  moveCache(item, "worded");
  item.folder = "worded";
  item.reverseStatus = "success";
  item.reverseError = "";
  item.reverseStartedAt = "";
  item.autoEnabled = false;
  item.queueOrder = 0;
  if (isDirect) {
    item.directStatus = 'completed';
    item.directRequestId = '';
    await finishDirectRequest(id, 'completed');
  }
  renumberAllPendingQueue();
  writeSharedState();
  res.json({ok:true, favorite:item});
});
app.post("/api/reverse/:id/fail", async (req, res) => {
  const id = String(req.params.id);
  const direct = activeDirectRequest(id);
  const item = favoriteById(id);
  if (!item) {
    const list = readWordIndex();
    const manual = list.find(x => String(x.id) === id && x.folder === 'pending');
    if (!manual) return res.status(404).json({error:'Item not pending'});
    manual.reverseStatus = 'failed';
    manual.reverseError = String(req.body?.reason || 'Unknown error').slice(0, 1000);
    manual.reverseStartedAt = '';
    if (direct) {
      manual.directStatus = 'failed';
      manual.directRequestId = direct.id;
      await finishDirectRequest(id, 'failed', manual.reverseError);
    }
    saveWordIndex(list);
    return res.json({ok:true,item:manual});
  }
  if (item.folder !== 'pending') return res.status(409).json({error:'Item is not pending'});
  item.reverseStatus = "failed";
  item.reverseError = String(req.body?.reason || "Unknown error").slice(0,1000);
  item.reverseStartedAt = "";
  if (direct) {
    item.directStatus = 'failed';
    item.directRequestId = direct.id;
    await finishDirectRequest(id, 'failed', item.reverseError);
  }
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
  const previous=locateFavoriteCache(item)?.file || imagePath(item),dir=item.folder==='completed'?COMPLETED_IMAGE_DIR:item.folder==='worded'?WORDED_IMAGE_DIR:item.folder==='original'?ORIGINAL_IMAGE_DIR:PENDING_IMAGE_DIR;
  fs.mkdirSync(dir,{recursive:true});
  const filename=`${item.id}.${ext}`,destination=path.join(dir,filename),temp=destination+'.upload';
  try{
    fs.writeFileSync(temp,body);fs.renameSync(temp,destination);
    if(previous&&path.resolve(previous)!==path.resolve(destination))fs.rmSync(previous,{force:true});
    // Remove a stale duplicate left in another managed folder, but never
    // remove the newly uploaded destination.
    for (const managedDir of FAVORITE_CACHE_DIRS) {
      const duplicate = path.join(managedDir, filename);
      if (path.resolve(duplicate) !== path.resolve(destination)) fs.rmSync(duplicate, {force:true});
    }
    item.cacheFile=filename;item.cacheStatus='ready';item.cacheError='';
    item.image_width=Math.max(1,Math.min(20000,Number(req.query.width)||item.image_width));
    item.image_height=Math.max(1,Math.min(20000,Number(req.query.height)||item.image_height));
    writeSharedState();res.json({ok:true,favorite:item});
  }catch(error){fs.rmSync(temp,{force:true});res.status(500).json({error:error.message});}
});
app.get("/api/reverse/image/:id", (req, res) => {
  const item = favoriteById(req.params.id);
  if (item && reconcileFavoriteCache(item)) writeSharedState();
  if (item?.cacheStatus === "idle") scheduleCache(item.id);
  const found = item && locateFavoriteCache(item);
  const file = item && found ? found.file : null;
  if (!file || !isFile(file)) return res.status(404).send("Cached image not ready");
  res.set("Cache-Control", "private, no-store");
  res.sendFile(file);
});
// One-time migration from the old pending cache directory; preserve existing user images.
for(const item of sharedState.favorites.filter(x=>x.folder==='pending' && x.cacheFile)) {
  const old=path.join(REVERSE_DIR,'pending',item.cacheFile);
  const dest = /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i.test(String(item.cacheFile))
    ? path.join(PENDING_IMAGE_DIR, item.cacheFile) : null;
  if(dest && isFile(old) && !isFile(dest)) {
    try { fs.mkdirSync(PENDING_IMAGE_DIR,{recursive:true}); fs.renameSync(old,dest); }
    catch (error) { console.error('迁移旧待反推缓存失败：', error.message); }
  }
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
reconcileFavoriteCaches();
for (const item of sharedState.favorites) {
  if (!["original","pending","worded","completed"].includes(item.folder)) continue;
  if (item.folder === "pending" && item.autoEnabled && item.prompt && item.reverseStatus === "success") item.reverseStatus = "idle";
  if (item.reverseStatus === "processing") { item.reverseStatus = "idle"; item.reverseStartedAt = ""; }
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
  if (imageActive >= 6) await new Promise(resolve => imageWaiters.push(resolve));
  imageActive++;
  try {
    const startAt = Math.max(Date.now(), imageNextAt, imageCooldownAt);
    imageNextAt = startAt + 120;
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
    const isDanbooru = (url.protocol === "https:" || url.protocol === "http:") && (url.hostname === "donmai.us" || url.hostname.endsWith(".donmai.us"));
    const isPixiv = (url.protocol === "https:" || url.protocol === "http:") && (url.hostname.endsWith("pximg.net"));
    if (!isDanbooru && !isPixiv) return res.status(400).json({error:"Invalid image URL"});
    await withImageSlot(res, async () => {
      // The Danbooru CDN challenges the generic spoofed Chrome UA with HTTP 403.
      // Identify our proxy instead; Pixiv still requires its own referer.
      const headers = { "User-Agent": isDanbooru ? "DFlow/0.1" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" };
      if (isPixiv) headers["Referer"] = "https://www.pixiv.net/";
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
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

// Pixiv APIs: Rankings and Search
app.get("/api/pixiv/ranking", async (req, res) => {
  try {
    const allowedModes = new Set(['daily', 'weekly', 'monthly', 'daily_ai', 'daily_r18', 'weekly_r18', 'daily_r18_ai']);
    const mode = allowedModes.has(String(req.query.mode || '')) ? String(req.query.mode) : 'daily';
    const page = String(Math.max(1, Number(req.query.page) || 1));
    const requestedDate = String(req.query.date || '').trim();
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && !Number.isNaN(Date.parse(`${requestedDate}T00:00:00Z`));
    const today = new Date().toISOString().slice(0, 10);
    if (validDate && requestedDate > today) return res.status(400).json({ error: 'Pixiv 榜单日期不能晚于今天' });
    const url = new URL('https://www.pixiv.net/ranking.php');
    url.searchParams.set('mode', mode);
    url.searchParams.set('format', 'json');
    url.searchParams.set('p', page);
    if (validDate) url.searchParams.set('date', requestedDate.replaceAll('-', ''));
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://www.pixiv.net/",
      "Accept": "application/json"
    };
    if (sharedState.account.pixivCookie) {
      headers["Cookie"] = sharedState.account.pixivCookie;
    }
    let response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    // Pixiv may publish the current day's board a little later than the
    // local clock. A fresh page request for today can therefore be 404 even
    // though yesterday's board is available. Use the newest available board
    // in that one case and tell the client which date it actually received.
    if (response.status === 404 && Number(page) === 1 && validDate && requestedDate === today) {
      const fallback = new Date(`${requestedDate}T00:00:00Z`);
      fallback.setUTCDate(fallback.getUTCDate() - 1);
      const fallbackDate = fallback.toISOString().slice(0, 10);
      url.searchParams.set('date', fallbackDate.replaceAll('-', ''));
      const fallbackResponse = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (fallbackResponse.ok) {
        response = fallbackResponse;
        res.set('X-Pixiv-Effective-Date', fallbackDate);
      }
    }
    if (response.status === 404 && Number(page) > 1) {
      // Pixiv returns HTTP 404 after the last ranking page, not an empty JSON list.
      res.set("X-Pixiv-Has-More", "false");
      return res.json([]);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const hint = mode.includes('_r18')
          ? 'Pixiv R18 榜单需要有效的 PHPSESSID，请在“登录 Pflow”中填写 Pixiv Cookie。'
          : 'Pixiv 拒绝了请求，请检查登录 Cookie 或稍后重试。';
        return res.status(response.status).json({ error: hint, detail: `Pixiv ranking HTTP ${response.status}` });
      }
      return res.status(response.status).json({ error: `Pixiv ranking HTTP ${response.status}` });
    }
    const data = await response.json();
    if (data?.next === false) res.set("X-Pixiv-Has-More", "false");
    const contents = Array.isArray(data?.contents) ? data.contents : [];
    const posts = contents.map(item => {
      const isR18 = item.illust_content_type?.sexual === 1 || item.x_restrict === 1;
      const isR18G = item.illust_content_type?.sexual === 2 || item.x_restrict === 2;
      const rating = isR18G ? "e" : isR18 ? "e" : "g";
      const thumb = String(item.url || "");
      const large = thumb.replace(/\/c\/[0-9x_]+\/img-master\//, "/img-master/");
      return {
        id: `px_${item.illust_id}_p0`,
        source: "pixiv",
        pixiv_id: item.illust_id,
        title: item.title,
        author: item.user_name,
        user_id: item.user_id,
        tags: item.tags || [],
        tag_string: (item.tags || []).join(" "),
        tag_string_general: (item.tags || []).join(" "),
        preview_file_url: thumb,
        large_file_url: large,
        file_url: large,
        image_width: Number(item.width) || 1200,
        image_height: Number(item.height) || 1600,
        page_count: Number(item.illust_page_count) || 1,
        rating,
        rating_count: item.rating_count,
        view_count: item.view_count,
        created_at: item.date || new Date().toISOString()
      };
    });
    res.json(posts);
  } catch (error) {
    res.status(502).json({ error: "获取 Pixiv 榜单失败", detail: error.message });
  }
});

app.get("/api/pixiv/search", async (req, res) => {
  try {
    const word = String(req.query.word || "").trim();
    if (!word) return res.json([]);
    const page = String(Math.max(1, Number(req.query.page) || 1));
    const rating = String(req.query.rating || 'safe') === 'r18' ? 'r18' : 'all';
    const url = `https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(word)}?word=${encodeURIComponent(word)}&order=date_d&mode=${rating}&p=${page}&s_mode=s_tag_full&type=all`;
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://www.pixiv.net/",
      "Accept": "application/json"
    };
    if (sharedState.account.pixivCookie) {
      headers["Cookie"] = sharedState.account.pixivCookie;
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      if ((response.status === 401 || response.status === 403) && rating === 'r18') {
        return res.status(response.status).json({
          error: 'Pixiv R18 搜索需要有效的 PHPSESSID，请在“登录 Pflow”中填写 Pixiv Cookie。',
          detail: `Pixiv 搜索 HTTP ${response.status}`
        });
      }
      return res.status(response.status).json({ error: `Pixiv 搜索 HTTP ${response.status}` });
    }
    const data = await response.json();
    const rawList = data?.body?.illustManga?.data || [];
    const posts = rawList.filter(item => item.id && item.url).map(item => {
      const isR18 = item.xRestrict === 1;
      const isR18G = item.xRestrict === 2;
      const rating = isR18G ? "e" : isR18 ? "e" : "g";
      const thumb = String(item.url || "");
      const large = thumb.replace(/\/c\/[0-9x_]+\/img-master\//, "/img-master/");
      return {
        id: `px_${item.id}_p0`,
        source: "pixiv",
        pixiv_id: item.id,
        title: item.title,
        author: item.userName,
        user_id: item.userId,
        tags: item.tags || [],
        tag_string: (item.tags || []).join(" "),
        tag_string_general: (item.tags || []).join(" "),
        preview_file_url: thumb,
        large_file_url: large,
        file_url: large,
        image_width: Number(item.width) || 1200,
        image_height: Number(item.height) || 1600,
        page_count: Number(item.pageCount) || 1,
        rating,
        bookmark_count: item.bookmarkCount,
        created_at: item.createDate || new Date().toISOString()
      };
    });
    res.json(posts);
  } catch (error) {
    res.status(502).json({ error: "Pixiv 搜索失败", detail: error.message });
  }
});
// Local imported PNGs and their parsed generation metadata are independent of favorites.
const META_DIR = path.join(DATA_DIR, "metadata");
for (const dir of [ORIGINAL_IMAGE_DIR,PENDING_IMAGE_DIR,WORDED_IMAGE_DIR,COMPLETED_IMAGE_DIR,META_DIR]) fs.mkdirSync(dir,{recursive:true});
const META_INDEX = path.join(META_DIR, "index.json");
function readMetaIndex() { try { const list=JSON.parse(fs.readFileSync(META_INDEX,'utf8'));return Array.isArray(list)?list:[]; } catch { return []; } }
function saveMetaIndex(list) { fs.mkdirSync(META_DIR,{recursive:true});fs.writeFileSync(META_INDEX,JSON.stringify(list,null,2)); }
const WORD_INDEX = path.join(WORDED_IMAGE_DIR, "index.json");
function readWordIndex() {
  try {
    const list=JSON.parse(fs.readFileSync(WORD_INDEX,'utf8'));
    if (!Array.isArray(list)) return [];
    let changed=false;
    for (const item of list) {
      if (!item.promptWrittenAt && item.positive?.trim()) {
        item.promptWrittenAt = String(item.source === '手写' ? (item.createdAt || item.wordedAt || '') : (item.wordedAt || item.createdAt || item.created_at || ''));
        changed = changed || Boolean(item.promptWrittenAt);
      }
    }
    if (changed) saveWordIndex(list);
    return list;
  } catch { return []; }
}
function saveWordIndex(list) { fs.mkdirSync(WORDED_IMAGE_DIR,{recursive:true});fs.writeFileSync(WORD_INDEX,JSON.stringify(list,null,2)); }
function renumberWordedQueue(list) {
  const queued = list.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.folder === 'pending' && item.autoEnabled !== false);
  queued.sort((a, b) =>
    (Number(a.item.queueOrder) || Infinity) - (Number(b.item.queueOrder) || Infinity) ||
    a.index - b.index
  );
  queued.forEach(({ item }, index) => { item.queueOrder = index + 1; });
  list.filter(item => item.folder !== 'pending' || item.autoEnabled === false)
    .forEach(item => { item.queueOrder = 0; });
}
function nextWordedOrder(list) {
  let maximum = Math.max(0, ...list.map(item =>
    item.folder === 'pending' && item.autoEnabled !== false ? (safeQueueOrder(item.queueOrder) || 0) : 0
  ));
  maximum = Math.max(maximum, ...sharedState.favorites.map(item =>
    item.folder === 'pending' && item.autoEnabled !== false ? (safeQueueOrder(item.queueOrder) || 0) : 0
  ));
  return maximum + 1;
}
// Favorites and hand-written/metadata cards share the same pending queue.  A
// previous implementation renumbered them separately, so moving a card
// between collections could produce gaps, duplicates, or a timestamp-like
// number.  Keep one authoritative, contiguous sequence for every queued card.
function renumberAllPendingQueue() {
  const worded = readWordIndex();
  const items = [];
  let sequence = 0;
  for (const item of sharedState.favorites) {
    if (item.folder === 'pending' && item.autoEnabled !== false) {
      items.push({ kind: 'favorite', item, sequence: sequence++ });
    }
  }
  for (const item of worded) {
    if (item.folder === 'pending' && item.autoEnabled !== false) {
      items.push({ kind: 'worded', item, sequence: sequence++ });
    }
  }
  items.sort((a, b) =>
    (safeQueueOrder(a.item.queueOrder) ?? Infinity) - (safeQueueOrder(b.item.queueOrder) ?? Infinity) ||
    a.sequence - b.sequence
  );

  let changed = false;
  const activeFavorites = new Set();
  const activeWorded = new Set();
  items.forEach(({ kind, item }, index) => {
    const order = index + 1;
    if (item.queueOrder !== order) {
      item.queueOrder = order;
      changed = true;
    }
    (kind === 'favorite' ? activeFavorites : activeWorded).add(String(item.id));
  });
  for (const item of sharedState.favorites) {
    if (!activeFavorites.has(String(item.id)) && item.queueOrder !== 0) {
      item.queueOrder = 0;
      changed = true;
    }
  }
  for (const item of worded) {
    if (!activeWorded.has(String(item.id)) && item.queueOrder !== 0) {
      item.queueOrder = 0;
      changed = true;
    }
  }
  if (changed) {
    writeSharedState();
    saveWordIndex(worded);
  }
  return { items, worded, changed };
}
function recoverDirectRequests() {
  const requests = readDirectRequests();
  if (!requests.length) return;
  let requestsChanged = false;
  let stateChanged = false;
  for (const request of requests) {
    if (!['queued', 'processing'].includes(request.status)) continue;
    const target = findReverseTarget(request.itemId, true);
    if (!target) {
      request.status = 'failed';
      request.error = '服务重启后待反推图片已不存在';
      request.completedAt = new Date().toISOString();
      requestsChanged = true;
      continue;
    }
    // Session IDs are process-local. After a restart an old target cannot be
    // trusted; let the next connected MCP Agent claim the request.
    if (request.targetSessionId || request.sessionId) {
      request.targetSessionId = '';
      request.sessionId = '';
      requestsChanged = true;
    }
    if (request.status === 'processing') {
      request.status = 'queued';
      request.startedAt = '';
      requestsChanged = true;
    }
    if (request.dshDispatch?.status === 'dispatching') {
      request.dshDispatch = { status: 'pending', sessionId: '', title: '', sentAt: '', error: '' };
      requestsChanged = true;
    }
    updateReverseTarget(request.itemId, item => {
      if (item.directRequestId !== request.id || item.directStatus !== 'queued' || item.reverseStatus !== 'direct-queued') {
        item.directRequestId = request.id;
        item.directStatus = 'queued';
        item.reverseStatus = 'direct-queued';
        item.reverseStartedAt = '';
        item.reverseError = '';
        stateChanged = true;
      }
    });
  }
  if (requestsChanged) writeDirectRequests(requests);
  if (stateChanged) writeSharedState();
}
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
ensurePromptWrittenTimes();
// Repair legacy queue values once the worded index is available, including
// timestamp values written by older builds.
renumberAllPendingQueue();
recoverDirectRequests();
app.get('/api/metadata/images',(_req,res)=>res.json(readMetaIndex()));
app.get('/api/worded/entries',(_req,res)=>{ renumberAllPendingQueue(); res.json(readWordIndex()); });
app.patch('/api/worded/entries/:id',(req,res)=>{
  const list=readWordIndex(),item=list.find(x=>x.id===req.params.id);
  if(!item)return res.status(404).json({error:'有词卡片不存在'});
  const prompt=req.body?.prompt;
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>100000)return res.status(400).json({error:'提示词不能为空或超过 100000 字符'});
  item.positive=prompt.trim();item.promptWrittenAt=new Date().toISOString();item.wordedAt=item.promptWrittenAt;if(item.folder==='pending'){item.folder='worded';item.autoEnabled=false;item.queueOrder=0;item.reverseStatus='success';}renumberWordedQueue(list);saveWordIndex(list);renumberAllPendingQueue();res.json(readWordIndex().find(entry=>entry.id===item.id)||item);
});
app.patch('/api/worded/state/:id',(req,res)=>{
  const list=readWordIndex(), item=list.find(x=>x.id===req.params.id);
  if(!item)return res.status(404).json({error:'有词卡片不存在'});
  const body=req.body || {};
  const folder=body.folder ?? item.folder;
  if(!['worded','pending','completed'].includes(folder))return res.status(400).json({error:'无效目录'});
  if(folder==='pending'&&!item.imageExt)return res.status(409).json({error:'请先在提示词窗口粘贴图片'});
  if(body.preset !== undefined && !validExpansion(body.preset))return res.status(400).json({error:'无效扩写预设'});
  if(body.reversePreset !== undefined && !validReverse(body.reversePreset))return res.status(400).json({error:'无效反推预设'});

  if(body.preset !== undefined)item.preset=body.preset;
  if(body.reversePreset !== undefined)item.reversePreset=body.reversePreset;
  if(body.customInstruction !== undefined)item.customInstruction=String(body.customInstruction || '').slice(0,4000);

  if(folder!==item.folder){
    item.folder=folder;
    if(folder==='pending'){
      item.autoEnabled=true;
      item.reverseStatus='idle';
      item.reverseError='';
      item.queueOrder=nextWordedOrder(list);
    }else{
      item.autoEnabled=false;
      item.queueOrder=0;
      item.reverseStatus='success';
      if(folder==='completed') item.completedAt=new Date().toISOString();
    }
    // Moving folders does not rewrite prompt-written time; it is content chronology.
  }

  if(typeof body.autoEnabled === 'boolean'){
    if(folder !== 'pending'){
      item.autoEnabled=false;
      item.queueOrder=0;
    }else if(body.autoEnabled){
      const wasEnabled=item.autoEnabled === true;
      if(!wasEnabled || !Number(item.queueOrder)) item.queueOrder=nextWordedOrder(list);
      item.autoEnabled=true;
      // Re-adding a card is an explicit request to run the full workflow again.
      if(!wasEnabled || body.retryReverse){
        item.reverseStatus='idle';
        item.reverseError='';
      }
    }else{
      item.autoEnabled=false;
      item.queueOrder=0;
    }
  }
  if(body.retryReverse){
    if(folder!=='pending')return res.status(400).json({error:'只有待反推区的卡片可以重新反推'});
    item.autoEnabled=true;
    item.queueOrder=nextWordedOrder(list);
    item.reverseStatus='idle';
    item.reverseError='';
  }
  renumberWordedQueue(list);
  saveWordIndex(list);
  renumberAllPendingQueue();
  res.json({ok:true,entry:readWordIndex().find(entry=>entry.id===item.id)||item});
});
app.post('/api/worded/entries',(req,res)=>{
  const positive=String(req.body?.prompt||'').trim().slice(0,100000);
  if(!positive)return res.status(400).json({error:'提示词不能为空'});
  const summary=String(req.body?.summary||'').trim().slice(0,200);
  if(!summary && !req.body?.hasImage)return res.status(400).json({error:'请粘贴图片或填写概述'});
  const now=new Date().toISOString();
  const item={id:crypto.randomUUID(),name:'手写提示词',createdAt:now,promptWrittenAt:now,wordedAt:now,source:'手写',positive,
    summary,model:'',negative:'',loras:[],cfg:null,steps:null,sampler:'',scheduler:'',seed:null,denoise:null,
    width:0,height:0,imageExt:'',folder:'worded',autoEnabled:false,queueOrder:0,preset:presets.defaultExpansion,reversePreset:presets.defaultReverse,reverseStatus:'success'};
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
app.use("/api", (_req, res) => res.status(404).json({ok:false, error:"接口不存在，请确认已重启到最新版 DFlow 服务"}));
app.use((_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, HOST, () => console.log(`DFlow 已启动：http://${HOST}:${PORT}`));
