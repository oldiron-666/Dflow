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
let presetConfig = { reverse:[{name:'通用反推'}], expansion:[{name:'通用扩写'}], defaultReverse:'通用反推', defaultExpansion:'通用扩写' };
const expansionNames = () => [...presetConfig.expansion.map(item => item.name), '随机'];
const folderName = {original:'原始收藏', pending:'待反推', worded:'有词区', completed:'已完成', metadata:'元数据库'};
const postFolder = post => post.folder || (post.completed ? 'completed' : 'original');
const state = { columns: [], heights: [], ordered: false };
const selectedPopularTags = new Set();

const HEART_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
const HEART_OUTLINE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
const RELEASE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="18" y2="12"></line><polyline points="12 6 18 12 12 18"></polyline></svg>';

const pixivModeMap = {
  'pixiv-daily': 'daily',
  'pixiv-weekly': 'weekly',
  'pixiv-monthly': 'monthly',
  'pixiv-ai': 'daily_ai',
  'pixiv-r18': 'daily_r18'
};

let station = localStorage.getItem('dflow_station') || 'dflow';
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
  state.ordered = mode === 'favorites' && (favoriteFolder === 'worded' || favoriteFolder === 'completed');
  gallery.classList.toggle('ordered-gallery', state.ordered);
  const count = mode === 'favorites' && favoriteFolder === 'pending'
    ? Math.min(columnCount(), innerWidth <= 760 ? 1 : innerWidth <= 1100 ? 2 : 4)
    : (mode === 'favorites' && (favoriteFolder === 'worded' || favoriteFolder === 'completed')) || mode === 'metadata'
      ? Math.min(columnCount(), innerWidth <= 760 ? 1 : innerWidth <= 1100 ? 3 : 5)
      : columnCount();
  gallery.style.setProperty('--gallery-cols', count);
  if (state.ordered) {
    const styles = getComputedStyle(gallery);
    const horizontalPadding = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    const gap = parseFloat(styles.columnGap || styles.gap) || 8;
    const contentWidth = Math.max(1, gallery.clientWidth - horizontalPadding);
    const cardSize = Math.max(1, (contentWidth - gap * (count - 1)) / count);
    gallery.style.setProperty('--ordered-card-size', cardSize + 'px');
    return;
  }
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
function isPixivMode(value = mode) {
  return ['pixiv-daily', 'pixiv-weekly', 'pixiv-monthly', 'pixiv-ai', 'pixiv-r18'].includes(value);
}
function isPopularMode(value = mode) {
  return value.startsWith('popular-');
}
function isPagedMode(value = mode) {
  return isPixivMode(value) || (value !== 'latest' && value !== 'viewed' && value !== 'favorites' && value !== 'metadata');
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
    if (response.ok) {
      const posts = await response.json();
      if (!Array.isArray(posts)) throw Error('图片接口返回格式错误：预期图片列表');
      if (url.startsWith('/api/pixiv/ranking') && response.headers.get('X-Pixiv-Has-More') === 'false') {
        Object.defineProperty(posts, 'hasNextPage', {value:false});
      }
      return posts;
    }
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
  if (station === 'pflow' && !['favorites', 'metadata'].includes(mode)) {
    if (manualSearchTags) {
      const p = page || 1;
      return requestPosts(`/api/pixiv/search?word=${encodeURIComponent(manualSearchTags)}&page=${p}`, signal);
    }
    const pixMode = pixivModeMap[mode] || 'daily';
    const p = page || 1;
    return requestPosts(`/api/pixiv/ranking?mode=${encodeURIComponent(pixMode)}&page=${p}`, signal);
  }
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
    folder: postFolder(post), preset: post.preset || presetConfig.defaultExpansion, reversePreset:post.reversePreset || presetConfig.defaultReverse, autoEnabled: post.autoEnabled !== false,
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
  const worded = document.querySelector('#wordedCount');
  if (worded) worded.textContent = items.filter(item => postFolder(item) === 'worded').length;
}
function updateFavoriteButtons(id) {
  const active = isFavorite(id);
  document.querySelectorAll(`[data-favorite-id="${CSS.escape(String(id))}"]`).forEach(button => {
    button.innerHTML = active ? HEART_SVG : HEART_OUTLINE_SVG;
    button.classList.toggle('active', active);
    button.title = active ? '取消收藏' : '加入本地收藏';
    button.setAttribute('aria-label', button.title);
  });
}
function favoriteVisibleItems() {
  return readFavorites()
    .filter(item => postFolder(item) === favoriteFolder)
    .filter(favoriteMatches)
    .sort((a,b) => favoriteFolder === 'pending'
      ? Number(a.autoEnabled === false) - Number(b.autoEnabled === false) ||
        ((a.queueOrder || 999999) - (b.queueOrder || 999999))
      : (Number((b.image_width || 0) > (b.image_height || 0)) - Number((a.image_width || 0) > (a.image_height || 0))) ||
        ((Date.parse(b.completedAt || b.wordedAt || b.created_at || '') || 0) - (Date.parse(a.completedAt || a.wordedAt || a.created_at || '') || 0)));
}
function refreshFavoriteGallery(preserveScroll = true) {
  if (mode !== 'favorites') return;
  if (['worded','pending','completed'].includes(favoriteFolder)) { loadWordedGallery(preserveScroll); return; }
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
    button.innerHTML = RELEASE_SVG;
    button.classList.toggle('active', done);
    button.title = done ? '移回原始收藏' : '释放至已完成';
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
  document.querySelector('#metadataUpload').hidden = mode !== 'metadata';
  if (mode === 'metadata') { await loadMetadataGallery(); return; }
  if (mode === 'favorites' && ['worded','pending','completed'].includes(favoriteFolder)) { await loadWordedGallery(); return; }
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
    if (station !== 'pflow' && !ratings.length) throw Error('请至少选择一个分级');
    // 每个已勾选分级都取完整一批。之前把 36 按分级数量平分，
    // 全选四级时每级只取 12 张，导致榜单一次只出现很少图片。
    const perRatingLimit = 36;
    let results;
    if (station === 'pflow' && !['favorites', 'metadata'].includes(mode)) {
      results = [await getPosts('', pageNo, perRatingLimit, controller.signal)];
    } else if (mode === 'viewed') {
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
    const receivedCount = results.flat().length;
    const seen = new Set();
    let posts = results.flat().filter(post => post?.id && !seen.has(post.id) && seen.add(post.id));
    // API 的 tags 过滤偶尔会返回混合分级（尤其是榜单/缓存结果），
    // 前端再做一次硬过滤，避免取消勾选后仍出现其它颜色的分级圆点。
    // PFlow 榜单（尤其 R18）已经按 Pixiv 自身的榜单分类筛选。
    // Danbooru 的 g/s/q/e 选择不可再用于过滤 PFlow，否则 s/q 或仅 g 会把整个榜单清空。
    if (station !== 'pflow') {
      const selectedRatings = new Set(ratings);
      posts = posts.filter(post => selectedRatings.has(post.rating || 'g'));
    }
    if (mode === 'viewed') posts = posts.filter(favoriteMatches);
    posts = posts.filter(post => post.preview_file_url || post.large_file_url || post.file_url);
    if (mode === 'latest') posts.sort((a, b) => b.id - a.id);
    if (run !== generation) return;
    if (!posts.length) {
      ended = true;
      statusEl.textContent = receivedCount ? `接口返回 ${receivedCount} 张，但没有可显示的图片` : (station === 'pflow' && !manualSearchTags ? 'Pixiv 榜单已到底' : '暂时没有更多图片');
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
    } else if (station === 'pflow' && !manualSearchTags && results[0]?.hasNextPage === false) {
      ended = true;
      sentinel.classList.add('done');
      statusEl.textContent = `Pixiv 榜单已到底，共显示 ${currentPosts.length} 张`;
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
    if (mode === 'favorites' && favoriteFolder === 'original') {
      if (post.cacheStatus === 'error') card.classList.add('cache-failed');
      else if (post.cacheStatus !== 'ready') card.classList.add('cache-waiting');
    }
    const isPixiv = post.source === 'pixiv' || String(post.id).startsWith('px_');
    const img = document.createElement('img');
    // Reserve the post's aspect ratio before its thumbnail arrives. Otherwise
    // every masonry card starts as a thin strip and expands while scrolling.
    const width = Number(post.image_width);
    const height = Number(post.image_height);
    const ratio = width > 0 && height > 0 && Number.isFinite(width / height)
      ? Math.max(0.2, Math.min(5, height / width)) : 4 / 3;
    img.width = 1000;
    img.height = Math.round(1000 * ratio);
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = mode === 'favorites' && post.cacheStatus === 'ready' ? `/api/reverse/image/${post.id}` : imageSrc(post.preview_file_url || post.large_file_url || post.file_url);
    img.alt = post.title || (isPixiv ? `Pixiv #${post.pixiv_id || post.id}` : `Danbooru #${post.id}`);
    img.addEventListener('load', () => { img.classList.add('loaded'); queueNextLoad(); });
    img.addEventListener('error', () => {
      if (img.dataset.fallback !== '1' && post.large_file_url) {
        img.dataset.fallback = '1';
        img.src = imageSrc(post.large_file_url);
      }
    });

    const badge = document.createElement('span');
    badge.className = `badge rating-${post.rating || 'g'}`;
    badge.title = `${ratingNames[post.rating] || post.rating || '全年龄'} · ${post.image_width || '?'}×${post.image_height || '?'}`;

    const favoriteButton = document.createElement('button');
    favoriteButton.className = 'favorite-button';
    favoriteButton.dataset.favoriteId = post.id;
    favoriteButton.innerHTML = isFavorite(post.id) ? HEART_SVG : HEART_OUTLINE_SVG;
    favoriteButton.classList.toggle('active', isFavorite(post.id));
    favoriteButton.title = isFavorite(post.id) ? '取消收藏' : '加入本地收藏';
    favoriteButton.setAttribute('aria-label', favoriteButton.title);
    favoriteButton.onclick = event => {
      event.stopPropagation();
      toggleFavorite(post);
    };

    if (mode === 'favorites') {
      // 1. Top-left: Source badge [D] or [P]
      const sourceBadge = document.createElement('span');
      sourceBadge.className = `source-badge ${isPixiv ? 'source-pixiv' : 'source-danbooru'}`;
      sourceBadge.textContent = isPixiv ? 'P' : 'D';
      sourceBadge.title = isPixiv ? '来源：Pixiv' : '来源：Danbooru';
      card.append(sourceBadge);

      // 2. Top-right: Rating dot badge
      card.append(badge);

      if (post.cacheStatus === 'error') {
        const failure = document.createElement('span'); failure.className = 'cache-failure-label';
        failure.textContent = '失败'; failure.title = post.cacheError || '高清缓存失败';
        card.append(failure);
      }

      // 3. Bottom-right toolbar: [ AI ] -> [ 释放至已完成 ] -> [ ♥ 收藏 ]
      const actions = document.createElement('div');
      actions.className = 'card-actions-bar';

      const ai = document.createElement('button');
      ai.className = 'ai-button'; ai.textContent = 'AI'; ai.title = '移到待反推';
      ai.onclick = event => { event.stopPropagation(); moveFavorite(post, 'pending'); };
      actions.append(ai);

      const completedButton = document.createElement('button');
      completedButton.className = 'completed-button';
      completedButton.dataset.completedId = post.id;
      completedButton.innerHTML = RELEASE_SVG;
      const done = Boolean(readFavorites().find(item => String(item.id) === String(post.id))?.completed);
      completedButton.classList.toggle('active', done);
      completedButton.title = done ? '移回原始收藏' : '释放至已完成';
      completedButton.setAttribute('aria-label', completedButton.title);
      completedButton.onclick = event => { event.stopPropagation(); toggleCompleted(post); };
      actions.append(completedButton);

      actions.append(favoriteButton);
      card.append(img, actions);
    } else {
      // Online gallery: Top-right rating dot, bottom-right ONLY favorite button
      card.append(img, badge, favoriteButton);
    }

    card.oncontextmenu = event => showMenu(event, post);
    card.addEventListener('click', () => openLightbox(post, card,
      mode === 'favorites' && post.cacheStatus === 'ready' ? (img.currentSrc || img.src) : ''));
    appendRenderedCard(card, ratio + .03);
  }
}
function appendRenderedCard(card, weight = 1) {
  if (state.ordered) { gallery.append(card); return; }
  const index = state.heights.indexOf(Math.min(...state.heights));
  state.columns[index].append(card); state.heights[index] += weight;
}
function renderReverseCard(post) {
  const pending = favoriteFolder === 'pending';
  const isWordedOrCompleted = favoriteFolder === 'worded' || favoriteFolder === 'completed';
  const isLandscape = Number(post.image_width || 0) > Number(post.image_height || 0);
  const card = document.createElement('article');
  card.className = `reverse-card ${isLandscape ? 'landscape' : 'portrait'} ${pending && post.cacheStatus !== 'ready' ? 'uncached' : ''}`;
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
  const imageShare = pending ? (width > height ? 62 : 55) : 60;
  if (width > height) picture.style.height = `${Math.min(imageShare, height / width * 100)}%`;
  else picture.style.width = `${Math.min(imageShare, width / height * 100)}%`;

  const panel = document.createElement('div'); panel.className = 'reverse-panel';
  const copy = createPromptControl(post.prompt, {
    kind: 'favorite',
    id: post.id,
    imageUrl: post.cacheStatus === 'ready' ? `/api/reverse/image/${post.id}` : image.src,
    onSaved: value => { post.prompt = value; refreshFavoriteGallery(true); }
  });
  if (!pending && !post.prompt) copy.hidden = true;

  if (pending) {
    card.classList.add('pending-card');
    const status = document.createElement('div'); status.className = 'reverse-status';
    const failed = post.reverseStatus === 'failed' || post.cacheStatus === 'error';
    const done = Boolean(post.prompt) && !failed && post.autoEnabled === false;
    const lamp = document.createElement('span'); lamp.className = `reverse-lamp ${failed ? 'red' : done ? 'green' : ''}`;
    const label = document.createElement('span'); label.textContent = failed ? '错误' : done ? '完成' : '等待';
    status.title = post.cacheStatus === 'error' ? `缓存错误：${post.cacheError || '点击重试'}` :
      post.reverseStatus === 'failed' ? `反推错误：${post.reverseError || '点击重试'}` :
      post.cacheStatus !== 'ready' ? '等待高清图缓存' : post.reverseStatus === 'processing' ? '正在反推（旧提示词已保留）' :
      post.autoEnabled !== false && post.prompt ? '等待重新反推，旧提示词暂时保留' : label.textContent;
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
    status.append(lamp, label);

    const queue = document.createElement('div'); queue.className = 'reverse-queue';
    const queueLabel = document.createElement('span'); queueLabel.textContent = '队列';
    const queueButton = document.createElement('button'); queueButton.type = 'button'; queueButton.className = `queue-button ${post.autoEnabled !== false ? 'active' : ''}`;
    queueButton.textContent = post.autoEnabled !== false ? String(post.queueOrder || '·') : '+';
    queueButton.setAttribute('aria-pressed', String(post.autoEnabled !== false));
    queueButton.title = post.autoEnabled !== false ? `队列第 ${post.queueOrder || '?'} 位，点击移出` :
      post.prompt ? '重新反推：成功后替换旧提示词，失败保留旧提示词' : '点击加入反推队列';
    queueButton.setAttribute('aria-label', queueButton.title);
    queueButton.onclick = async () => {
      queueButton.disabled = true;
      try { await patchFavorite(post.id, {autoEnabled:post.autoEnabled === false}); refreshFavoriteGallery(true); }
      catch(error) { queueButton.disabled = false; toast(`更新队列失败：${error.message}`); }
    };
    queue.append(queueLabel, queueButton);

    const picker = document.createElement('select'); picker.className = 'preset-picker'; picker.title = '扩写预设';
    picker.setAttribute('aria-label', '扩写预设');
    for (const preset of expansionNames()) {
      const option = document.createElement('option'); option.value = preset; option.textContent = preset;
      picker.append(option);
    }
    if (post.preset && !expansionNames().includes(post.preset)) picker.add(new Option(`${post.preset}（已移除）`, post.preset));
    picker.value = post.preset || presetConfig.defaultExpansion;
    picker.onchange = async () => {
      try { await patchFavorite(post.id, {preset: picker.value}); }
      catch(error) { picker.value = post.preset || presetConfig.defaultExpansion; toast(`扩写预设保存失败：${error.message}`); }
    };
    const reversePicker = document.createElement('select'); reversePicker.className='preset-picker'; reversePicker.title='反推预设';
    reversePicker.setAttribute('aria-label', '反推预设');
    for(const entry of presetConfig.reverse) reversePicker.add(new Option(`反推：${entry.name}`,entry.name));
    reversePicker.value = post.reversePreset || presetConfig.defaultReverse;
    reversePicker.onchange = async () => {
      try { await patchFavorite(post.id, {reversePreset:reversePicker.value}); }
      catch(error) { reversePicker.value=post.reversePreset || presetConfig.defaultReverse; toast(`反推预设保存失败：${error.message}`); }
    };

    const actions = document.createElement('div'); actions.className = 'reverse-actions';
    actions.append(status, queue, reversePicker, picker);

    const instruction = document.createElement('input'); instruction.className = 'reverse-instruction';
    instruction.type = 'text'; instruction.maxLength = 4000; instruction.placeholder = '额外要求（与预设一起交给 AI）';
    instruction.setAttribute('aria-label', '额外反推要求'); instruction.value = post.customInstruction || '';
    instruction.onchange = async () => {
      try { await patchFavorite(post.id, {customInstruction: instruction.value}); toast('额外要求已保存'); }
      catch(error) { toast('保存失败：' + error.message); }
    };

    panel.append(copy, actions, instruction);
  } else {
    panel.append(copy);

    if (isWordedOrCompleted) {
      const panelActions = document.createElement('div');
      panelActions.className = `panel-actions-bar ${isLandscape ? 'horizontal' : 'vertical'}`;

      const aiButton = document.createElement('button');
      aiButton.type = 'button'; aiButton.className = 'ai-button'; aiButton.textContent = 'AI';
      aiButton.title = '移回待反推重新反推';
      aiButton.onclick = event => { event.stopPropagation(); moveFavorite(post, 'pending'); };

      const completedButton = document.createElement('button');
      completedButton.type = 'button';
      completedButton.className = `completed-button ${favoriteFolder === 'completed' ? 'active' : ''}`;
      completedButton.innerHTML = RELEASE_SVG;
      completedButton.title = favoriteFolder === 'completed' ? '移回有词区' : '释放至已完成';
      completedButton.onclick = event => {
        event.stopPropagation();
        moveFavorite(post, favoriteFolder === 'completed' ? 'worded' : 'completed');
      };

      const favoriteButton = document.createElement('button');
      favoriteButton.type = 'button'; favoriteButton.className = 'favorite-button active';
      favoriteButton.dataset.favoriteId = post.id; favoriteButton.innerHTML = HEART_SVG;
      favoriteButton.title = '取消本地收藏';
      favoriteButton.onclick = event => { event.stopPropagation(); toggleFavorite(post); };

      panelActions.append(aiButton, completedButton, favoriteButton);
      panel.append(panelActions);
    }
  }

  card.append(picture, panel);

  const isPixiv = post.source === 'pixiv' || String(post.id).startsWith('px_');
  const sourceBadge = document.createElement('span');
  sourceBadge.className = `source-badge ${isPixiv ? 'source-pixiv' : 'source-danbooru'}`;
  sourceBadge.textContent = isPixiv ? 'P' : 'D';
  sourceBadge.title = isPixiv ? '来源：Pixiv' : '来源：Danbooru';

  const badge = document.createElement('span');
  badge.className = `badge rating-${post.rating || 'g'}`;
  badge.title = `${ratingNames[post.rating] || post.rating || '全年龄'}`;

  picture.append(sourceBadge, badge);

  if (pending) {
    const favBtn = document.createElement('button');
    favBtn.type = 'button'; favBtn.className = 'favorite-button active';
    favBtn.dataset.favoriteId = post.id; favBtn.innerHTML = HEART_SVG;
    favBtn.title = '取消本地收藏';
    favBtn.onclick = event => { event.stopPropagation(); toggleFavorite(post); };
    picture.append(favBtn);
  }

  card.oncontextmenu = event => showMenu(event, post);
  appendRenderedCard(card);
}
function createPromptControl(initialPrompt, target) {
  let prompt = initialPrompt;
  const control = document.createElement('div'); control.className = 'prompt-control';
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy-prompt';
  copy.textContent = '复制提示词'; copy.title = '复制提示词'; copy.disabled = !prompt;
  copy.onclick = async event => {
    event.stopPropagation();
    try { await navigator.clipboard.writeText(prompt); toast('已复制提示词'); }
    catch (error) { toast(`复制失败：${error.message}`); }
  };
  const expand = document.createElement('button'); expand.type = 'button'; expand.className = 'prompt-expand';
  expand.textContent = '▾'; expand.title = '展开查看提示词'; expand.setAttribute('aria-label', expand.title);
  expand.disabled = !prompt && target.kind !== 'favorite';
  if (!prompt) expand.title = '手动写入提示词';
  expand.onclick = event => {
    event.stopPropagation();
    showPromptDialog(prompt, target, value => {
      prompt = value;
      target.onSaved(value);
    });
  };
  control.append(copy, expand);
  return control;
}
async function translatePrompt(text, direction, signal) {
  const response = await fetch('/api/translate', {
    method:'POST', headers:{'Content-Type':'application/json'}, signal,
    body:JSON.stringify({text,direction})
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
  if (!data.text?.trim()) throw Error('翻译结果为空');
  return data.text;
}
// Keep an English/Chinese pair for each short passage. Only changed passages are retranslated.
function promptPassages(prompt) {
  const parts = prompt.match(/[^,;.!?\n，。！？；]+(?:[,;.!?，。！？；]+)?[ \t]*|\n+/g) || [prompt];
  const result = []; let pending = '';
  for (const part of parts) {
    if (pending && pending.length + part.length > 720) { result.push(pending); pending = ''; }
    pending += part;
  }
  if (pending) result.push(pending);
  return result.join('') === prompt ? result : [prompt];
}
async function translatePassages(parts, signal) {
  const response = await fetch('/api/translate-segments', {
    method:'POST', headers:{'Content-Type':'application/json'}, signal,
    body:JSON.stringify({segments:parts, direction:'en-zh'})
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
  if (!Array.isArray(data.segments) || data.segments.length !== parts.length ||
    data.segments.some((value, i) => typeof value !== 'string' || (parts[i].trim() && !value.trim()))) {
    throw Error('翻译片段无效');
  }
  return data.segments;
}
function changedPassage(session, edited) {
  const old = session.passages.map(part => part.chinese).join('');
  if (old === edited) return null;
  let prefix = 0;
  while (prefix < old.length && prefix < edited.length && old[prefix] === edited[prefix]) prefix++;
  let suffix = 0;
  while (suffix < old.length - prefix && suffix < edited.length - prefix &&
    old[old.length - 1 - suffix] === edited[edited.length - 1 - suffix]) suffix++;
  const end = old.length - suffix;
  let offset = 0, first = -1, last = -1, spanStart = 0, spanEnd = 0;
  session.passages.forEach((part, index) => {
    const next = offset + part.chinese.length;
    // For an insertion exactly between passages, include the passage on the left.
    if (first < 0 && (next > prefix || (prefix === end && next === prefix))) {
      first = index; spanStart = offset;
    }
    if (first >= 0 && (offset < end || (prefix === end && offset < prefix))) {
      last = index; spanEnd = next;
    }
    offset = next;
  });
  if (first < 0) { first = session.passages.length - 1; spanStart = old.length - session.passages[first].chinese.length; }
  if (last < first) { last = first; spanEnd = spanStart + session.passages[first].chinese.length; }
  const changedChinese = edited.slice(spanStart, edited.length - (old.length - spanEnd));
  return {first,last,changedChinese};
}
async function persistEditedPrompt(target, prompt) {
  if (target.kind === 'favorite') {
    await patchFavorite(target.id, {prompt});
  } else {
    const response = await fetch(`/api/${target.kind === 'worded' ? 'worded' : 'metadata'}/entries/${encodeURIComponent(target.id)}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({prompt})
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  }
}
function showPromptDialog(prompt, target, onSaved) {
  let dialog = document.querySelector('#promptDialog');
  if (!dialog) {
    const shade = document.createElement('div'); shade.className = 'prompt-shade'; shade.hidden = true;
    const workspace = document.createElement('div'); workspace.className = 'prompt-workspace'; workspace.hidden = true;
    dialog = document.createElement('dialog'); dialog.id = 'promptDialog'; dialog.className = 'prompt-dialog';
    dialog.setAttribute('aria-modal', 'false');
    shade.onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
      const session = dialog.promptSession;
      shade.hidden = true; workspace.hidden = true;
      workspace.classList.remove('editing');
      workspace.querySelector('.prompt-editor').hidden = true;
      if (session?.objectUrl) URL.revokeObjectURL(session.objectUrl);
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
    });
    const header = document.createElement('div'); header.className = 'prompt-dialog-header';
    const title = document.createElement('strong'); title.textContent = '提示词';
    const buttons = document.createElement('div'); buttons.className = 'prompt-dialog-buttons';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制提示词';
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(dialog.querySelector('.prompt-dialog-text').value); toast('已复制提示词'); }
      catch (error) { toast(`复制失败：${error.message}`); }
    };
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '修改提示词';
    edit.onclick = async () => {
      const session = dialog.promptSession;
      const version = session.version;
      const panel = workspace.querySelector('.prompt-editor');
      if (!panel.hidden) { panel.querySelector('textarea').focus(); return; }
      panel.hidden = false; workspace.classList.add('editing');
      const input = panel.querySelector('textarea');
      const status = panel.querySelector('.prompt-edit-status');
      const apply = panel.querySelector('.prompt-apply');
      input.disabled = true; apply.disabled = true; input.value = '';
      status.textContent = '正在翻译当前提示词，建立中英文片段对应关系…';
      try {
        const english = promptPassages(session.prompt);
        const chinese = await translatePassages(english);
        if (dialog.promptSession !== session || !dialog.open || panel.hidden || session.version !== version) return;
        session.passages = english.map((value, index) => ({english:value, chinese:chinese[index]}));
        input.value = chinese.join(''); input.disabled = false; apply.disabled = false;
        status.textContent = '修改中文后，点击「修正翻译」；未改动的英文保持原样';
        input.focus();
      } catch (error) {
        if (dialog.promptSession !== session || !dialog.open || panel.hidden || session.version !== version) return;
        status.textContent = `翻译失败：${error.message}。关闭后重新打开可重试。`;
      }
    };
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
    close.title = '关闭'; close.setAttribute('aria-label', '关闭提示词'); close.onclick = () => dialog.close();
    const save = document.createElement('button'); save.type = 'button'; save.className = 'prompt-save';
    save.textContent = '保存修改'; save.disabled = true;
    save.onclick = async () => {
      const session = dialog.promptSession;
      if (!session || session.busy) return;
      const value = text.value;
      const wasEmptyPending = session.target.kind === 'favorite' && !session.prompt;
      if (!value.trim()) { toast('提示词不能为空'); return; }
      if (!['create','fromPost','moveWorded'].includes(session.target.kind) && value === session.prompt && !session.imageFile) { save.disabled = true; return; }
      session.busy = true; save.disabled = true; save.textContent = '保存中…';
      try {
        if (session.target.kind === 'moveWorded') {
          if(session.imageFile)await uploadWordedImage(session.target.id,session.imageFile);
          if(value!==session.prompt)await persistEditedPrompt({kind:'worded',id:session.target.id},value);
          const response=await fetch(`/api/worded/state/${encodeURIComponent(session.target.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:'worded'})});
          if(!response.ok)throw Error((await response.json()).error||`HTTP ${response.status}`);
          dialog.close();mode='favorites';favoriteFolder='worded';activateButton(document.querySelector('[data-mode="favorites"]'));
          document.querySelectorAll('#favoriteFolders [data-folder]').forEach(b=>b.classList.toggle('active',b.dataset.folder==='worded'));
          loadWordedGallery(false);toast('已移至有词区');return;
        }
        if (session.target.kind === 'fromPost') {
          const post=session.target.post;
          if(!isFavorite(post.id)) await saveFavorites([favoriteFields(post),...readFavorites()]);
          if(session.imageFile)await uploadFavoriteImage(post.id,session.imageFile);
          await patchFavorite(post.id,{prompt:value,folder:'worded'});
          dialog.close();favoriteFolder='worded';
          document.querySelectorAll('#favoriteFolders [data-folder]').forEach(b=>b.classList.toggle('active',b.dataset.folder==='worded'));
          mode='favorites';activateButton(document.querySelector('[data-mode="favorites"]'));refreshFavoriteGallery(false);toast('已收藏并移至有词区');return;
        }
        if (session.target.kind === 'create') {
          const summaryValue = workspace.querySelector('.prompt-summary').value.trim();
          if (!session.imageFile && !summaryValue) throw Error('请粘贴/拖入图片，或填写提示词概述');
          const response=await fetch('/api/worded/entries',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({prompt:value,summary:summaryValue,hasImage:Boolean(session.imageFile)})});
          const created=await response.json(); if(!response.ok)throw Error(created.error || `HTTP ${response.status}`);
          if(session.imageFile) {
            try { await uploadWordedImage(created.id,session.imageFile); }
            catch(error) { await fetch(`/api/worded/entries/${encodeURIComponent(created.id)}`,{method:'DELETE'}); throw error; }
          }
          dialog.close(); favoriteFolder='worded';
          document.querySelectorAll('#favoriteFolders [data-folder]').forEach(b=>b.classList.toggle('active',b.dataset.folder==='worded'));
          refreshFavoriteGallery(false);
          toast('卡片已保存到有词区'); return;
        }
        if(session.imageFile) {
          if(session.target.kind==='favorite')await uploadFavoriteImage(session.target.id,session.imageFile);
          else if(session.target.kind==='worded')await uploadWordedImage(session.target.id,session.imageFile);
          else throw Error('元数据图片不能替换');
        }
        if(value!==session.prompt)await persistEditedPrompt(session.target, value);
        session.prompt = value; session.onSaved(value); session.passages = null; session.version++;session.imageFile=null;
        if(session.target.kind==='worded')loadWordedGallery(true);else if(session.target.kind==='favorite')refreshFavoriteGallery(true);
        if (wasEmptyPending) { dialog.close(); toast('提示词已保存，图片已移至有词区'); return; }
        const panel = workspace.querySelector('.prompt-editor');
        panel.hidden = true; workspace.classList.remove('editing');
        toast('提示词已保存');
      } catch (error) {
        toast(`保存失败：${error.message}`);
      } finally {
        session.busy = false; save.textContent = '保存修改';
        save.disabled = !text.value.trim() || (!['create','fromPost','moveWorded'].includes(session.target.kind) && text.value === session.prompt && !session.imageFile);
      }
    };
    buttons.append(copy,edit,save,close); header.append(title,buttons);
    const text = document.createElement('textarea'); text.className = 'prompt-dialog-text';
    text.setAttribute('spellcheck', 'false');
    text.addEventListener('input', () => { save.disabled = !text.value.trim() || (!['create','fromPost','moveWorded'].includes(dialog.promptSession?.target.kind) && text.value === dialog.promptSession?.prompt && !dialog.promptSession?.imageFile); });
    text.tabIndex = 0;
    text.setAttribute('aria-label', '提示词内容');
    text.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); save.click();
      }
    });
    const panel = document.createElement('section'); panel.className = 'prompt-editor'; panel.hidden = true;
    const panelTitle = document.createElement('strong'); panelTitle.textContent = '中文修改区';
    const status = document.createElement('div'); status.className = 'prompt-edit-status'; status.setAttribute('role','status');
    const input = document.createElement('textarea'); input.setAttribute('aria-label','修改提示词中文内容');
    input.placeholder = '在这里修改中文提示词，点击「修正翻译」才会翻译并保存';
    input.addEventListener('input', () => {
      if (dialog.promptSession?.passages) {
        apply.disabled = dialog.promptSession.busy;
        status.textContent = '尚未保存；点击「修正翻译」仅更新改动的片段';
      }
    });
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'prompt-apply';
    apply.textContent = '修正翻译'; apply.disabled = true;
    apply.onclick = () => dialog.promptSession?.sync();
    panel.append(panelTitle,status,input,apply);
    const picture = document.createElement('aside'); picture.className = 'prompt-picture';
    const preview = document.createElement('img'); preview.alt = '卡片图片预览';
    const placeholder = document.createElement('span'); placeholder.textContent = '第二步：粘贴或拖入图片，也可点此选取';
    const summary = document.createElement('textarea'); summary.className = 'prompt-summary';
    summary.placeholder = '无图时填写提示词概述（也可直接粘贴文字）'; summary.setAttribute('aria-label','图片或提示词概述');
    const chooser = document.createElement('input'); chooser.type='file'; chooser.accept='image/png,image/jpeg,image/webp'; chooser.hidden=true;
    const setImage = file => {
      if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) { toast('仅支持 PNG、JPEG、WebP 图片'); return; }
      const session = dialog.promptSession;
      if (session.objectUrl) URL.revokeObjectURL(session.objectUrl);
      session.imageFile=file; session.objectUrl=URL.createObjectURL(file);
      preview.src=session.objectUrl; preview.hidden=false; placeholder.hidden=true;
      save.disabled = !text.value.trim();
    };
    chooser.onchange=()=>{if(chooser.files[0])setImage(chooser.files[0]);chooser.value='';};
    picture.onclick=e=>{if(e.target!==summary)chooser.click();};
    picture.ondragover=e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();};
    picture.ondrop=e=>{e.preventDefault();e.stopPropagation();setImage([...e.dataTransfer.files].find(x=>x.type.startsWith('image/')));};
    workspace.addEventListener('paste', e=>{
      if (!dialog.open || !dialog.promptSession || dialog.promptSession.target.kind === 'metadata') return;
      const file=[...e.clipboardData.items].find(x=>x.type.startsWith('image/'))?.getAsFile();
      if(file){e.preventDefault();setImage(file);}
    });
    picture.append(preview,placeholder,summary,chooser);
    dialog.append(header,text); workspace.append(picture,dialog,panel); document.body.append(shade,workspace);
  }
  if (dialog.open) dialog.close();
  const workspace = dialog.closest('.prompt-workspace');
  const panel = workspace.querySelector('.prompt-editor');
  panel.hidden = true; workspace.classList.remove('editing');
  const session = {prompt:prompt || '', target, onSaved:onSaved || (()=>{}), passages:null, busy:false, version:0,
    imageFile:target.imageFile || null, objectUrl:null};
  const picture = workspace.querySelector('.prompt-picture');
  const preview = picture.querySelector('img');
  const summary = picture.querySelector('.prompt-summary');
  summary.value = target.summary || '';
  summary.hidden = target.kind !== 'create';
  picture.classList.toggle('create', target.kind !== 'metadata');
  if (session.imageFile) { session.objectUrl=URL.createObjectURL(session.imageFile); preview.src=session.objectUrl; }
  else preview.src=target.imageUrl || '';
  preview.hidden = !Boolean(session.imageFile || target.imageUrl);
  picture.querySelector('span').hidden = !preview.hidden;
  dialog.querySelector('.prompt-dialog-header strong').textContent = target.kind === 'create' ? '手写提示词' : ['fromPost','moveWorded'].includes(target.kind) ? '创建提示词卡片' : '提示词';
  dialog.querySelector('.prompt-dialog-buttons button:first-child').hidden = ['create','fromPost','moveWorded'].includes(target.kind);
  dialog.querySelector('.prompt-dialog-buttons button:nth-child(2)').hidden = ['create','fromPost','moveWorded'].includes(target.kind);
  dialog.querySelector('.prompt-dialog-buttons button:nth-child(3)').textContent = ['create','fromPost','moveWorded'].includes(target.kind) ? '创建卡片' : '保存修改';
  session.sync = async () => {
    const input = panel.querySelector('textarea');
    const status = panel.querySelector('.prompt-edit-status');
    const apply = panel.querySelector('.prompt-apply');
    if (!session.passages || session.busy) return;
    const edited = input.value;
    if (!edited.trim()) { status.textContent = '提示词不能为空，尚未保存'; return; }
    const change = changedPassage(session, edited);
    if (!change) { status.textContent = '没有改动，无需翻译'; return; }
    session.busy = true; input.disabled = true; apply.disabled = true;
    status.textContent = '正在翻译改动的片段…';
    try {
      let translated = change.changedChinese.trim()
        ? await translatePrompt(change.changedChinese, 'zh-en') : change.changedChinese;
      const oldEnglish = session.passages.slice(change.first, change.last + 1)
        .map(part => part.english).join('');
      // Google often trims whitespace. Retain the existing English passage's edge spacing
      // so a corrected sentence does not get glued to its unchanged neighbors.
      const leading = oldEnglish.match(/^[ \t\n]+/)?.[0] || '';
      const trailing = oldEnglish.match(/[ \t\n]+$/)?.[0] || '';
      if (leading && !/^[ \t\n]/.test(translated)) translated = leading + translated;
      if (trailing && !/[ \t\n]$/.test(translated)) translated += trailing;
      const next = session.passages.slice();
      next.splice(change.first, change.last - change.first + 1,
        {chinese:change.changedChinese, english:translated});
      const english = next.map(part => part.english).join('');
      status.textContent = '正在保存…';
      await persistEditedPrompt(target, english);
      session.passages = next; session.prompt = english; onSaved(english);
      if (dialog.promptSession === session) {
        dialog.querySelector('.prompt-dialog-text').value = english;
        dialog.querySelector('.prompt-save').disabled = true;
        status.textContent = '已保存；未修改片段的英文保持原样';
      }
    } catch (error) {
      if (dialog.promptSession === session) status.textContent = `翻译/保存失败：${error.message}，可再次点击重试`;
    } finally {
      session.busy = false;
      if (dialog.promptSession === session) { input.disabled = false; apply.disabled = false; }
    }
  };
  dialog.promptSession = session;
  dialog.querySelector('.prompt-dialog-text').value = prompt || '';
  dialog.querySelector('.prompt-save').disabled = !['create','fromPost','moveWorded'].includes(target.kind) || (target.kind === 'moveWorded' && !prompt?.trim());
  workspace.hidden = false;
  document.querySelector('.prompt-shade').hidden = false;
  if (!dialog.open) dialog.show(); // Non-modal so translation extensions can render above the viewer.
  dialog.querySelector('.prompt-dialog-text').scrollTop = 0;
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
  if (mode === 'metadata' || (mode === 'favorites' && ['pending','worded'].includes(favoriteFolder))) {
    clearTimeout(resizeGalleryTimer);
    resizeGalleryTimer = setTimeout(() => mode === 'metadata' ? loadMetadataGallery() : refreshFavoriteGallery(true), 150);
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeLightbox();
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !event.target.closest('input, textarea, [contenteditable="true"]')) {
    event.preventDefault();
    undoLastAction();
  }
});
let activeManual = null;
function showManualMenu(event, item) {
  event.preventDefault(); activePost = null; activeManual = item;
  menu.querySelectorAll('[data-action]').forEach(button => {
    button.hidden = button.dataset.action !== 'create-prompt' && button.dataset.action !== 'delete';
  });
  const delBtn = menu.querySelector('[data-action="delete"]');
  if (delBtn) delBtn.textContent = '删除本地卡片';
  menu.classList.remove('hidden');
  menu.style.left = `${Math.min(event.clientX, innerWidth - 205)}px`;
  menu.style.top = `${Math.min(event.clientY, innerHeight - 190)}px`;
}
function showMenu(event, post) {
  event.preventDefault();
  activePost = post; activeManual = null;
  menu.querySelectorAll('[data-action]').forEach(button => button.hidden = false);
  menu.querySelector('[data-action="favorite"]').textContent = isFavorite(post.id) ? '取消本地收藏' : '加入本地收藏';
  const delBtn = menu.querySelector('[data-action="delete"]');
  if (delBtn) {
    if (mode === 'favorites') {
      delBtn.hidden = false;
      delBtn.textContent = '从本地收藏移除';
    } else {
      delBtn.hidden = true;
    }
  }
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
  if (!post) throw Error('没有选中的图片');
  if (!window.isSecureContext || !navigator.clipboard?.write || !window.ClipboardItem) {
    throw Error('当前页面不允许写入图片剪贴板，请使用 localhost/HTTPS 打开并允许剪贴板权限');
  }
  toast('正在准备高清图片…');
  const saved = readFavorites().find(item => String(item.id) === String(post.id));
  const cached = saved?.cacheStatus === 'ready' || post.cacheStatus === 'ready';
  const localUrl = post.imageExt
    ? `/api/worded/images/${encodeURIComponent(post.id)}`
    : cached ? `/api/reverse/image/${encodeURIComponent(post.id)}` : '';
  // 已缓存的收藏绝不回退到远程图床：远端限流不能让本地复制失败。
  const urls = localUrl ? [localUrl] : [...new Set([
    post.imageUrl, post.file_url, post.large_file_url, post.preview_file_url
  ].filter(Boolean))];
  if (!urls.length) throw Error('没有可复制的本地缓存或图片地址');

  const getPngBlob = async () => {
    let lastError;
    for (const url of urls) {
      const fetchUrl = url.startsWith('/api/') || url.startsWith('blob:')
        ? url : `/api/image?url=${encodeURIComponent(url)}`;
      try {
        const response = await fetch(fetchUrl);
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw Error('返回内容不是图片');
        return await blobAsPng(blob);
      } catch (error) {
        lastError = error;
        console.warn('图片复制：读取/转换失败', fetchUrl, error);
      }
    }
    // 收藏卡片的缩略图也是从同一份本地高清缓存载入的。若 fetch 被浏览器
    // 中断，直接从已解码的同源图片复制，仍不访问远端。
    if (localUrl) {
      const img = [...gallery.querySelectorAll('img')].find(element =>
        element.complete && element.naturalWidth && new URL(element.currentSrc || element.src).pathname === localUrl);
      if (img) {
        try {
          const bitmap = await createImageBitmap(img);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width; canvas.height = bitmap.height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            return await new Promise((resolve, reject) => canvas.toBlob(
              value => value ? resolve(value) : reject(Error('图片转换失败')), 'image/png'));
          } finally { bitmap.close(); }
        } catch (error) { lastError = error; }
      }
    }
    throw Error(`${localUrl ? '读取本地高清缓存' : '下载高清图片'}失败：${lastError?.message || '未知错误'}`);
  };

  // 在菜单点击的用户手势内立即调用 write；图片读取及 PNG 转换由 Promise 完成。
  const pngPromise = getPngBlob();
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
  } catch (firstError) {
    // Chrome/Edge 对异步 ClipboardItem 的支持不一致，保留读取结果再尝试 Blob。
    const png = await pngPromise;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } catch (secondError) {
      throw Error(`剪贴板写入失败：${secondError.message || firstError.message || '浏览器拒绝'}`);
    }
  }
  toast('已复制高清图片');
}
menu.onclick = async event => {
  const action = event.target.dataset.action;
  if (!action || (!activePost && !activeManual)) return;
  menu.classList.add('hidden');
  try {
    if (action === 'delete') {
      if (activeManual) {
        if (!confirm('确定删除此本地卡片及图片？')) return;
        const res = await fetch(`/api/worded/entries/${encodeURIComponent(activeManual.id)}`, { method: 'DELETE' });
        if (res.ok) {
          toast('已删除卡片');
          loadWordedGallery(true);
        } else {
          toast('删除失败');
        }
      } else if (activePost) {
        if (!confirm('确定从本地收藏中移除此卡片？')) return;
        await toggleFavorite(activePost);
      }
      return;
    }
    if (action === 'favorite' && activePost) await toggleFavorite(activePost);
    if (action === 'create-prompt') {
      if(activeManual)showPromptDialog(activeManual.positive,{kind:'moveWorded',id:activeManual.id,imageUrl:activeManual.imageExt?`/api/worded/images/${encodeURIComponent(activeManual.id)}`:'',summary:activeManual.summary});
      else {const saved=readFavorites().find(item=>String(item.id)===String(activePost.id));showPromptDialog(saved?.prompt||'',{kind:'fromPost',post:activePost,imageUrl:saved?.cacheStatus==='ready'?`/api/reverse/image/${activePost.id}`:imageSrc(activePost.large_file_url||activePost.preview_file_url)});}
    }
    if (action === 'copy') await copyImage(activePost || activeManual);
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
  if (nextMode === 'metadata' || (nextMode === 'favorites' && favoriteFolder === 'worded')) load(true);
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
  if (mode === 'favorites' && ['worded','pending','completed'].includes(favoriteFolder)) { load(true); return; }
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

function updateStationUI() {
  const switchBtn = document.querySelector('#stationSwitch');
  const label = switchBtn?.querySelector('.station-label');
  const searchInput = document.querySelector('#search');
  const settingsBtn = document.querySelector('#settings');
  
  if (station === 'pflow') {
    switchBtn?.classList.add('station-pflow');
    switchBtn?.classList.remove('station-dflow');
    if (label) label.textContent = 'Pflow';
    document.querySelector('.nav-dflow')?.classList.add('hidden');
    document.querySelector('.nav-pflow')?.classList.remove('hidden');
    if (searchInput) searchInput.placeholder = '搜索 Pixiv 插画、作品、作者，例如：初音ミク 10000users入り';
    if (settingsBtn) settingsBtn.textContent = '登录 Pflow';
  } else {
    switchBtn?.classList.add('station-dflow');
    switchBtn?.classList.remove('station-pflow');
    if (label) label.textContent = 'Dflow';
    document.querySelector('.nav-dflow')?.classList.remove('hidden');
    document.querySelector('.nav-pflow')?.classList.add('hidden');
    if (searchInput) searchInput.placeholder = '搜索 Danbooru 标签、角色、作品，例如：blue_eyes rating:g';
    if (settingsBtn) settingsBtn.textContent = '登录 Dflow';
  }
}

function switchStation(next) {
  const targetStation = next || (station === 'dflow' ? 'pflow' : 'dflow');
  if (targetStation === station && next) return;
  station = targetStation;
  localStorage.setItem('dflow_station', station);
  updateStationUI();

  const dflowModes = new Set(['latest', 'popular-day', 'popular-week', 'popular-month', 'viewed', 'favcount', 'comment', 'upvotes', 'score', 'rank', 'mpixels']);
  const pflowModes = new Set(['pixiv-daily', 'pixiv-weekly', 'pixiv-monthly', 'pixiv-ai', 'pixiv-r18']);

  if (station === 'pflow' && dflowModes.has(mode)) {
    selectMode('pixiv-daily');
  } else if (station === 'dflow' && pflowModes.has(mode)) {
    selectMode('latest');
  } else {
    load(true);
  }
}

document.querySelector('#stationSwitch').onclick = () => switchStation();

async function loadPresetConfig() {
  try {
    const response=await fetch('/api/mcp/presets',{cache:'no-store'});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const result=await response.json();
    if(!Array.isArray(result.reverse)||!Array.isArray(result.expansion))throw Error('返回内容不是预设配置');
    presetConfig=result;
    return true;
  } catch(error) {
    // Do not silently display the generic fallback as if personal presets were loaded.
    const status=document.querySelector('#mcpPresetStatus');
    if(status)status.textContent=`读取预设失败：${error.message}。请确认 DFlow 已重启。`;
    return false;
  }
}
function renderMcpPresets() {
  for (const [type, containerId] of [['reverse','mcpReversePresets'],['expansion','mcpExpansionPresets']]) {
    const container=document.querySelector('#'+containerId); container.replaceChildren();
    for (const entry of presetConfig[type]) {
      const row=document.createElement('div'); row.className='mcp-preset-row';
      const heading=document.createElement('div'); heading.className='mcp-preset-heading';
      const name=document.createElement('input');name.value=entry.name;name.placeholder='预设名称';name.maxLength=60;name.setAttribute('aria-label','预设名称');
      const remove=document.createElement('button');remove.type='button';remove.textContent='删除';remove.className='btn-subtle';
      remove.onclick=()=>{if(container.children.length<=1){toast('至少保留一个预设');return}if(confirm(`删除预设「${name.value}」？保存后生效`)){row.remove();updateDefaultPresetSelects();}};
      heading.append(name,remove);
      const editor=document.createElement('details');editor.className='mcp-preset-editor';
      const summary=document.createElement('summary');summary.textContent='编辑正文 / 导入文件';
      const body=document.createElement('textarea');body.rows=5;body.maxLength=100000;body.value=entry.content || '';body.placeholder='粘贴反推或扩写预设正文';
      const file=document.createElement('input');file.type='file';file.accept='.txt,.md,text/plain,text/markdown';file.className='mcp-preset-file';
      file.onchange=async()=>{if(!file.files[0])return;if(file.files[0].size>300000){toast('预设文件超过限制');return}body.value=await file.files[0].text();if(!name.value.trim())name.value=file.files[0].name.replace(/\.(txt|md)$/i,'');editor.open=true;updateDefaultPresetSelects();};
      editor.append(summary,body,file);name.oninput=updateDefaultPresetSelects;row.append(heading,editor);container.append(row);
    }
  }
  updateDefaultPresetSelects();
}
function updateDefaultPresetSelects() {
  for(const [containerId,selectId,defaultKey] of [['mcpReversePresets','defaultReversePreset','defaultReverse'],['mcpExpansionPresets','defaultExpansionPreset','defaultExpansion']]) {
    const select=document.querySelector('#'+selectId),previous=select.value || presetConfig[defaultKey];
    const names=[...document.querySelectorAll(`#${containerId} .mcp-preset-heading input`)].map(x=>x.value.trim()).filter(Boolean);
    select.replaceChildren(...names.map(name=>new Option(name,name)));
    select.value=names.includes(previous)?previous:names[0] || '';
  }
}
for(const [buttonId,containerId] of [['addReversePreset','mcpReversePresets'],['addExpansionPreset','mcpExpansionPresets']])
  document.querySelector('#'+buttonId).onclick=()=>{
    const type=containerId==='mcpReversePresets'?'reverse':'expansion';
    presetConfig.reverse=[...document.querySelectorAll('#mcpReversePresets .mcp-preset-row')].map(row=>({name:row.querySelector('.mcp-preset-heading input').value,content:row.querySelector('textarea').value}));
    presetConfig.expansion=[...document.querySelectorAll('#mcpExpansionPresets .mcp-preset-row')].map(row=>({name:row.querySelector('.mcp-preset-heading input').value,content:row.querySelector('textarea').value}));
    presetConfig.defaultReverse=document.querySelector('#defaultReversePreset').value;
    presetConfig.defaultExpansion=document.querySelector('#defaultExpansionPreset').value;
    presetConfig[type].push({name:'',content:''});renderMcpPresets();
    const added=document.querySelector(`#${containerId} .mcp-preset-row:last-child`);added.querySelector('details').open=true;added.querySelector('.mcp-preset-heading input').focus();
  };
// Read the DOM rather than trusting an old in-memory copy; edited text remains local until Save.
document.querySelector('#saveMcpPresets').onclick=async()=>{
  const status=document.querySelector('#mcpPresetStatus');status.textContent='正在保存…';
  const entries=id=>[...document.querySelectorAll(`#${id} .mcp-preset-row`)].map(row=>({name:row.querySelector('.mcp-preset-heading input').value.trim(),content:row.querySelector('textarea').value.trim()}));
  const payload={reverse:entries('mcpReversePresets'),expansion:entries('mcpExpansionPresets'),defaultReverse:document.querySelector('#defaultReversePreset').value,defaultExpansion:document.querySelector('#defaultExpansionPreset').value};
  try {const response=await fetch('/api/mcp/presets',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);
    presetConfig=result;status.textContent='已保存';renderMcpPresets();if(mode==='favorites'&&favoriteFolder==='pending')refreshFavoriteGallery(true);
  }catch(error){status.textContent='保存失败：'+error.message;}
};
async function refreshMcpSessions(){
  const container=document.querySelector('#mcpSessions');
  try { const response=await fetch('/api/mcp/sessions',{cache:'no-store'});const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);
    container.replaceChildren();if(!result.length){container.textContent='当前没有连接中的 Agent';return;}
    for(const session of result){const row=document.createElement('div');row.className='mcp-session';const label=document.createElement('span');label.textContent=`${session.name} ${session.version || ''} · 已连接 ${new Date(session.since).toLocaleTimeString()}`;
      const disconnect=document.createElement('button');disconnect.type='button';disconnect.className='btn-subtle';disconnect.textContent='断开';disconnect.onclick=async()=>{if(!confirm(`断开 ${session.name} 的当前 MCP 会话？`))return;await fetch(`/api/mcp/sessions/${encodeURIComponent(session.id)}`,{method:'DELETE'});refreshMcpSessions();};row.append(label,disconnect);container.append(row);}
  }catch(error){container.textContent='读取连接失败：'+error.message;}
}
document.querySelector('#refreshMcpSessions').onclick=refreshMcpSessions;
document.querySelector('#copyMcpConfig').onclick=async()=>{try{await navigator.clipboard.writeText(document.querySelector('#mcpConnectionConfig').value);toast('已复制 MCP 连接配置');}catch(error){toast('复制失败：'+error.message)}};
fetch('/api/mcp/setup').then(response=>response.json()).then(config=>{
  if(!config.args)throw Error('只能在运行 DFlow 的电脑上查看连接配置');
  document.querySelector('#mcpConnectionConfig').value=JSON.stringify({mcpServers:{'dflow-local':{command:config.command,args:config.args,env:{DFLOW_PORT:String(config.port)}}}},null,2);
}).catch(error=>{document.querySelector('#mcpConnectionConfig').value=error.message;});
setInterval(()=>{if(document.querySelector('#settingsDialog').open&&document.querySelector('#tabMcp').classList.contains('active'))refreshMcpSessions();},6000);

let mcpPresetRendered=false;
// Settings Dialog Tabs
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.toggle('active', p.id === tab.dataset.tab));
    if(tab.dataset.tab==='tabMcp') {
      if(!mcpPresetRendered){loadPresetConfig().then(ok=>{if(ok){renderMcpPresets();mcpPresetRendered=true;}});}
      refreshMcpSessions();
    }
  };
});

document.querySelector('#closeSettingsHeader').onclick = () => document.querySelector('#settingsDialog').close();
document.querySelector('#closeSettings').onclick = () => document.querySelector('#settingsDialog').close();

document.querySelector('#settings').onclick = () => {
  const dialog = document.querySelector('#settingsDialog');
  document.querySelector('#loginName').value = localStorage.loginName || '';
  document.querySelector('#loginKey').value = localStorage.loginKey || '';
  document.querySelector('#pixivCookie').value = localStorage.pixivCookie || '';
  document.querySelector('#pixivRefreshToken').value = localStorage.pixivRefreshToken || '';
  document.querySelector('#primaryTranslator').value = localStorage.primaryTranslator || 'deepl';
  document.querySelector('#translateFallback').checked = localStorage.translateFallback !== 'false';
  document.querySelector('#deeplKey').value = localStorage.deeplKey || '';
  document.querySelector('#tencentSecretId').value = localStorage.tencentSecretId || '';
  document.querySelector('#tencentSecretKey').value = localStorage.tencentSecretKey || '';
  document.querySelector('#volcAccessKey').value = localStorage.volcAccessKey || '';
  document.querySelector('#volcSecretKey').value = localStorage.volcSecretKey || '';
  document.querySelector('#googleTranslateKey').value = localStorage.googleTranslateKey || '';

  const targetTab = station === 'pflow' ? 'tabPixiv' : 'tabDanbooru';
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === targetTab));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.toggle('active', p.id === targetTab));

  const loginStatus = document.querySelector('#loginStatus');
  if (loginStatus) { loginStatus.textContent = ''; loginStatus.className = 'status-inline'; }
  const translateStatus = document.querySelector('#translateStatus');
  if (translateStatus) { translateStatus.textContent = ''; translateStatus.className = 'status-inline'; }
  dialog.showModal();
};

document.querySelector('#testSettings').onclick = async () => {
  const name = document.querySelector('#loginName').value.trim();
  const key = document.querySelector('#loginKey').value.trim();
  const status = document.querySelector('#loginStatus');
  if (!name || !key) { status.textContent = '✕ 请同时填写账户名称和 API Key'; status.className = 'status-inline status-error'; return; }
  status.textContent = '正在测试…'; status.className = 'status-inline';
  try {
    const response = await fetch('/api/auth-test', { headers: { 'X-Danbooru-Username': name, 'X-Danbooru-Key': key } });
    const detail = await response.json().catch(() => ({}));
    status.textContent = detail.ok ? `✓ ${detail.message}` : `✕ ${detail.message || detail.error || `HTTP ${response.status}`}`;
    status.className = detail.ok ? 'status-inline status-success' : 'status-inline status-error';
  } catch { status.textContent = '✕ 无法连接测试服务'; status.className = 'status-inline status-error'; }
};

document.querySelector('#testTranslate').onclick = async () => {
  const status = document.querySelector('#translateStatus');
  status.textContent = '正在测试翻译连通性…'; status.className = 'status-inline';
  try {
    const response = await fetch('/api/translate-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primaryTranslator: document.querySelector('#primaryTranslator').value,
        translateFallback: document.querySelector('#translateFallback').checked,
        deeplKey: document.querySelector('#deeplKey').value.trim(),
        tencentSecretId: document.querySelector('#tencentSecretId').value.trim(),
        tencentSecretKey: document.querySelector('#tencentSecretKey').value.trim(),
        volcAccessKey: document.querySelector('#volcAccessKey').value.trim(),
        volcSecretKey: document.querySelector('#volcSecretKey').value.trim(),
        googleTranslateKey: document.querySelector('#googleTranslateKey').value.trim()
      })
    });
    const data = await response.json();
    if (data.ok) {
      status.textContent = `✓ [${data.engine}] 成功: ${data.translated}`;
      status.className = 'status-inline status-success';
    } else {
      status.textContent = `✕ 失败: ${data.error || '测试未通过'}`;
      status.className = 'status-inline status-error';
    }
  } catch (error) {
    status.textContent = `✕ 连接错误: ${error.message}`;
    status.className = 'status-inline status-error';
  }
};

document.querySelector('#saveSettings').onclick = async () => {
  const payload = {
    loginName: document.querySelector('#loginName').value.trim(),
    loginKey: document.querySelector('#loginKey').value.trim(),
    pixivCookie: document.querySelector('#pixivCookie').value.trim(),
    pixivRefreshToken: document.querySelector('#pixivRefreshToken').value.trim(),
    primaryTranslator: document.querySelector('#primaryTranslator').value,
    translateFallback: document.querySelector('#translateFallback').checked,
    deeplKey: document.querySelector('#deeplKey').value.trim(),
    tencentSecretId: document.querySelector('#tencentSecretId').value.trim(),
    tencentSecretKey: document.querySelector('#tencentSecretKey').value.trim(),
    volcAccessKey: document.querySelector('#volcAccessKey').value.trim(),
    volcSecretKey: document.querySelector('#volcSecretKey').value.trim(),
    googleTranslateKey: document.querySelector('#googleTranslateKey').value.trim()
  };

  localStorage.loginName = payload.loginName;
  localStorage.loginKey = payload.loginKey;
  localStorage.pixivCookie = payload.pixivCookie;
  localStorage.pixivRefreshToken = payload.pixivRefreshToken;
  localStorage.primaryTranslator = payload.primaryTranslator;
  localStorage.translateFallback = String(payload.translateFallback);
  localStorage.deeplKey = payload.deeplKey;
  localStorage.tencentSecretId = payload.tencentSecretId;
  localStorage.tencentSecretKey = payload.tencentSecretKey;
  localStorage.volcAccessKey = payload.volcAccessKey;
  localStorage.volcSecretKey = payload.volcSecretKey;
  localStorage.googleTranslateKey = payload.googleTranslateKey;

  try {
    const response = await fetch('/api/account', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const result = await response.json();
    sharedUpdatedAt = result.updatedAt || sharedUpdatedAt;
    toast('配置已保存并同步');
  } catch (error) {
    toast(`配置已保存在本地设备：${error.message}`);
  }
  document.querySelector('#settingsDialog').close();
  if (station === 'dflow') loadPopularTags(true);
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
  mode = validModes.has(preferences.mode) ? preferences.mode : (station === 'pflow' ? 'pixiv-daily' : 'latest');
  if (isPixivMode(mode)) station = 'pflow';
  forcedCols = Math.max(3, Math.min(8, Number(preferences.columns) || 5));
  document.documentElement.style.setProperty('--cols', forcedCols);
  const ratings = Array.isArray(preferences.ratings) && preferences.ratings.length ? new Set(preferences.ratings) : new Set(['g', 's', 'q', 'e']);
  document.querySelectorAll('.rating-menu input').forEach(input => { input.checked = ratings.has(input.value); });
  manualSearchTags = normalizeSearchTags(preferences.search);
  searchInput.value = manualSearchTags;
  selectedPopularTags.clear();
  if (Array.isArray(preferences.selectedTags)) preferences.selectedTags.forEach(tag => selectedPopularTags.add(String(tag)));
  updateStationUI();
  activateButton(document.querySelector(`[data-mode="${mode}"]`));
  document.querySelector('#favoriteFolders')?.classList.toggle('hidden', mode !== 'favorites');
}
async function initializeSharedState() {
  await loadPresetConfig();
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
    if (remote.account) {
      if (remote.account.loginName) localStorage.loginName = remote.account.loginName;
      if (remote.account.loginKey) localStorage.loginKey = remote.account.loginKey;
      if (remote.account.pixivCookie) localStorage.pixivCookie = remote.account.pixivCookie;
      if (remote.account.pixivRefreshToken) localStorage.pixivRefreshToken = remote.account.pixivRefreshToken;
      if (remote.account.primaryTranslator) localStorage.primaryTranslator = remote.account.primaryTranslator;
      if (remote.account.translateFallback !== undefined) localStorage.translateFallback = String(remote.account.translateFallback);
      if (remote.account.deeplKey) localStorage.deeplKey = remote.account.deeplKey;
      if (remote.account.tencentSecretId) localStorage.tencentSecretId = remote.account.tencentSecretId;
      if (remote.account.tencentSecretKey) localStorage.tencentSecretKey = remote.account.tencentSecretKey;
      if (remote.account.volcAccessKey) localStorage.volcAccessKey = remote.account.volcAccessKey;
      if (remote.account.volcSecretKey) localStorage.volcSecretKey = remote.account.volcSecretKey;
      if (remote.account.googleTranslateKey) localStorage.googleTranslateKey = remote.account.googleTranslateKey;
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
  if (station === 'dflow') await loadPopularTags();
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
      if(mode === 'metadata') loadMetadataGallery();
    }
    if (remote.account) {
      if (remote.account.loginName) localStorage.loginName = remote.account.loginName;
      if (remote.account.loginKey) localStorage.loginKey = remote.account.loginKey;
      if (remote.account.pixivCookie) localStorage.pixivCookie = remote.account.pixivCookie;
      if (remote.account.primaryTranslator) localStorage.primaryTranslator = remote.account.primaryTranslator;
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
  if (mode !== 'metadata') return;
  const upload = document.querySelector('#metadataUpload');
  upload.hidden = false;
  try {
    const res = await fetch('/api/metadata/images');
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const items = await res.json();
    if (mode !== 'metadata') return;
    resetColumns();
    gallery.classList.add('reverse-gallery');
    for (const item of items) renderMetadataCard(item);
    statusEl.textContent = items.length ? `元数据库 ${items.length} 条` : '可导入 ComfyUI PNG 或手写提示词';
  } catch (error) { statusEl.textContent = `读取元数据失败：${error.message}`; }
  ended = true; sentinel.classList.remove('loading'); sentinel.classList.add('done');
}
async function loadWordedGallery(preserveScroll = false) {
  if (mode !== 'favorites' || !['worded','pending','completed'].includes(favoriteFolder)) return;
  const top = scrollY;
  try {
    const res = await fetch('/api/worded/entries', {cache:'no-store'});
    if (!res.ok) throw Error('HTTP ' + res.status);
    const entries = await res.json();
    if (mode !== 'favorites' || !['worded','pending','completed'].includes(favoriteFolder)) return;
    const posts = favoriteVisibleItems();
    const visible = entries.filter(item => (item.folder || 'worded') === favoriteFolder);
    resetColumns(); currentPosts = posts.slice();
    if (favoriteFolder === 'worded' || favoriteFolder === 'completed') {
      const rows = [
        ...posts.map(value => ({
          kind: 'favorite',
          value,
          landscape: Number(value.image_width || 0) > Number(value.image_height || 0),
          at: value.completedAt || value.wordedAt || value.created_at || '',
          index: 0
        })),
        ...visible.map(value => ({
          kind: 'entry',
          value,
          landscape: Number(value.width || 0) > Number(value.height || 0),
          at: value.completedAt || value.updatedAt || value.createdAt || '',
          index: 0
        }))
      ];
      rows.forEach((row, index) => row.index = index);
      rows.sort((a, b) => Number(b.landscape) - Number(a.landscape) ||
        (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0) ||
        a.index - b.index
      );
      for (const row of rows) {
        row.kind === 'favorite' ? renderReverseCard(row.value) : renderWordedCard(row.value);
      }
    } else {
      render(posts); for (const item of visible) renderWordedCard(item);
    }
    statusEl.textContent = folderName[favoriteFolder] + ' ' + (posts.length + visible.length) + ' 张';
    const count = document.querySelector('#wordedCount');
    if (count) count.textContent = entries.filter(item => (item.folder || 'worded') === 'worded').length + readFavorites().filter(item => postFolder(item) === 'worded').length;
    ended = true; sentinel.classList.remove('loading'); sentinel.classList.add('done');
    if (preserveScroll) requestAnimationFrame(() => scrollTo({top}));
  } catch (error) { statusEl.textContent = '读取有词区失败：' + error.message; }
}
async function changeWordedFolder(item,folder){
  try{
    const response=await fetch(`/api/worded/state/${encodeURIComponent(item.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder})});
    const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);
    loadWordedGallery(true);
  }catch(error){toast(`移动失败：${error.message}`)}
}
function renderWordedCard(item){
  const itemFolder = item.folder || 'worded';
  const isLandscape = item.imageExt ? item.width > item.height : false;
  const isWordedOrCompleted = ['worded', 'completed'].includes(itemFolder);
  const card = document.createElement('article');
  card.className = `reverse-card worded-card ${item.imageExt ? (isLandscape ? 'landscape' : 'portrait') : 'text-only'}`;
  const picture = document.createElement('div'); picture.className = 'reverse-picture';
  const url = item.imageExt ? `/api/worded/images/${encodeURIComponent(item.id)}?v=${encodeURIComponent(item.imageExt)}` : '';
  if (item.imageExt) {
    const img = document.createElement('img'); img.loading = 'lazy'; img.src = url; img.alt = item.name || '有词卡片';
    img.onclick = () => openLightbox({image_width:item.width, image_height:item.height}, card, img.src); picture.append(img);
    if (item.width > item.height) picture.style.height = `${Math.min(60, item.height / item.width * 100)}%`;
    else picture.style.width = `${Math.min(60, item.width / item.height * 100)}%`;
  } else {
    const summary = document.createElement('span'); summary.className = 'text-summary'; summary.textContent = item.summary || item.positive.slice(0,30); picture.append(summary);
    picture.style.height = '60%';
  }
  const panel = document.createElement('div'); panel.className = 'reverse-panel';
  panel.append(createPromptControl(item.positive, {
    kind: 'worded',
    id: item.id,
    imageUrl: url,
    summary: item.summary,
    onSaved: value => { item.positive = value; loadWordedGallery(true); }
  }));
  if (itemFolder === 'pending') {
    const status = document.createElement('span'); status.className = 'worded-status';
    status.textContent = item.reverseStatus === 'failed' ? '错误' : item.reverseStatus === 'processing' ? '处理中' : '等待';
    panel.append(status);
    for(const [key,names,label] of [['reversePreset',presetConfig.reverse.map(x=>x.name),'反推'],['preset',expansionNames(),'扩写']]){
      const select=document.createElement('select');select.className='preset-picker';select.setAttribute('aria-label',label+'预设');
      for(const name of names)select.add(new Option(`${label}：${name}`,name));
      select.value=item[key] || (key==='preset'?presetConfig.defaultExpansion:presetConfig.defaultReverse);
      select.onchange=async()=>{
        const previous=item[key];
        try{const response=await fetch(`/api/worded/state/${encodeURIComponent(item.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({[key]:select.value})});const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);item[key]=result[key];}
        catch(error){select.value=previous;toast('预设保存失败：'+error.message);}
      };
      panel.append(select);
    }
  } else if (isWordedOrCompleted) {
    const panelActions = document.createElement('div');
    panelActions.className = `panel-actions-bar ${isLandscape ? 'horizontal' : 'vertical'}`;

    const ai = document.createElement('button');
    ai.type = 'button'; ai.className = 'ai-button'; ai.textContent = 'AI';
    ai.title = '移至待反推';
    ai.onclick = event => { event.stopPropagation(); changeWordedFolder(item, 'pending'); };

    const completed = document.createElement('button');
    completed.type = 'button';
    completed.className = `completed-button ${itemFolder === 'completed' ? 'active' : ''}`;
    completed.innerHTML = RELEASE_SVG;
    completed.title = itemFolder === 'completed' ? '移回有词区' : '释放至已完成';
    completed.onclick = event => {
      event.stopPropagation();
      changeWordedFolder(item, itemFolder === 'completed' ? 'worded' : 'completed');
    };

    panelActions.append(ai, completed);
    panel.append(panelActions);
  }

  card.append(picture, panel);
  card.oncontextmenu = event => showManualMenu(event, item);
  appendRenderedCard(card);
}
function renderMetadataCard(item, collection = 'metadata') {
  if(collection==='worded')return renderWordedCard(item);
  const card = document.createElement('article');
  card.className = `reverse-card metadata-card ${item.source === '手写' && !item.imageExt ? 'text-only' : item.width > item.height ? 'landscape' : 'portrait'}`;
  const picture = document.createElement('div'); picture.className = 'reverse-picture';
  const img = document.createElement('img'); img.loading = 'lazy'; img.alt = item.name; if(item.imageExt || item.source !== '手写') img.src = `/api/${collection}/images/${encodeURIComponent(item.id)}`;
  if(img.src && (item.imageExt || item.source !== '手写')) { img.onclick = () => openLightbox({image_width:item.width,image_height:item.height},card,img.src); picture.append(img); }
  else { const summary=document.createElement('span');summary.className='text-summary';summary.textContent=item.summary || item.positive.slice(0,30);picture.append(summary); }
  if(item.imageExt || item.source !== '手写') {
    if (item.width > item.height) picture.style.height = `${Math.min(58,item.height/item.width*100)}%`;
    else picture.style.width = `${Math.min(58,item.width/item.height*100)}%`;
  } else picture.style.height='60%';
  const panel = document.createElement('div'); panel.className = 'reverse-panel';
  const line = (title,value) => { const el = document.createElement('div'); el.className='metadata-line'; const strong=document.createElement('strong'); strong.textContent=title+'：'; const span=document.createElement('span');span.textContent=value || '未识别';el.title=value || '未识别';el.append(strong,span);panel.append(el); };
  if(item.source !== '手写') { line('底模',item.model); line('参数',[item.positive && `正向：${item.positive}`,item.negative && `反向：${item.negative}`].filter(Boolean).join(' / ') || item.source);
  const details=document.createElement('details'); details.className='metadata-loras';
  const summary=document.createElement('summary'); summary.textContent=`LoRA（${item.loras?.length || 0}）`; details.append(summary);
  for(const lora of item.loras || []) { const el=document.createElement('div'); el.textContent=`${lora.name}${lora.strength == null ? '' : ' · '+lora.strength}`; details.append(el); }
  if(!item.loras?.length) { const el=document.createElement('div');el.textContent='未识别';details.append(el); }
  panel.append(details);
  line('生图参数',[['CFG',item.cfg],['步数',item.steps],['采样器',item.sampler],['调度器',item.scheduler],['种子',item.seed],['降噪',item.denoise]].map(([k,v])=>`${k} ${v || '—'}`).join(' · '));
  }
  const actions=document.createElement('div');actions.className='metadata-actions';
  actions.append(createPromptControl(item.positive, {kind:collection, id:item.id, imageUrl:item.imageExt ? `/api/${collection}/images/${encodeURIComponent(item.id)}` : '', onSaved: value => { item.positive = value; }}));
  if(item.source === '手写') {
    const paste=document.createElement('button');paste.textContent='粘贴图片';paste.title='点击后按 Ctrl+V，也可直接授权读取剪贴板';
    const upload=async(file)=>{try{const bitmap=await createImageBitmap(file);const url=`/api/${collection}/images/${encodeURIComponent(item.id)}?width=${bitmap.width}&height=${bitmap.height}`;bitmap.close();
      const res=await fetch(url,{method:'PUT',headers:{'Content-Type':file.type},body:file});const data=await res.json();if(!res.ok)throw Error(data.error);loadWordedGallery(true);}catch(e){toast('粘贴失败：'+e.message)}};
    const chooser=document.createElement('input');chooser.type='file';chooser.accept='image/png,image/jpeg,image/webp';chooser.hidden=true;
    chooser.onchange=async()=>{if(chooser.files[0])await upload(chooser.files[0]);chooser.value=''};
    paste.onclick=async()=>{paste.focus();try{if(!navigator.clipboard?.read)throw Error('unsupported');
      const entries=await navigator.clipboard.read();for(const entry of entries){const type=entry.types.find(x=>x.startsWith('image/'));if(type){await upload(await entry.getType(type));return}}
    }catch{}chooser.click()};
    paste.onpaste=e=>{const file=[...e.clipboardData.files].find(x=>x.type.startsWith('image/'));if(file){e.preventDefault();upload(file)}};actions.append(paste,chooser);
  }
  const remove=document.createElement('button');remove.textContent='删除';remove.onclick=async()=>{if(!confirm('删除此卡片及本地图片？'))return;const url=collection==='worded'?`/api/worded/entries/${encodeURIComponent(item.id)}`:`/api/metadata/images/${encodeURIComponent(item.id)}`;const res=await fetch(url,{method:'DELETE'});if(res.ok)(collection==='worded'?loadWordedGallery():loadMetadataGallery());else toast('删除失败');};actions.append(remove);panel.append(actions);
  card.append(picture,panel);appendRenderedCard(card);
}
document.querySelector('#manualWorded').onclick=()=>showPromptDialog('',{kind:'create'});
async function uploadFavoriteImage(id,file) {
  const bitmap=await createImageBitmap(file);
  const url=`/api/favorites/${encodeURIComponent(id)}/image?width=${bitmap.width}&height=${bitmap.height}`;
  bitmap.close();
  const response=await fetch(url,{method:'PUT',headers:{'Content-Type':file.type},body:file});
  const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);
  const index=favoriteCache.findIndex(item=>String(item.id)===String(id));
  if(index>=0)favoriteCache[index]=result.favorite;
  localStorage.setItem(FAVORITES_KEY,JSON.stringify(favoriteCache));
}
async function uploadWordedImage(id,file) {
  const bitmap=await createImageBitmap(file);
  const url=`/api/worded/images/${encodeURIComponent(id)}?width=${bitmap.width}&height=${bitmap.height}`;
  bitmap.close();
  const response=await fetch(url,{method:'PUT',headers:{'Content-Type':file.type},body:file});
  const result=await response.json(); if(!response.ok)throw Error(result.error || `HTTP ${response.status}`);
}
document.addEventListener('dragover',event=>{
  if(mode==='favorites' && [...(event.dataTransfer?.types || [])].includes('Files'))event.preventDefault();
});
document.addEventListener('drop',event=>{
  if(mode!=='favorites' || ![...(event.dataTransfer?.files || [])].some(f=>f.type.startsWith('image/')))return;
  event.preventDefault();
  if(event.target.closest?.('.prompt-workspace'))return;
  showPromptDialog('',{kind:'create',imageFile:[...event.dataTransfer.files].find(f=>f.type.startsWith('image/'))});
});
setInterval(()=>{if(mode==='metadata' && !document.activeElement?.matches('input,textarea'))loadMetadataGallery()},10000);
document.querySelector('#metadataFiles').onchange=async event=>{
  const files=[...event.target.files]; let success=0;
  for(const file of files){try{const res=await fetch(`/api/metadata/images?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':'image/png'},body:file});const body=await res.json();if(!res.ok)throw Error(body.error || `HTTP ${res.status}`);success++;}catch(e){toast(`${file.name}：${e.message}`)}}
  event.target.value='';if(success) {toast(`已导入 ${success} 张图片`);loadMetadataGallery();}
};
