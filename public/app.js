const gallery = document.querySelector('#gallery');
const sentinel = document.querySelector('#sentinel');
const statusEl = document.querySelector('#status');
const menu = document.querySelector('#menu');
const lightbox = document.querySelector('#lightbox');
const lightboxImage = document.querySelector('#lightboxImage');
const searchInput = document.querySelector('#search');

const FAVORITES_KEY = 'dflowFavoritesV1';
const PREFERENCES_KEY = 'dflowPreferencesV1';
const ratingNames = { g: '全年龄', s: '敏感', q: '较敏感', e: '成人' };
const reversePresets = ['动作扩写', '艺术导演扩写', '随机', '巨构提示词', '瑶光真人', '通用扩写', '动漫专用'];
const folderName = {original:'原始收藏', pending:'待反推', completed:'已完成', metadata:'元数据'};
const postFolder = post => post.folder || (post.completed ? 'completed' : 'original');
const state = { columns: [], heights: [] };
const selectedPopularTags = new Set();

let previewPost = null;
let previewCard = null;
let mode = 'latest';
let favoriteFolder = 'original';
let loading = false;
let ended = false;
let cursor = '';
let pageNo = 1;
let generation = 0;
let activePost = null;
let forcedCols = 0;
let manualSearchTags = '';
let requestController = null;
let popularTags = [];
let nextLoadTimer = 0;
let favoriteCache = [];
let preferenceSaveTimer = 0;
let restoringSharedState = true;
let sharedUpdatedAt = '';
let loadFailed = false;
let lastRequestFinishedAt = 0;
let pendingRatingResults = new Map();
let currentPosts = [];
const viewCache = new Map();
const undoStack = [];
let undoing = false;

const fallbackTags = [
  ['单人','solo'],['双人','2girls'],['多人','multiple_girls'],['看向观众','looking_at_viewer'],['微笑','smile'],['张嘴','open_mouth'],
  ['长发','long_hair'],['短发','short_hair'],['白发','white_hair'],['黑发','black_hair'],['金发','blonde_hair'],['棕发','brown_hair'],['蓝发','blue_hair'],['粉发','pink_hair'],['紫发','purple_hair'],['红发','red_hair'],
  ['蓝眼睛','blue_eyes'],['红眼睛','red_eyes'],['绿眼睛','green_eyes'],['棕眼睛','brown_eyes'],['紫眼睛','purple_eyes'],['闭眼','closed_eyes'],
  ['连衣裙','dress'],['女仆装','maid'],['校服','school_uniform'],['水手服','serafuku'],['泳装','swimsuit'],['和服','kimono'],['制服','uniform'],['裙子','skirt'],['衬衫','shirt'],['夹克','jacket'],
  ['蝴蝶结','bow'],['发带','hair_ribbon'],['帽子','hat'],['眼镜','glasses'],['手套','gloves'],['耳环','earrings'],['项链','necklace'],
  ['猫耳','cat_ears'],['兽耳','animal_ears'],['尾巴','tail'],['翅膀','wings'],['角','horns'],['光环','halo'],
  ['站立','standing'],['坐着','sitting'],['躺着','lying'],['跪姿','kneeling'],['奔跑','running'],['侧身','from_side'],['背面','from_behind'],['全身','full_body'],['上半身','upper_body'],['特写','close-up'],
  ['户外','outdoors'],['室内','indoors'],['夜晚','night'],['白天','day'],['天空','sky'],['海滩','beach'],['城市','city'],['卧室','bedroom'],['教室','classroom'],['森林','forest'],
  ['简单背景','simple_background'],['白色背景','white_background'],['黑色背景','black_background'],['模糊背景','blurry_background'],
  ['高分辨率','highres'],['极高分辨率','absurdres'],['壁纸','wallpaper'],['官方画作','official_art'],['同人作品','fanart'],
  ['腮红','blush'],['泪水','tears'],['害羞','embarrassed'],['惊讶','surprised'],['生气','angry'],['睡觉','sleeping'],['比心','heart_hands'],['和平手势','v'],
  ['独奏焦点','solo_focus'],['日期未知','dated'],['签名','signature'],['文字','text'],['食物','food'],['花','flower'],['武器','weapon'],['剑','sword'],['魔法','magic']
];
const zhByTag = new Map(fallbackTags.map(([zh, name]) => [name, zh]));
Object.entries({
  '1girl':'单个女性','1boy':'单个男性','breasts':'胸部','large_breasts':'丰满胸部','medium_breasts':'中等胸部','small_breasts':'小胸部',
  'long_sleeves':'长袖','holding':'手持物品','hair_ornament':'发饰','closed_mouth':'闭嘴','hair_between_eyes':'发丝遮眼','navel':'肚脐',
  'jewelry':'首饰','thighhighs':'过膝袜','ribbon':'丝带','cleavage':'乳沟','white_shirt':'白衬衫','very_long_hair':'超长发','bare_shoulders':'露肩',
  'twintails':'双马尾','multicolored_hair':'多色头发','male_focus':'男性焦点','collarbone':'锁骨','grey_hair':'灰发','yellow_eyes':'黄眼睛',
  'underwear':'内衣','ahoge':'呆毛','ponytail':'马尾','sidelocks':'鬓发','braid':'辫子','short_sleeves':'短袖','heart':'爱心','shoes':'鞋子',
  'monochrome':'单色','cowboy_shot':'大腿以上构图',':d':'大笑','thighs':'大腿','panties':'内裤','hetero':'异性','ass':'臀部','teeth':'牙齿',
  'frills':'褶边','sweat':'汗','collared_shirt':'有领衬衫','hair_bow':'发饰蝴蝶结','open_clothes':'敞开衣物','parted_lips':'微张嘴唇',
  'pantyhose':'连裤袜','comic':'漫画','pleated_skirt':'百褶裙','pants':'长裤','hairband':'发箍','boots':'靴子','bikini':'比基尼','nipples':'乳头'
}).forEach(([name, zh]) => zhByTag.set(name, zh));

function ratingChecks() {
  return [...document.querySelectorAll('.rating-menu input:checked')].map(x => x.value);
}
function columnCount() {
  return forcedCols || (+getComputedStyle(document.documentElement).getPropertyValue('--cols') || 5);
}
function resetColumns() {
  gallery.innerHTML = '';
  state.columns = [];
  state.heights = [];
  const count = mode === 'favorites' && favoriteFolder === 'pending'
    ? Math.min(columnCount(), innerWidth <= 760 ? 1 : innerWidth <= 1100 ? 2 : 4)
    : mode === 'favorites' && favoriteFolder === 'metadata'
      ? Math.min(columnCount(), innerWidth <= 760 ? 1 : innerWidth <= 1100 ? 2 : 4)
    : mode === 'favorites' && favoriteFolder === 'completed'
      ? Math.min(columnCount(), innerWidth <= 760 ? 2 : innerWidth <= 1100 ? 4 : 8)
      : columnCount();
  gallery.style.setProperty('--gallery-cols', count);
  for (let i = 0; i < count; i++) {
    const column = document.createElement('div');
    column.className = 'column';
    gallery.append(column);
    state.columns.push(column);
    state.heights.push(0);
  }
}
function setColumns(count) {
  forcedCols = Math.max(3, Math.min(8, Number(count) || 5));
  document.documentElement.style.setProperty('--cols', forcedCols);
  updateColumnLabel();
  schedulePreferenceSave();
  load(true);
}
function updateColumnLabel() {
  const button = document.querySelector('#columnButton');
  if (button) button.textContent = `列数 ${columnCount()}⌄`;
  document.querySelectorAll('#columnOptions button').forEach(x => x.classList.toggle('active', Number(x.dataset.columns) === columnCount()));
}
function renderColumnOptions() {
  const box = document.querySelector('#columnOptions');
  box.innerHTML = Array.from({ length: 6 }, (_, i) => i + 3).map(n => `<button type="button" data-columns="${n}">${n} 列</button>`).join('');
  box.querySelectorAll('button').forEach(x => x.onclick = () => {
    setColumns(x.dataset.columns);
    document.querySelector('#columnPicker').classList.remove('open');
  });
  updateColumnLabel();
}
// 全站无时间限制的聚合排序经常触发 Danbooru 数据库超时；
// 这些榜单统一使用近一个月的数据，保证翻页稳定。
const searchOrderByMode = {
  favcount: 'age:<1month order:favcount',
  comment: 'age:<1month order:comment',
  upvotes: 'age:<1month order:upvotes',
  score: 'age:<1month order:score',
  rank: 'age:<1month order:rank',
  mpixels: 'age:<1month order:mpixels'
};
function isPopularMode(value = mode) {
  return value.startsWith('popular-');
}
function isPagedMode(value = mode) {
  return value !== 'latest' && value !== 'viewed' && value !== 'favorites';
}
function baseTags(includeOrder = true) {
  const tags = [];
  if (manualSearchTags) tags.push(normalizeSearchTags(manualSearchTags));
  tags.push(...selectedPopularTags);
  if (includeOrder && searchOrderByMode[mode]) tags.push(searchOrderByMode[mode]);
  return tags;
}
function normalizeSearchTags(value) {
  // Danbooru 标签里的下划线和括号不需要反斜杠转义。
  // 兼容从 Markdown、正则或聊天内容中复制来的 qingxiao\_(wuthering\_waves) 写法。
  return String(value || '').trim().replace(/\\([_()])/g, '$1');
}
function queryTags(rating = '') {
  const tags = baseTags();
  if (rating) tags.push(`rating:${rating}`);
  return tags.join(' ');
}
function authHeaders() {
  const headers = {};
  if (localStorage.loginName && localStorage.loginKey) {
    headers['X-Danbooru-Username'] = localStorage.loginName;
    headers['X-Danbooru-Key'] = localStorage.loginKey;
  }
  return headers;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}
async function requestPosts(url, signal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await fetch(url, { headers: authHeaders(), cache: 'no-store', signal });
    } catch (error) {
      if (signal?.aborted || attempt) throw error;
      await sleep(3000, signal);
      continue;
    }
    if (response.ok) return response.json();
    const detail = await response.json().catch(() => ({}));
    if ([420, 429].includes(response.status) && attempt === 0) {
      const wait = Math.min(120000, Math.max(10000, Number(response.headers.get('Retry-After') || 0) * 1000));
      statusEl.textContent = `请求过快，等待 ${Math.ceil(wait / 1000)} 秒后继续…`;
      await sleep(wait, signal);
      continue;
    }
    if ([500, 502, 503, 504].includes(response.status) && attempt === 0) {
      await sleep(3000, signal);
      continue;
    }
    throw Error(detail.message || detail.detail || `请求失败 (${response.status})`);
  }
  throw Error('网络连接失败');
}
async function getPosts(tags, page, limit = 36, signal) {
  if (isPopularMode()) {
    const scale = mode.slice('popular-'.length);
    const params = new URLSearchParams({ scale, limit: String(limit), tags });
    if (page) params.set('page', String(page));
    return requestPosts(`/api/explore/popular?${params}`, signal);
  }
  if (mode === 'viewed') {
    return requestPosts('/api/explore/viewed', signal);
  }
  const params = new URLSearchParams({ limit: String(limit), tags });
  if (isPagedMode() && page) params.set('page', String(page));
  else if (cursor && mode === 'latest') params.set('page', `b${cursor}`);
  return requestPosts(`/api/posts?${params}`, signal);
}
function imageSrc(url) {
  return url ? `/api/image?url=${encodeURIComponent(url)}` : '';
}
function readLocalFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function readFavorites() {
  return favoriteCache;
}
async function saveFavorites(items) {
  favoriteCache = items;
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(items));
  updateFavoriteCount();
  for (const key of viewCache.keys()) if (key.startsWith('favorites|')) viewCache.delete(key);
  try {
    const response = await fetch('/api/favorites', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorites: items })
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const result = await response.json();
    sharedUpdatedAt = result.updatedAt || sharedUpdatedAt;
    if (Array.isArray(result.favorites)) {
      favoriteCache = result.favorites;
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteCache));
      updateFavoriteCount();
    }
  } catch (error) {
    toast(`收藏已保存在本机，局域网同步失败：${error.message}`);
  }
}
function favoriteFields(post) {
  return {
    id: post.id, rating: post.rating,
    preview_file_url: post.preview_file_url, large_file_url: post.large_file_url, file_url: post.file_url,
    image_width: post.image_width, image_height: post.image_height,
    tag_string_general: post.tag_string_general || '', tag_string_character: post.tag_string_character || '',
    tag_string_copyright: post.tag_string_copyright || '', created_at: post.created_at || '', completed: Boolean(post.completed),
    folder: postFolder(post), preset: post.preset || '动漫专用', autoEnabled: post.autoEnabled !== false,
    prompt: post.prompt || '', resolvedPreset: post.resolvedPreset || '', reverseStatus: post.reverseStatus || 'idle',
    reverseError: post.reverseError || '', cacheStatus: post.cacheStatus || 'idle', cacheFile: post.cacheFile || ''
  };
}
function isFavorite(id) {
  return readFavorites().some(item => String(item.id) === String(id));
}
function updateFavoriteCount() {
  const items = readFavorites();
  document.querySelector('#favoriteCount').textContent = items.length;
  const completed = document.querySelector('#completedCount');
  if (completed) completed.textContent = items.filter(item => postFolder(item) === 'completed').length;
  const pending = document.querySelector('#pendingCount');
  if (pending) pending.textContent = items.filter(item => postFolder(item) === 'pending').length;
}
function updateFavoriteButtons(id) {
  const active = isFavorite(id);
  document.querySelectorAll(`[data-favorite-id="${CSS.escape(String(id))}"]`).forEach(button => {
    button.textContent = active ? '♥' : '♡';
    button.classList.toggle('active', active);
    button.title = active ? '取消收藏' : '加入本地收藏';
    button.setAttribute('aria-label', button.title);
  });
}
function favoriteVisibleItems() {
  return readFavorites()
    .filter(item => postFolder(item) === favoriteFolder)
    .filter(favoriteMatches)
    // 横向长方形优先显示在收藏页顶部；同类内部保持收藏顺序。
    .sort((a, b) => Number((b.image_width || 0) > (b.image_height || 0)) - Number((a.image_width || 0) > (a.image_height || 0)));
}
function refreshFavoriteGallery(preserveScroll = true) {
  if (mode !== 'favorites') return;
  if (favoriteFolder === 'metadata') { loadMetadataGallery(); return; }
  const top = scrollY;
  const posts = favoriteVisibleItems();
  resetColumns();
  currentPosts = posts.slice();
  render(posts);
  ended = true;
  sentinel.classList.remove('loading');
  sentinel.classList.add('done');
  statusEl.textContent = posts.length ? `显示 ${posts.length} 个${folderName[favoriteFolder]}` : `还没有${folderName[favoriteFolder]}图片`;
  if (preserveScroll) requestAnimationFrame(() => scrollTo({ top }));
}
function removeVisibleCard(id) {
  const top = scrollY;
  const card = document.querySelector(`[data-completed-id="${CSS.escape(String(id))}"], [data-reverse-id="${CSS.escape(String(id))}"], [data-favorite-id="${CSS.escape(String(id))}"]`)?.closest('.card, .reverse-card');
  card?.remove();
  const posts = favoriteVisibleItems();
  const cards = new Map([...gallery.querySelectorAll('.card, .reverse-card')].map(node =>
    [String(node.dataset.reverseId || node.querySelector('[data-favorite-id]')?.dataset.favoriteId),node]));
  if (posts.some(post => !cards.has(String(post.id)))) { refreshFavoriteGallery(true); return; }
  currentPosts = posts;
  state.heights = state.columns.map(() => 0);
  for (const post of posts) {
    const index = state.heights.indexOf(Math.min(...state.heights));
    state.columns[index].append(cards.get(String(post.id)));
    state.heights[index] += favoriteFolder === 'original' ? (post.image_height || 1) / (post.image_width || 1) + .03 : 1;
  }
  statusEl.textContent = posts.length ? `显示 ${posts.length} 个${folderName[favoriteFolder]}` : `还没有${folderName[favoriteFolder]}图片`;
  requestAnimationFrame(() => scrollTo({top}));
}
async function patchFavorite(id, changes) {
  const response = await fetch(`/api/favorites/${encodeURIComponent(id)}`, {
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(changes)
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  const index = favoriteCache.findIndex(item => String(item.id) === String(id));
  if (index >= 0) favoriteCache[index] = result.favorite;
  if (Array.isArray(result.queue)) {
    const byId = new Map(result.queue.map(item => [String(item.id), item]));
    favoriteCache.forEach(item => {
      const queued = byId.get(String(item.id));
      if (queued) { item.queueOrder = queued.queueOrder; item.autoEnabled = queued.autoEnabled; }
      else item.queueOrder = 0;
    });
  }
  sharedUpdatedAt = result.updatedAt || sharedUpdatedAt;
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteCache));
  updateFavoriteCount();
  for (const key of viewCache.keys()) if (key.startsWith('favorites|')) viewCache.delete(key);
  return result.favorite;
}
async function moveFavorite(post, target) {
  const before = postFolder(post);
  if (before === target) return;
  try {
    await patchFavorite(post.id, {folder:target});
    if (!undoing) undoStack.push({type:'folder', id:post.id, before});
    if (mode === 'favorites') removeVisibleCard(post.id);
    toast(`已移到“${folderName[target]}”，Ctrl+Z 可撤销`);
  } catch (error) { toast(`移动失败：${error.message}`); }
}
async function toggleCompleted(post) {
  await moveFavorite(post, postFolder(post) === 'completed' ? 'original' : 'completed');
}
function updateCompletedButtons(id) {
  const item = readFavorites().find(entry => String(entry.id) === String(id));
  const done = Boolean(item?.completed);
  document.querySelectorAll(`[data-completed-id="${CSS.escape(String(id))}"]`).forEach(button => {
    button.textContent = done ? '✓' : '○';
    button.classList.toggle('active', done);
    button.title = done ? '标记为未使用' : '标记为已使用';
    button.setAttribute('aria-label', button.title);
  });
}
async function toggleFavorite(post) {
  const items = readFavorites();
  const index = items.findIndex(item => String(item.id) === String(post.id));
  const before = index >= 0 ? { item: { ...items[index] }, index } : null;
  if (!undoing) undoStack.push({ type: 'favorite', post: favoriteFields(post), before });
  if (index >= 0) {
    items.splice(index, 1);
    toast('已取消本地收藏，Ctrl+Z 可撤销');
  } else {
    items.unshift(favoriteFields(post));
    toast('已加入本地收藏，Ctrl+Z 可撤销');
  }
  await saveFavorites(items);
  updateFavoriteButtons(post.id);
  if (mode === 'favorites') {
    removeVisibleCard(post.id);
  }
}
async function undoLastAction() {
  const action = undoStack.pop();
  if (!action) { toast('没有可撤销的收藏操作'); return; }
  undoing = true;
  try {
    const items = readFavorites();
    if (action.type === 'favorite') {
      const currentIndex = items.findIndex(item => String(item.id) === String(action.post.id));
      if (currentIndex >= 0) items.splice(currentIndex, 1);
      if (action.before) items.splice(Math.min(action.before.index, items.length), 0, action.before.item);
      await saveFavorites(items);
      updateFavoriteButtons(action.post.id);
      toast(action.before ? '已撤销取消收藏' : '已撤销收藏');
    } else if (action.type === 'folder') {
      await patchFavorite(action.id, {folder:action.before});
      toast('已撤销移动');
    } else if (action.type === 'completed') {
      const item = items.find(entry => String(entry.id) === String(action.id));
      if (item) item.completed = action.before;
      await saveFavorites(items);
      updateCompletedButtons(action.id);
      toast('已撤销完成标记');
    }
    if (mode === 'favorites') refreshFavoriteGallery(true);
  } finally {
    undoing = false;
  }
}
function favoriteMatches(post) {
  if (!ratingChecks().includes(post.rating)) return false;
  const wanted = [...selectedPopularTags];
  if (manualSearchTags) wanted.push(...manualSearchTags.split(/\s+/).filter(tag => !tag.includes(':')));
  if (!wanted.length) return true;
  const all = `${post.tag_string_general || ''} ${post.tag_string_character || ''} ${post.tag_string_copyright || ''}`.split(/\s+/);
  return wanted.every(tag => all.includes(tag));
}
function isNearLoadPoint() {
  return sentinel.getBoundingClientRect().top <= innerHeight + 1200;
}
function queueNextLoad() {
  clearTimeout(nextLoadTimer);
  if (loading || ended || mode === 'favorites' || !isNearLoadPoint()) return;
  const remaining = Math.max(0, 1800 - (Date.now() - lastRequestFinishedAt));
  nextLoadTimer = setTimeout(() => load(), Math.max(120, remaining));
}
async function load(reset = false) {
  if (!reset && (loading || ended)) return;
  if (reset) {
    clearTimeout(nextLoadTimer);
    requestController?.abort();
    generation++;
    cursor = '';
    pageNo = 1;
    ended = false;
    loadFailed = false;
    currentPosts = [];
    pendingRatingResults.clear();
    resetColumns();
    scrollTo({ top: 0 });
  }
  document.querySelector('#metadataUpload').hidden = mode !== 'favorites' || favoriteFolder !== 'metadata';
  if (mode === 'favorites' && favoriteFolder === 'metadata') { await loadMetadataGallery(); return; }
  if (mode === 'favorites') {
    const posts = favoriteVisibleItems();
    currentPosts = posts.slice();
    render(posts);
    ended = true;
    sentinel.classList.remove('loading');
    sentinel.classList.add('done');
    statusEl.textContent = posts.length ? `显示 ${posts.length} 个${folderName[favoriteFolder]}` : `还没有${folderName[favoriteFolder]}图片`;
    return;
  }
  const run = generation;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 180000);
  requestController = controller;
  loading = true;
  sentinel.classList.remove('done');
  sentinel.classList.add('loading');
  statusEl.textContent = '正在加载…';
  try {
    const ratings = ratingChecks();
    if (!ratings.length) throw Error('请至少选择一个分级');
    // 每个已勾选分级都取完整一批。之前把 36 按分级数量平分，
    // 全选四级时每级只取 12 张，导致榜单一次只出现很少图片。
    const perRatingLimit = 36;
    let results;
    if (mode === 'viewed') {
      results = [await getPosts('', null, 100, controller.signal)];
    } else {
      // Resume an interrupted page from the last successful rating; never fetch
      // the already completed ratings again when the user clicks retry.
      results = [];
      for (const rating of ratings) {
        if (!pendingRatingResults.has(rating)) {
          const posts = await getPosts(queryTags(rating), isPagedMode() ? pageNo : null, perRatingLimit, controller.signal);
          if (run !== generation) return;
          pendingRatingResults.set(rating, posts);
        }
        results.push(pendingRatingResults.get(rating));
      }
    }
    const seen = new Set();
    let posts = results.flat().filter(post => post?.id && !seen.has(post.id) && seen.add(post.id));
    // API 的 tags 过滤偶尔会返回混合分级（尤其是榜单/缓存结果），
    // 前端再做一次硬过滤，避免取消勾选后仍出现其它颜色的分级圆点。
    const selectedRatings = new Set(ratings);
    posts = posts.filter(post => selectedRatings.has(post.rating));
    if (mode === 'viewed') posts = posts.filter(favoriteMatches);
    posts = posts.filter(post => post.preview_file_url || post.large_file_url || post.file_url);
    if (mode === 'latest') posts.sort((a, b) => b.id - a.id);
    if (run !== generation) return;
    if (!posts.length) {
      ended = true;
      statusEl.textContent = '暂时没有更多图片';
      sentinel.classList.add('done');
      return;
    }
    render(posts);
    currentPosts.push(...posts);
    pendingRatingResults.clear();
    if (mode === 'latest') cursor = Math.min(...posts.map(post => post.id));
    else if (isPagedMode()) pageNo++;
    if (mode === 'viewed') {
      ended = true;
      sentinel.classList.add('done');
      statusEl.textContent = `日浏览榜已显示 ${posts.length} 张`;
    } else {
      statusEl.textContent = '继续下滑加载';
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      if (timedOut && run === generation) {
        loadFailed = true;
        ended = true;
        statusEl.textContent = '加载超时，点击这里重试';
        sentinel.classList.add('done');
      }
      return;
    }
    loadFailed = true;
    ended = true;
    statusEl.textContent = `加载失败：${error.message}；点击这里重试`;
    sentinel.classList.add('done');
  } finally {
    clearTimeout(timeout);
    if (requestController === controller) {
      requestController = null;
      loading = false;
      lastRequestFinishedAt = Date.now();
      sentinel.classList.remove('loading');
      if (!loadFailed) queueNextLoad();
    }
  }
}function render(posts) {
  gallery.classList.toggle('reverse-gallery', mode === 'favorites' && favoriteFolder !== 'original');
  for (const post of posts) {
    if (mode === 'favorites' && favoriteFolder !== 'original') { renderReverseCard(post); continue; }
    const card = document.createElement('article');
    card.className = 'card';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = imageSrc(post.preview_file_url || post.large_file_url || post.file_url);
    img.alt = `Danbooru #${post.id}`;
    img.addEventListener('load', () => { img.classList.add('loaded'); queueNextLoad(); });
    img.addEventListener('error', () => {
      if (img.dataset.fallback !== '1' && post.large_file_url) {
        img.dataset.fallback = '1';
        img.src = imageSrc(post.large_file_url);
      }
    });
    const badge = document.createElement('span');
    badge.className = `badge rating-${post.rating || 's'}`;
    badge.title = `${ratingNames[post.rating] || post.rating || '未知'} · ${post.image_width || '?'}×${post.image_height || '?'}`;
    const favoriteButton = document.createElement('button');
    favoriteButton.className = 'favorite-button';
    favoriteButton.dataset.favoriteId = post.id;
    favoriteButton.textContent = isFavorite(post.id) ? '♥' : '♡';
    favoriteButton.classList.toggle('active', isFavorite(post.id));
    favoriteButton.title = isFavorite(post.id) ? '取消收藏' : '加入本地收藏';
    favoriteButton.setAttribute('aria-label', favoriteButton.title);
    favoriteButton.onclick = event => {
      event.stopPropagation();
      toggleFavorite(post);
    };
    let completedButton = null;
    if (mode === 'favorites' && favoriteFolder === 'original') {
      const ai = document.createElement('button');
      ai.className = 'ai-button'; ai.textContent = 'AI'; ai.title = '移到待反推';
      ai.onclick = event => { event.stopPropagation(); moveFavorite(post, 'pending'); };
      card.append(ai);
      completedButton = document.createElement('button');
      completedButton.className = 'completed-button';
      completedButton.dataset.completedId = post.id;
      completedButton.onclick = event => { event.stopPropagation(); toggleCompleted(post); };
      updateCompletedButtons(post.id);
    }
    card.append(img, badge, favoriteButton);
    if (completedButton) {
      const done = Boolean(readFavorites().find(item => String(item.id) === String(post.id))?.completed);
      completedButton.textContent = done ? '✓' : '○';
      completedButton.classList.toggle('active', done);
      completedButton.title = done ? '标记为未使用' : '标记为已使用';
      completedButton.setAttribute('aria-label', completedButton.title);
      card.append(completedButton);
    }
    card.oncontextmenu = event => showMenu(event, post);
    card.addEventListener('click', () => openLightbox(post, card));
    const ratio = (post.image_height || 1) / (post.image_width || 1);
    const index = state.heights.indexOf(Math.min(...state.heights));
    state.columns[index].append(card);
    state.heights[index] += ratio + .03;
  }
}
function renderReverseCard(post) {
  const pending = favoriteFolder === 'pending';
  const card = document.createElement('article');
  card.className = `reverse-card ${post.image_width > post.image_height ? 'landscape' : 'portrait'} ${pending && post.cacheStatus !== 'ready' ? 'uncached' : ''}`;
  card.dataset.reverseId = post.id;
  const image = document.createElement('img');
  image.loading = 'lazy'; image.alt = `Danbooru #${post.id}`;
  image.src = post.cacheStatus === 'ready' ? `/api/reverse/image/${post.id}` : imageSrc(post.preview_file_url || post.large_file_url);
  image.onerror = () => {
    if (post.cacheStatus === 'ready' && image.dataset.fallback !== '1') {
      image.dataset.fallback = '1'; card.classList.add('uncached'); image.src = imageSrc(post.preview_file_url);
    }
  };
  image.onclick = () => openLightbox(post, card, post.cacheStatus === 'ready' ? `/api/reverse/image/${post.id}` : image.src);
  const picture = document.createElement('div'); picture.className = 'reverse-picture'; picture.append(image);
  const width = Math.max(1, Number(post.image_width) || 1);
  const height = Math.max(1, Number(post.image_height) || 1);
  // A square card reserves room for controls; near-square images may be cropped a little, never stretched.
  const imageShare = pending ? (width > height ? 62 : 55) : 60;
  if (width > height) picture.style.height = `${Math.min(imageShare, height / width * 100)}%`;
  else picture.style.width = `${Math.min(imageShare, width / height * 100)}%`;
  const panel = document.createElement('div'); panel.className = 'reverse-panel';
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy-prompt'; copy.textContent = '复制提示词';
  copy.disabled = !post.prompt;
  if (!pending && !post.prompt) copy.hidden = true;
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(post.prompt); toast('已复制提示词'); }
    catch (error) { toast(`复制失败：${error.message}`); }
  };
  if (pending) {
    card.classList.add('pending-card');
    const status = document.createElement('div'); status.className = 'reverse-status';
    const failed = post.reverseStatus === 'failed' || post.cacheStatus === 'error';
    const done = Boolean(post.prompt) && !failed;
    const lamp = document.createElement('span'); lamp.className = `reverse-lamp ${failed ? 'red' : done ? 'green' : ''}`;
    const label = document.createElement('span'); label.textContent = failed ? '错误' : done ? '完成' : '等待';
    status.title = post.cacheStatus === 'error' ? `缓存错误：${post.cacheError || '点击重试'}` :
      post.reverseStatus === 'failed' ? `反推错误：${post.reverseError || '点击重试'}` :
      post.cacheStatus !== 'ready' ? '等待高清图缓存' : post.reverseStatus === 'processing' ? '正在反推' : label.textContent;
    if (failed) {
      status.classList.add('retryable'); status.setAttribute('role','button'); status.tabIndex = 0;
      status.setAttribute('aria-label', `${status.title}，点击重试`);
      const retry = async () => {
        try { await patchFavorite(post.id, post.cacheStatus === 'error' ? {retryCache:true} : {retryReverse:true}); refreshFavoriteGallery(true); }
        catch(error) { toast(`重试失败：${error.message}`); }
      };
      status.onclick = retry;
      status.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); retry(); } };
    }
    status.append(lamp,label);
    const queue = document.createElement('div'); queue.className = 'reverse-queue';
    const queueLabel = document.createElement('span'); queueLabel.textContent = '反推队列';
    const queueButton = document.createElement('button'); queueButton.type = 'button'; queueButton.className = `queue-button ${post.autoEnabled !== false ? 'active' : ''}`;
    queueButton.textContent = post.autoEnabled !== false ? String(post.queueOrder || '·') : '+';
    queueButton.setAttribute('aria-pressed', String(post.autoEnabled !== false));
    queueButton.title = post.autoEnabled !== false ? `队列第 ${post.queueOrder || '?'} 位，点击移出` : '点击加入反推队列';
    queueButton.setAttribute('aria-label', queueButton.title);
    queueButton.onclick = async () => {
      queueButton.disabled = true;
      try { await patchFavorite(post.id, {autoEnabled:post.autoEnabled === false}); refreshFavoriteGallery(true); }
      catch(error) { queueButton.disabled = false; toast(`更新队列失败：${error.message}`); }
    };
    queue.append(queueLabel,queueButton);
    const release = document.createElement('button'); release.type = 'button'; release.className = 'release-button'; release.textContent = '释放';
    release.disabled = !post.prompt || post.cacheStatus !== 'ready';
    release.title = release.disabled ? '需先完成反推和高清缓存' : '释放到已完成';
    release.onclick = () => moveFavorite(post,'completed');
    const picker = document.createElement('select'); picker.className = 'preset-picker'; picker.title = '反推预设';
    picker.setAttribute('aria-label','反推预设');
    for (const preset of reversePresets) {
      const option = document.createElement('option'); option.value = preset; option.textContent = preset;
      picker.append(option);
    }
    picker.value = post.preset || '动漫专用';
    picker.onchange = async () => {
      try { await patchFavorite(post.id,{preset:picker.value}); }
      catch(error) { picker.value = post.preset || '动漫专用'; toast(`预设保存失败：${error.message}`); }
    };
    const actions = document.createElement('div'); actions.className = 'reverse-actions';
    actions.append(status,queue,release);
    panel.append(copy,actions,picker);
  } else {
    panel.append(copy);
    if (post.prompt) {
      const view = document.createElement('button'); view.type = 'button'; view.className = 'view-prompt';
      view.textContent = '查看提示词'; view.onclick = () => showPromptDialog(post.prompt);
      panel.append(view);
    }
  }
  card.append(picture,panel);
  const favoriteButton = document.createElement('button');
  favoriteButton.type = 'button'; favoriteButton.className = 'favorite-button active';
  favoriteButton.dataset.favoriteId = post.id; favoriteButton.textContent = '♥';
  favoriteButton.title = '取消本地收藏'; favoriteButton.setAttribute('aria-label', favoriteButton.title);
  favoriteButton.onclick = event => { event.stopPropagation(); toggleFavorite(post); };
  const aiButton = document.createElement('button');
  aiButton.type = 'button'; aiButton.className = 'ai-button'; aiButton.textContent = 'AI';
  aiButton.title = pending ? '移回原始收藏' : '移回待反推';
  aiButton.setAttribute('aria-label', aiButton.title);
  aiButton.onclick = event => { event.stopPropagation(); moveFavorite(post, pending ? 'original' : 'pending'); };
  const completedButton = document.createElement('button');
  completedButton.type = 'button'; completedButton.className = `completed-button ${pending ? '' : 'active'}`;
  completedButton.textContent = pending ? '○' : '✓';
  completedButton.title = pending ? '释放到已完成（需先生成提示词）' : '取消完成，移回原始收藏';
  completedButton.setAttribute('aria-label', completedButton.title);
  completedButton.disabled = pending && (!post.prompt || post.cacheStatus !== 'ready');
  completedButton.onclick = event => { event.stopPropagation(); moveFavorite(post, pending ? 'completed' : 'original'); };
  picture.append(favoriteButton, aiButton, completedButton);
  const index = state.heights.indexOf(Math.min(...state.heights));
  state.columns[index].append(card); state.heights[index] += 1;
}
function showPromptDialog(prompt) {
  let dialog = document.querySelector('#promptDialog');
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'promptDialog'; dialog.className = 'prompt-dialog';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭';
    close.onclick = () => dialog.close();
    const text = document.createElement('pre'); text.className = 'prompt-dialog-text';
    dialog.append(close,text); document.body.append(dialog);
    dialog.onclick = event => { if (event.target === dialog) dialog.close(); };
  }
  dialog.querySelector('.prompt-dialog-text').textContent = prompt;
  dialog.showModal();
}
function openLightbox(post, card, imageUrl = '') {
  previewPost = post;
  previewCard = card;
  lightboxImage.src = imageUrl || imageSrc(hiRes(post));
  lightbox.classList.remove('hidden');
  lightbox.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => placeLightbox(card, post));
}
function placeLightbox(card, post) {
  const vw = innerWidth, vh = innerHeight, rect = card?.getBoundingClientRect();
  const portrait = (post.image_height || 1) / (post.image_width || 1);
  const targetArea = vw * vh * .24, minW = 260, maxW = Math.min(vw * .56, 760), minH = 180, maxH = vh * .78;
  let width = Math.sqrt(targetArea / Math.max(.35, portrait));
  width = Math.max(minW, Math.min(maxW, width));
  let height = width * portrait;
  if (height > maxH) { height = maxH; width = height / portrait; }
  if (width > maxW) { width = maxW; height = width * portrait; }
  if (height < minH) { height = minH; width = height / portrait; }
  width = Math.min(width, vw - 20); height = Math.min(height, vh - 20);
  let left = rect ? rect.right + 14 : (vw - width) / 2;
  if (left + width > vw - 10) left = rect ? rect.left - width - 14 : 10;
  if (left < 10) left = Math.max(10, (vw - width) / 2);
  let top = rect ? rect.top : (vh - height) / 2;
  top = Math.max(10, Math.min(top, vh - height - 10));
  lightbox.style.setProperty('--panel-width', `${Math.round(width)}px`);
  lightbox.style.setProperty('--panel-height', `${Math.round(height)}px`);
  lightbox.style.setProperty('--panel-left', `${Math.round(left)}px`);
  lightbox.style.setProperty('--panel-top', `${Math.round(top)}px`);
}
function closeLightbox() {
  lightbox.classList.add('hidden');
  lightbox.setAttribute('aria-hidden', 'true');
  lightboxImage.removeAttribute('src');
  previewCard = null;
}
lightbox.addEventListener('click', event => {
  if (event.target === lightbox || event.target.id === 'lightboxClose') closeLightbox();
});
let resizeGalleryTimer = 0;
window.addEventListener('resize', () => {
  if (!lightbox.classList.contains('hidden') && previewPost) placeLightbox(previewCard, previewPost);
  if (mode === 'favorites' && ['pending','metadata'].includes(favoriteFolder)) {
    clearTimeout(resizeGalleryTimer);
    resizeGalleryTimer = setTimeout(() => refreshFavoriteGallery(true), 150);
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeLightbox();
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !event.target.closest('input, textarea, [contenteditable="true"]')) {
    event.preventDefault();
    undoLastAction();
  }
});
function showMenu(event, post) {
  event.preventDefault();
  activePost = post;
  menu.querySelector('[data-action="favorite"]').textContent = isFavorite(post.id) ? '取消本地收藏' : '加入本地收藏';
  menu.classList.remove('hidden');
  menu.style.left = `${Math.min(event.clientX, innerWidth - 205)}px`;
  menu.style.top = `${Math.min(event.clientY, innerHeight - 190)}px`;
}
function hiRes(post) { return post.file_url || post.large_file_url || post.preview_file_url; }
async function blobAsPng(blob) {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('图片转换失败')), 'image/png'));
  } finally { bitmap.close(); }
}
async function copyImage(post) {
  toast('正在准备高清图片…');
  const urls = [...new Set([post.large_file_url, post.file_url, post.preview_file_url].filter(Boolean))];
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetch(`/api/image?url=${encodeURIComponent(url)}`);
      if (!response.ok) throw Error(`图片下载失败 (${response.status})`);
      const png = await blobAsPng(await response.blob());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('已复制高清图片');
      return;
    } catch (error) { lastError = error; }
  }
  throw lastError || Error('没有可复制的图片');
}
menu.onclick = async event => {
  const action = event.target.dataset.action;
  if (!action || !activePost) return;
  menu.classList.add('hidden');
  try {
    if (action === 'favorite') await toggleFavorite(activePost);
    if (action === 'copy') await copyImage(activePost);
    if (action === 'url') { await navigator.clipboard.writeText(hiRes(activePost)); toast('已复制高清图地址'); }
    if (action === 'open') open(`/api/image?url=${encodeURIComponent(hiRes(activePost))}`, '_blank', 'noopener');
  } catch (error) {
    if (action === 'copy') toast(`复制图片失败：${error.message || '浏览器拒绝剪贴板权限'}`);
    else {
      try { await navigator.clipboard.writeText(hiRes(activePost)); toast('已复制高清图地址'); }
      catch { toast('操作失败'); }
    }
  }
};
function toast(text) {
  const element = document.querySelector('#toast');
  element.textContent = text;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2200);
}
function activateButton(button) {
  document.querySelectorAll('.mode.active').forEach(item => item.classList.remove('active'));
  button?.classList.add('active');
}
function viewKey(modeName = mode) {
  return [
    modeName,
    ratingChecks().slice().sort().join(','),
    normalizeSearchTags(manualSearchTags),
    [...selectedPopularTags].sort().join(','),
    columnCount(),
    modeName === 'favorites' ? favoriteFolder : ''
  ].join('|');
}
function saveCurrentView() {
  if (!currentPosts.length) return;
  viewCache.set(viewKey(), {
    posts: currentPosts.slice(), cursor, pageNo, ended, loadFailed,
    status: statusEl.textContent, scrollY: window.scrollY
  });
  while (viewCache.size > 30) viewCache.delete(viewCache.keys().next().value);
}
function restoreView(modeName) {
  const cached = viewCache.get(viewKey(modeName));
  if (!cached) return false;
  clearTimeout(nextLoadTimer);
  requestController?.abort();
  requestController = null;
  generation++;
  loading = false;
  pendingRatingResults.clear();
  cursor = cached.cursor;
  pageNo = cached.pageNo;
  ended = cached.ended;
  loadFailed = cached.loadFailed;
  currentPosts = cached.posts.slice();
  resetColumns();
  render(currentPosts);
  statusEl.textContent = cached.status;
  sentinel.classList.toggle('done', ended);
  sentinel.classList.remove('loading');
  requestAnimationFrame(() => {
    scrollTo({ top: cached.scrollY });
    if (!ended) queueNextLoad();
  });
  return true;
}
function selectMode(nextMode, button) {
  if (nextMode === mode) return;
  saveCurrentView();
  mode = nextMode;
  activateButton(button || document.querySelector(`[data-mode="${nextMode}"]`));
  document.querySelector('#favoriteFolders')?.classList.toggle('hidden', nextMode !== 'favorites');
  schedulePreferenceSave();
  if (nextMode === 'favorites' && favoriteFolder === 'metadata') load(true);
  else if (!restoreView(nextMode)) load(true);
}
document.querySelectorAll('.mode[data-mode]').forEach(button => button.onclick = () => selectMode(button.dataset.mode, button));
document.querySelectorAll('.rating-menu input').forEach(input => input.onchange = () => {
  if (!ratingChecks().length) { input.checked = true; toast('至少保留一个分级'); }
  updateRatingLabel();
  schedulePreferenceSave();
  load(true);
});
document.querySelector('#allRatings').onclick = () => {
  document.querySelectorAll('.rating-menu input').forEach(input => input.checked = true);
  updateRatingLabel(); schedulePreferenceSave(); load(true);
};
function updateRatingLabel() {
  const count = ratingChecks().length;
  document.querySelector('#ratingButton').textContent = (count === 4 ? '分级' : `分级 ${count}/4`) + '⌄';
}
document.querySelector('#ratingButton').onclick = () => document.querySelector('#ratingPicker').classList.toggle('open');
const columnPicker = document.querySelector('#columnPicker');
document.querySelector('#columnButton').onclick = () => {
  columnPicker.classList.toggle('open');
  document.querySelector('#columnButton').setAttribute('aria-expanded', columnPicker.classList.contains('open'));
};
document.querySelectorAll('#favoriteFolders [data-folder]').forEach(button => button.onclick = () => {
  if (favoriteFolder === button.dataset.folder) return;
  if (mode === 'favorites') saveCurrentView();
  favoriteFolder = button.dataset.folder;
  document.querySelectorAll('#favoriteFolders [data-folder]').forEach(item => item.classList.toggle('active', item === button));
  if (mode === 'favorites' && favoriteFolder === 'metadata') { load(true); return; }
  if (mode === 'favorites' && !restoreView('favorites')) refreshFavoriteGallery(false);
});
document.querySelector('#searchBtn').onclick = () => { manualSearchTags = normalizeSearchTags(searchInput.value); searchInput.value = manualSearchTags; schedulePreferenceSave(); load(true); };
searchInput.onkeydown = event => { if (event.key === 'Enter') document.querySelector('#searchBtn').click(); };
document.querySelector('#clearBtn').onclick = () => {
  searchInput.value = '';
  manualSearchTags = '';
  selectedPopularTags.clear();
  drawTags();
  updateSelectedTagCount();
  schedulePreferenceSave();
  load(true);
};
document.querySelector('#refresh').onclick = () => { viewCache.delete(viewKey()); load(true); };
document.addEventListener('click', event => {
  if (!menu.contains(event.target)) menu.classList.add('hidden');
  if (!event.target.closest('.rating-picker')) document.querySelector('#ratingPicker')?.classList.remove('open');
  if (!event.target.closest('.column-picker')) document.querySelector('#columnPicker')?.classList.remove('open');
});
document.querySelector('#tagToggle').onclick = () => document.querySelector('#tagbar').classList.toggle('collapsed');
document.addEventListener('wheel', event => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const current = forcedCols || columnCount();
  setColumns(event.deltaY > 0 ? current - 1 : current + 1);
}, { passive: false });

document.querySelector('#testSettings').onclick = async () => {
  const name = document.querySelector('#loginName').value.trim();
  const key = document.querySelector('#loginKey').value.trim();
  const status = document.querySelector('#loginStatus');
  if (!name || !key) { status.textContent = '✕ 请同时填写账户名称和 API Key'; return; }
  status.textContent = '正在测试…';
  try {
    const response = await fetch('/api/auth-test', { headers: { 'X-Danbooru-Username': name, 'X-Danbooru-Key': key } });
    const detail = await response.json().catch(() => ({}));
    status.textContent = detail.ok ? `✓ ${detail.message}` : `✕ ${detail.message || detail.error || `HTTP ${response.status}`}`;
  } catch { status.textContent = '✕ 无法连接测试服务'; }
};
document.querySelector('#settings').onclick = () => {
  const dialog = document.querySelector('#settingsDialog');
  document.querySelector('#loginName').value = localStorage.loginName || '';
  document.querySelector('#loginKey').value = localStorage.loginKey || '';
  dialog.showModal();
};
document.querySelector('#closeSettings').onclick = () => document.querySelector('#settingsDialog').close();
document.querySelector('#saveSettings').onclick = async () => {
  localStorage.loginName = document.querySelector('#loginName').value.trim();
  localStorage.loginKey = document.querySelector('#loginKey').value.trim();
  try {
    const response = await fetch('/api/account', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: localStorage.loginName, loginKey: localStorage.loginKey })
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const result = await response.json();
    sharedUpdatedAt = result.updatedAt || sharedUpdatedAt;
    toast('账号已保存并可在局域网设备共用');
  } catch (error) {
    toast(`账号仅保存在当前设备：${error.message}`);
  }
  document.querySelector('#settingsDialog').close();
  loadPopularTags(true);
  load(true);
};

function updateSelectedTagCount() {
  const count = selectedPopularTags.size;
  document.querySelector('#selectedTagCount').textContent = count ? `已选 ${count} 个` : '未选择';
  document.querySelector('#clearTags').disabled = count === 0;
}
function drawTags() {
  const tags = popularTags.length ? popularTags : fallbackTags.map(([nameZh, name]) => ({ name, nameZh }));
  const box = document.querySelector('#tags');
  box.innerHTML = '';
  for (const tag of tags) {
    const button = document.createElement('button');
    button.className = 'tag';
    button.dataset.tag = tag.name;
    button.classList.toggle('selected', selectedPopularTags.has(tag.name));
    button.setAttribute('aria-pressed', selectedPopularTags.has(tag.name) ? 'true' : 'false');
    const label = tag.nameZh || zhByTag.get(tag.name) || tag.name;
    button.innerHTML = `<span>${escapeHtml(label)}</span>${label === tag.name ? '' : `<small>${escapeHtml(tag.name)}</small>`}${tag.post_count ? `<em>${formatCount(tag.post_count)}</em>` : ''}`;
    button.onclick = () => {
      if (selectedPopularTags.has(tag.name)) selectedPopularTags.delete(tag.name);
      else selectedPopularTags.add(tag.name);
      drawTags();
      updateSelectedTagCount();
      schedulePreferenceSave();
      load(true);
    };
    box.append(button);
  }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function formatCount(value) {
  const number = Number(value) || 0;
  return number >= 1000000 ? `${(number / 1000000).toFixed(1)}m` : number >= 1000 ? `${Math.round(number / 1000)}k` : String(number);
}
async function loadPopularTags(force = false) {
  const button = document.querySelector('#refreshTags');
  button.disabled = true;
  button.textContent = '拉取中…';
  try {
    const response = await fetch(`/api/tags?limit=100${force ? `&_=${Date.now()}` : ''}`, { headers: authHeaders() });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const values = await response.json();
    popularTags = values.filter(item => item?.name && !item.is_deprecated).map(item => ({ ...item, nameZh: zhByTag.get(item.name) || '' }));
    if (!popularTags.length) throw Error('热门标签为空');
    drawTags();
    toast(`已拉取 ${popularTags.length} 个热门标签`);
  } catch (error) {
    popularTags = fallbackTags.map(([nameZh, name]) => ({ name, nameZh }));
    drawTags();
    if (force) toast(`拉取失败，已使用内置标签：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = '重新拉取';
  }
}
document.querySelector('#clearTags').onclick = () => {
  selectedPopularTags.clear();
  drawTags(); updateSelectedTagCount(); schedulePreferenceSave(); load(true);
};
document.querySelector('#refreshTags').onclick = () => loadPopularTags(true);

function currentPreferences() {
  return {
    mode, columns: columnCount(), ratings: ratingChecks(), search: manualSearchTags,
    selectedTags: [...selectedPopularTags]
  };
}
function schedulePreferenceSave() {
  if (restoringSharedState) return;
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = setTimeout(async () => {
    const preferences = currentPreferences();
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences)
      });
      if (response.ok) {
        const result = await response.json();
        sharedUpdatedAt = result.updatedAt || sharedUpdatedAt;
      }
    } catch {}
  }, 250);
}
function applyPreferences(preferences = {}) {
  const validModes = new Set([...document.querySelectorAll('.mode[data-mode]')].map(button => button.dataset.mode));
  mode = validModes.has(preferences.mode) ? preferences.mode : 'latest';
  forcedCols = Math.max(3, Math.min(8, Number(preferences.columns) || 5));
  document.documentElement.style.setProperty('--cols', forcedCols);
  const ratings = Array.isArray(preferences.ratings) && preferences.ratings.length ? new Set(preferences.ratings) : new Set(['g', 's', 'q', 'e']);
  document.querySelectorAll('.rating-menu input').forEach(input => { input.checked = ratings.has(input.value); });
  manualSearchTags = normalizeSearchTags(preferences.search);
  searchInput.value = manualSearchTags;
  selectedPopularTags.clear();
  if (Array.isArray(preferences.selectedTags)) preferences.selectedTags.forEach(tag => selectedPopularTags.add(String(tag)));
  activateButton(document.querySelector(`[data-mode="${mode}"]`));
  document.querySelector('#favoriteFolders')?.classList.toggle('hidden', mode !== 'favorites');
}
async function initializeSharedState() {
  const localFavorites = readLocalFavorites();
  let localPreferences = {};
  try { localPreferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}'); } catch {}
  favoriteCache = localFavorites;
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const remote = await response.json();
    sharedUpdatedAt = remote.updatedAt || '';
    if (Array.isArray(remote.favorites) && remote.favorites.length) {
      favoriteCache = remote.favorites;
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteCache));
    } else if (localFavorites.length) {
      await saveFavorites(localFavorites);
    }
    if (remote.account?.loginName && remote.account?.loginKey) {
      localStorage.loginName = remote.account.loginName;
      localStorage.loginKey = remote.account.loginKey;
    } else if (localStorage.loginName && localStorage.loginKey) {
      await fetch('/api/account', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginName: localStorage.loginName, loginKey: localStorage.loginKey })
      });
    }
    applyPreferences(remote.updatedAt ? remote.preferences : localPreferences);
  } catch {
    applyPreferences(localPreferences);
  }
  restoringSharedState = false;
  updateFavoriteCount();
  updateSelectedTagCount();
  updateRatingLabel();
  renderColumnOptions();
  resetColumns();
  await loadPopularTags();
  load();
}
async function pullSharedFavorites() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) return;
    const remote = await response.json();
    if (!remote.updatedAt || remote.updatedAt === sharedUpdatedAt) return;
    sharedUpdatedAt = remote.updatedAt;
    if (Array.isArray(remote.favorites)) {
      const changed = JSON.stringify(remote.favorites) !== JSON.stringify(favoriteCache);
      favoriteCache = remote.favorites;
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteCache));
      updateFavoriteCount();
      document.querySelectorAll('[data-favorite-id]').forEach(button => updateFavoriteButtons(button.dataset.favoriteId));
      if (changed && mode === 'favorites') refreshFavoriteGallery(true);
    }
    if (remote.account?.loginName && remote.account?.loginKey) {
      localStorage.loginName = remote.account.loginName;
      localStorage.loginKey = remote.account.loginKey;
    }
  } catch {}
}
sentinel.onclick = () => {
  if (loadFailed) {
    // 只重试失败的当前页：保留已经显示的图片、翻页游标和滚动位置。
    loadFailed = false;
    ended = false;
    sentinel.classList.remove('done');
    load();
  } else {
    load();
  }
};
new IntersectionObserver(entries => entries[0].isIntersecting && queueNextLoad(), { rootMargin: '1200px' }).observe(sentinel);
if (window.ResizeObserver) new ResizeObserver(() => queueNextLoad()).observe(gallery);
addEventListener('scroll', queueNextLoad, { passive: true });
initializeSharedState();
setInterval(pullSharedFavorites, 10000);




// Imported ComfyUI PNGs are stored separately from Danbooru favorites.
async function loadMetadataGallery() {
  if (mode !== 'favorites' || favoriteFolder !== 'metadata') return;
  const upload = document.querySelector('#metadataUpload');
  upload.hidden = false;
  try {
    const res = await fetch('/api/metadata/images');
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const items = await res.json();
    if (mode !== 'favorites' || favoriteFolder !== 'metadata') return;
    resetColumns();
    gallery.classList.add('reverse-gallery');
    for (const item of items) renderMetadataCard(item);
    statusEl.textContent = items.length ? `已识别 ${items.length} 张元数据图片` : '上传带 ComfyUI 元数据的 PNG 图片';
  } catch (error) { statusEl.textContent = `读取元数据失败：${error.message}`; }
  ended = true; sentinel.classList.remove('loading'); sentinel.classList.add('done');
}
function renderMetadataCard(item) {
  const card = document.createElement('article');
  card.className = `reverse-card metadata-card ${item.width > item.height ? 'landscape' : 'portrait'}`;
  const picture = document.createElement('div'); picture.className = 'reverse-picture';
  const img = document.createElement('img'); img.loading = 'lazy'; img.alt = item.name; img.src = `/api/metadata/images/${encodeURIComponent(item.id)}`;
  img.onclick = () => openLightbox({image_width:item.width,image_height:item.height},card,img.src);
  picture.append(img);
  if (item.width > item.height) picture.style.height = `${Math.min(58,item.height/item.width*100)}%`;
  else picture.style.width = `${Math.min(58,item.width/item.height*100)}%`;
  const panel = document.createElement('div'); panel.className = 'reverse-panel';
  const line = (title,value) => { const el = document.createElement('div'); el.className='metadata-line'; const strong=document.createElement('strong'); strong.textContent=title+'：'; const span=document.createElement('span');span.textContent=value || '未识别';el.title=value || '未识别';el.append(strong,span);panel.append(el); };
  line('底模',item.model); line('参数',[item.positive && `正向：${item.positive}`,item.negative && `反向：${item.negative}`].filter(Boolean).join(' / ') || item.source);
  const details=document.createElement('details'); details.className='metadata-loras';
  const summary=document.createElement('summary'); summary.textContent=`LoRA（${item.loras?.length || 0}）`; details.append(summary);
  for(const lora of item.loras || []) { const el=document.createElement('div'); el.textContent=`${lora.name}${lora.strength == null ? '' : ' · '+lora.strength}`; details.append(el); }
  if(!item.loras?.length) { const el=document.createElement('div');el.textContent='未识别';details.append(el); }
  panel.append(details);
  line('生图参数',[['CFG',item.cfg],['步数',item.steps],['采样器',item.sampler],['调度器',item.scheduler],['种子',item.seed],['降噪',item.denoise]].map(([k,v])=>`${k} ${v || '—'}`).join(' · '));
  const actions=document.createElement('div');actions.className='metadata-actions';
  const copy=document.createElement('button');copy.textContent='复制提示词';copy.disabled=!item.positive; copy.onclick=async()=>{try{await navigator.clipboard.writeText(item.positive);toast('已复制提示词');}catch(e){toast('复制失败：'+e.message)}};actions.append(copy);
  if(item.positive){const view=document.createElement('button');view.textContent='查看提示词';view.onclick=()=>showPromptDialog(item.positive);actions.append(view);}
  const remove=document.createElement('button');remove.textContent='删除';remove.onclick=async()=>{if(!confirm('删除此元数据图片及本地缓存？'))return;const res=await fetch(`/api/metadata/images/${encodeURIComponent(item.id)}`,{method:'DELETE'});if(res.ok)loadMetadataGallery();else toast('删除失败');};actions.append(remove);panel.append(actions);
  card.append(picture,panel);const index=state.heights.indexOf(Math.min(...state.heights));state.columns[index].append(card);state.heights[index]+=1;
}
document.querySelector('#metadataFiles').onchange=async event=>{
  const files=[...event.target.files]; let success=0;
  for(const file of files){try{const res=await fetch(`/api/metadata/images?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':'image/png'},body:file});const body=await res.json();if(!res.ok)throw Error(body.error || `HTTP ${res.status}`);success++;}catch(e){toast(`${file.name}：${e.message}`)}}
  event.target.value='';if(success) {toast(`已导入 ${success} 张图片`);loadMetadataGallery();}
};
document.querySelectorAll('#favoriteFolders [data-folder]').forEach(button=>button.addEventListener('click',()=>{document.querySelector('#metadataUpload').hidden=button.dataset.folder!=='metadata'}));
document.querySelectorAll('.mode').forEach(button=>button.addEventListener('click',()=>{document.querySelector('#metadataUpload').hidden=mode!=='favorites'||favoriteFolder!=='metadata'}));
