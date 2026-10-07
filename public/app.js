const gallery = document.querySelector('#gallery');
const sentinel = document.querySelector('#sentinel');
const statusEl = document.querySelector('#status');
const menu = document.querySelector('#menu');
const lightbox = document.querySelector('#lightbox');
const lightboxImage = document.querySelector('#lightboxImage');
const lightboxPagination = document.querySelector('#lightboxPagination');
const lightboxPrev = document.querySelector('#lightboxPrev');
const lightboxNext = document.querySelector('#lightboxNext');
const lightboxPageIndicator = document.querySelector('#lightboxPageIndicator');
let lightboxPageIndex = 0;
let lightboxPageCount = 1;
let lightboxPages = null;
let lightboxFetchAbort = null;
const searchInput = document.querySelector('#search');

const FAVORITES_KEY = 'dflowFavoritesV1';
const PREFERENCES_KEY = 'dflowPreferencesV1';
const DIRECT_SESSION_KEY = 'dflowDirectSessionId';
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
const BACK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="20" y1="12" x2="6" y2="12"></line><polyline points="12 6 6 12 12 18"></polyline></svg>';

const pixivModeMap = {
  'pixiv-daily': 'daily',
  'pixiv-weekly': 'weekly',
  'pixiv-monthly': 'monthly',
  'pixiv-ai': 'daily_ai',
  'pixiv-r18-daily': 'daily_r18',
  'pixiv-r18-weekly': 'weekly_r18',
  'pixiv-r18-ai': 'daily_r18_ai'
};
const PIXIV_MODES = new Set(Object.keys(pixivModeMap));
const PIXIV_R18_MODES = new Set(['pixiv-r18-daily', 'pixiv-r18-weekly', 'pixiv-r18-ai']);
const PIXIV_KINDS = ['daily', 'weekly', 'monthly', 'ai'];
const PIXIV_RATING_KEY = 'dflow_pixiv_rating_v1';
const PIXIV_DATE_KEY = 'dflow_pixiv_dates_v1';
function localIsoDate(date = new Date()) {
  const value = new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function readPixivDates() {
  try { const parsed = JSON.parse(localStorage.getItem(PIXIV_DATE_KEY) || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch { return {}; }
}
function pixivDate(modeName = mode) {
  const dates = readPixivDates();
  const date = dates[modeName];
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : localIsoDate();
}
function savePixivDate(modeName, date) {
  const dates = readPixivDates(); dates[modeName] = date; localStorage.setItem(PIXIV_DATE_KEY, JSON.stringify(dates));
}
function pixivKind(modeName = mode) {
  if (modeName === 'pixiv-daily' || modeName === 'pixiv-r18-daily') return 'daily';
  if (modeName === 'pixiv-weekly' || modeName === 'pixiv-r18-weekly') return 'weekly';
  if (modeName === 'pixiv-monthly') return 'monthly';
  if (modeName === 'pixiv-ai' || modeName === 'pixiv-r18-ai') return 'ai';
  return 'daily';
}
function pixivModeForKind(kind = 'daily', rating = pixivRating) {
  const safeMap = { daily: 'pixiv-daily', weekly: 'pixiv-weekly', monthly: 'pixiv-monthly', ai: 'pixiv-ai' };
  // Pixiv R18 currently exposes today / this week / AI only in this UI.
  // There is no R18 monthly button, so switching from the safe monthly board
  // must land on today's R18 board instead of silently reusing the weekly one.
  const r18Map = { daily: 'pixiv-r18-daily', weekly: 'pixiv-r18-weekly', monthly: 'pixiv-r18-daily', ai: 'pixiv-r18-ai' };
  return (rating === 'r18' ? r18Map : safeMap)[kind] || (rating === 'r18' ? r18Map.daily : safeMap.daily);
}
function pixivRatingMode() {
  return pixivRating === 'r18' ? 'r18' : 'safe';
}


let station = localStorage.getItem('dflow_station') || 'dflow';
let pixivRating = localStorage.getItem(PIXIV_RATING_KEY) === 'r18' ? 'r18' : 'safe';
let dflowRatings = new Set(['g', 's', 'q', 'e']);
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
let wordedGalleryRequest = 0;
let galleryRenderRequest = 0;
let favoriteStateRevision = 0;
let sharedFavoritesPulling = false;
let lastRequestFinishedAt = 0;
let pendingRatingResults = new Map();
let currentPosts = [];
const viewCache = new Map();
const undoStack = [];
let undoing = false;
let shareSelectionMode = false;
const selectedShareKeys = new Set();
let pendingShareImport = null;

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
  state.ordered = false;
  gallery.classList.toggle('ordered-gallery', false);
  const count = innerWidth <= 760 ? Math.min(columnCount(), 2) : columnCount();
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
  return PIXIV_MODES.has(value);
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
      const effectiveDate = response.headers.get('X-Danbooru-Effective-Date');
      const fallbackKind = response.headers.get('X-Danbooru-Fallback');
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveDate || ''))) {
        Object.defineProperty(posts, 'effectiveDate', { value: effectiveDate, enumerable: false, configurable: true });
      }
      if (fallbackKind) Object.defineProperty(posts, 'fallbackKind', { value: fallbackKind, enumerable: false, configurable: true });
      if (url.startsWith('/api/pixiv/ranking')) {
        const effectiveDate = response.headers.get('X-Pixiv-Effective-Date');
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveDate || '')) && isPixivMode(mode)) {
          savePixivDate(mode, effectiveDate);
          updatePixivControls();
        }
        if (response.headers.get('X-Pixiv-Has-More') === 'false') {
          Object.defineProperty(posts, 'hasNextPage', {value:false});
        }
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
    throw Error(detail.message || detail.error || detail.detail || `请求失败 (${response.status})`);
  }
  throw Error('网络连接失败');
}
async function getPosts(tags, page, limit = 36, signal) {
  if (station === 'pflow' && !['favorites', 'metadata'].includes(mode)) {
    if (manualSearchTags) {
      const p = page || 1;
      const rating = encodeURIComponent(pixivRatingMode());
      return requestPosts(`/api/pixiv/search?word=${encodeURIComponent(manualSearchTags)}&page=${p}&rating=${rating}`, signal);
    }
    const pixMode = pixivModeMap[mode] || 'daily';
    const p = page || 1;
    const date = encodeURIComponent(pixivDate(mode));
    return requestPosts(`/api/pixiv/ranking?mode=${encodeURIComponent(pixMode)}&date=${date}&page=${p}`, signal);
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
function favoriteCacheSrc(id, version = '') {
  const suffix = version ? `?v=${encodeURIComponent(String(version))}` : '';
  return `/api/reverse/image/${encodeURIComponent(String(id))}${suffix}`;
}
function wordedImageSrc(item) {
  if (!item?.imageExt) return '';
  return `/api/worded/images/${encodeURIComponent(String(item.id))}?v=${encodeURIComponent(String(item.imageExt))}`;
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
  // A PUT can stay in flight while a PATCH, another device pull, or a second
  // click changes the same collection.  Keep the local revision so a late PUT
  // response cannot restore an older favorite list (or its stale cache flags).
  const revision = ++favoriteStateRevision;
  favoriteCache = items;
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(items));
  updateFavoriteCount();
  for (const key of viewCache.keys()) if (key.startsWith('favorites|')) viewCache.delete(key);
  try {
    const response = await fetch('/api/favorites', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorites: items })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
    if (revision !== favoriteStateRevision) return;
    sharedUpdatedAt = result.updatedAt || sharedUpdatedAt;
    if (Array.isArray(result.favorites)) {
      favoriteCache = result.favorites;
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteCache));
      updateFavoriteCount();
    }
  } catch (error) {
    if (revision === favoriteStateRevision) toast(`收藏已保存在本机，局域网同步失败：${error.message}`);
  }
}
function inferredShareSource(item, kind = 'favorite') {
  const raw = String(item?.source || '').trim().toLowerCase();
  const id = String(item?.id || '');
  if (raw === 'local' || raw === 'manual' || raw === '手写' || id.startsWith('local_')) return 'local';
  if (raw === 'pixiv' || id.startsWith('px_')) return 'pixiv';
  // Standalone worded/hand-written cards live in the local data store and
  // usually have a UUID without a source field.  Never mislabel them as a
  // Danbooru post when exporting or importing a share file.
  if (kind === 'worded' && !item?.sourcePageUrl && !item?.sourceImageUrl && !item?.file_url && !item?.large_file_url) return 'local';
  return 'danbooru';
}
function shareSourceId(item, source = inferredShareSource(item)) {
  // A local card can carry a stale sourceId after it has been copied between
  // folders or imported from another device. Its local id is the only stable
  // identity; never let an old remote sourceId collapse two local cards.
  if (source === 'local') return String(item?.id || '');
  if (item?.sourceId) return String(item.sourceId);
  if (source === 'pixiv') return String(item?.pixiv_id || item?.id || '').replace(/^px_/, '').split('_')[0];
  return String(item?.id || '');
}
function shareIdentity(item, kind = 'favorite') {
  const source = inferredShareSource(item, kind);
  return `${source}:${shareSourceId(item, source)}`;
}
function findFavoriteForPost(post) {
  if (!post) return null;
  const identity = shareIdentity(post, 'favorite');
  return readFavorites().find(item => shareIdentity(item, 'favorite') === identity) || null;
}
function sharePromptFor(kind, item) {
  return String(kind === 'worded' ? (item?.positive || '') : (item?.prompt || ''));
}
function shareFolderFor(kind, item) {
  return kind === 'worded' ? (item?.folder || 'worded') : postFolder(item);
}
function sourcePageUrlFor(item, source = inferredShareSource(item)) {
  if (item?.sourcePageUrl) return String(item.sourcePageUrl);
  if (source === 'pixiv') {
    const id = item?.pixiv_id || String(item?.id || '').replace(/^px_/, '').split('_')[0];
    return id ? `https://www.pixiv.net/artworks/${encodeURIComponent(id)}` : '';
  }
  if (source === 'danbooru' && item?.id !== undefined && /^\d+$/.test(String(item.id))) {
    return `https://danbooru.donmai.us/posts/${String(item.id)}`;
  }
  return '';
}
function favoriteFields(post) {
  const source = inferredShareSource(post);
  return {
    id: post.id, source, sourceId: post.sourceId || shareSourceId(post, source), sourcePageUrl: post.sourcePageUrl || sourcePageUrlFor(post, source),
    sourceImageUrl: post.sourceImageUrl || post.file_url || post.large_file_url || '', sourcePreviewUrl: post.sourcePreviewUrl || post.preview_file_url || '',
    rating: post.rating, pixivRating: post.pixivRating || '', pixiv_id: post.pixiv_id || '', page_count: Number(post.page_count) || 1,
    title: post.title || '', author: post.author || post.user_name || '',
    preview_file_url: post.preview_file_url, large_file_url: post.large_file_url, file_url: post.file_url,
    image_width: post.image_width, image_height: post.image_height,
    tag_string_general: post.tag_string_general || '', tag_string_character: post.tag_string_character || '',
    tag_string_copyright: post.tag_string_copyright || '', created_at: post.created_at || '', completed: Boolean(post.completed),
    folder: postFolder(post), preset: post.preset || presetConfig.defaultExpansion, reversePreset:post.reversePreset || presetConfig.defaultReverse, autoEnabled: post.autoEnabled !== false,
    promptWrittenAt: post.promptWrittenAt || post.wordedAt || '', wordedAt: post.wordedAt || '', completedAt: post.completedAt || '', createdAt: post.createdAt || post.created_at || '', updatedAt: post.updatedAt || '', name: post.name || '',
    prompt: post.prompt || '', resolvedPreset: post.resolvedPreset || '', reverseStatus: post.reverseStatus || 'idle',
    reverseError: post.reverseError || '', cacheStatus: post.cacheStatus || 'idle', cacheFile: post.cacheFile || '', cacheError: post.cacheError || ''
  };
}
function safeShareUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    // Share files are portable files, not credential containers. Strip URL
    // credentials and common auth parameters before writing remote links.
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:api[_-]?key|access[_-]?token|auth(?:orization)?|cookie|key|login|password|session|token)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.href;
  } catch { return ''; }
}
function localShareImageUrl(kind, item) {
  if (kind === 'worded') return wordedImageSrc(item);
  return favoriteCacheSrc(item.id, item.cacheFile || item.updatedAt || '');
}
async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}
async function buildShareRecord(record) {
  const item = record.item;
  const kind = record.kind || 'favorite';
  const prompt = sharePromptFor(kind, item).trim();
  if (!prompt) throw Error('只有已经写入提示词的卡片才能分享');
  const source = inferredShareSource(item, kind);
  const sourceId = shareSourceId(item, source);
  const width = Number(kind === 'worded' ? item.width : item.image_width) || 0;
  const height = Number(kind === 'worded' ? item.height : item.image_height) || 0;
  const sourceImageUrl = safeShareUrl(item.sourceImageUrl || item.file_url || item.large_file_url);
  const sourcePreviewUrl = safeShareUrl(item.sourcePreviewUrl || item.preview_file_url);
  const share = {
    id: String(item.id || ''), source, sourceId, sourcePageUrl: safeShareUrl(sourcePageUrlFor(item, source)),
    sourceImageUrl, sourcePreviewUrl, previewImageUrl: sourcePreviewUrl, largeImageUrl: sourceImageUrl, fileImageUrl: sourceImageUrl,
    imageWidth: width, imageHeight: height, rating: item.rating || 'g', title: item.title || item.name || '',
    author: item.author || '', tags: [item.tag_string_general, item.tag_string_character, item.tag_string_copyright].filter(Boolean).join(' '),
    prompt, summary: item.summary || '', preset: item.preset || '', resolvedPreset: item.resolvedPreset || ''
  };
  if (source === 'local') {
    const localUrl = localShareImageUrl(kind, item);
    if (!localUrl) throw Error('本地卡片没有可读取的图片缓存');
    const response = await fetch(localUrl, { cache: 'no-store' });
    if (!response.ok) throw Error(`读取本地图片失败：HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw Error('本地缓存不是有效图片');
    if (blob.size > 80 * 1024 * 1024) throw Error('本地图片超过 80 MB，无法写入分享文件');
    const dataUrl = await blobToDataUrl(blob);
    share.image = { name: `${sourceId || item.id}.png`, mime: blob.type, width, height, dataUrl };
  }
  return share;
}
function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw Error('分享文件中的本地图片格式无效');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], {type: match[1].toLowerCase()});
}
function dataUrlBytes(dataUrl) {
  const value = String(dataUrl || '');
  const comma = value.indexOf(',');
  return comma < 0 ? 0 : Math.floor((value.length - comma - 1) * 3 / 4);
}
function normalizeShareImportItem(raw, index) {
  if (!raw || typeof raw !== 'object') throw Error(`第 ${index + 1} 项不是对象`);
  const id = String(raw.id || raw.sourceId || '').trim();
  const sourceValue = String(raw.source || '').toLowerCase();
  const source = ['danbooru', 'pixiv', 'local'].includes(sourceValue)
    ? sourceValue
    : (id.startsWith('px_') ? 'pixiv' : id.startsWith('local_') ? 'local' : 'danbooru');
  const prompt = String(raw.prompt || '').trim();
  if (!prompt) throw Error(`第 ${index + 1} 项没有提示词`);
  if (prompt.length > 100000) throw Error(`第 ${index + 1} 项提示词过长`);
  const image = raw.image && typeof raw.image === 'object' ? raw.image : null;
  const dataUrl = image?.dataUrl ? String(image.dataUrl) : '';
  if (source === 'local' && (!dataUrl || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl))) {
    throw Error(`第 ${index + 1} 项是本地图片，但没有有效内嵌图片`);
  }
  if (dataUrl && dataUrlBytes(dataUrl) > 80 * 1024 * 1024) throw Error(`第 ${index + 1} 项图片超过 80 MB`);
  const sourceImageUrl = safeShareUrl(raw.sourceImageUrl || raw.largeImageUrl || raw.fileImageUrl);
  const sourcePreviewUrl = safeShareUrl(raw.sourcePreviewUrl || raw.previewImageUrl);
  const sourcePageUrl = safeShareUrl(raw.sourcePageUrl);
  if (source !== 'local' && !sourceImageUrl && !sourcePreviewUrl && !dataUrl) {
    throw Error(`第 ${index + 1} 项缺少可读取的图片地址`);
  }
  if (source === 'danbooru' && id && !/^\d+$/.test(id) && !/^\d+$/.test(String(raw.sourceId || ''))) {
    throw Error(`第 ${index + 1} 项的 Danbooru ID 无效`);
  }
  return {
    id, source, sourceId: String(raw.sourceId || (source === 'pixiv' ? String(raw.pixiv_id || id).replace(/^px_/, '').split('_')[0] : id)),
    sourcePageUrl, sourceImageUrl, sourcePreviewUrl, previewImageUrl: sourcePreviewUrl, largeImageUrl: sourceImageUrl, fileImageUrl: sourceImageUrl,
    imageWidth: Math.max(0, Number(raw.imageWidth ?? image?.width) || 0), imageHeight: Math.max(0, Number(raw.imageHeight ?? image?.height) || 0),
    rating: String(raw.rating || 'g'), title: String(raw.title || '').slice(0, 300), author: String(raw.author || '').slice(0, 100),
    tags: String(raw.tags || ''), prompt, summary: String(raw.summary || '').slice(0, 500), preset: String(raw.preset || ''),
    resolvedPreset: String(raw.resolvedPreset || ''), pixivId: String(raw.pixiv_id || (source === 'pixiv' ? raw.sourceId || id : '')), image: dataUrl ? {
      name: String(image?.name || `${id || 'shared'}.png`).replace(/[/\\]/g, '_').slice(0, 120), mime: String(image?.mime || 'image/png'),
      width: Number(image?.width) || 0, height: Number(image?.height) || 0, dataUrl
    } : null
  };
}
function registerShareCard(card, item, kind = 'favorite') {
  const prompt = sharePromptFor(kind, item);
  const key = `${kind}:${shareIdentity(item, kind)}`;
  card.dataset.shareKey = key;
  card._shareRecord = { kind, item };
  card.classList.toggle('share-selectable', mode === 'favorites' && Boolean(prompt.trim()));
  card.classList.toggle('share-selected', selectedShareKeys.has(key));
  card.addEventListener('click', event => {
    if (!shareSelectionMode || !card.classList.contains('share-selectable')) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button,select,input,textarea,a')) return;
    event.preventDefault();
    event.stopPropagation();
    toggleShareCardSelection(card);
  }, true);
}
function toggleShareCardSelection(card) {
  const key = card?.dataset.shareKey;
  if (!key || !card.classList.contains('share-selectable')) return;
  if (selectedShareKeys.has(key)) selectedShareKeys.delete(key);
  else selectedShareKeys.add(key);
  card.classList.toggle('share-selected', selectedShareKeys.has(key));
  updateShareActions();
}
function selectedShareRecords() {
  const records = [];
  const liveKeys = new Set();
  gallery.querySelectorAll('.share-selectable[data-share-key]').forEach(card => {
    const key = card.dataset.shareKey;
    liveKeys.add(key);
    if (selectedShareKeys.has(key) && card._shareRecord) records.push(card._shareRecord);
  });
  for (const key of selectedShareKeys) if (!liveKeys.has(key)) selectedShareKeys.delete(key);
  return records;
}
function updateShareActions() {
  const select = document.querySelector('#batchSelect');
  const del = document.querySelector('#batchDelete');
  const share = document.querySelector('#batchShare');
  const active = mode === 'favorites' && ['original', 'pending', 'worded', 'completed'].includes(favoriteFolder);
  if (select) { select.hidden = !active; select.textContent = shareSelectionMode ? '退出选择' : '批量选择'; select.setAttribute('aria-pressed', String(shareSelectionMode)); }
  if (del) del.hidden = !active || !shareSelectionMode;
  if (share) {
    const count = selectedShareKeys.size;
    share.hidden = !active || !shareSelectionMode;
    share.disabled = count === 0;
    share.textContent = count ? `分享 (${count})` : '分享';
  }
}
function enterShareSelection() {
  if (mode !== 'favorites') return;
  shareSelectionMode = true;
  updateShareActions();
}
function exitShareSelection() {
  shareSelectionMode = false;
  selectedShareKeys.clear();
  gallery.querySelectorAll('.share-selected').forEach(card => card.classList.remove('share-selected'));
  updateShareActions();
}

function shareDownloadName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `dflow-share-${stamp}.dflow-share.json`;
}
function sharePreviewSrc(item) {
  if (item?.image?.dataUrl) return item.image.dataUrl;
  // Import previews should use the site's preview-sized URL first. Loading a
  // shared original/large URL here makes the preview dialog unnecessarily
  // slow and can trigger a second CDN request before the user confirms.
  const source = item?.sourcePreviewUrl || item?.sourceImageUrl;
  return source ? imageSrc(source) : '';
}
async function exportShareFile(records) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  if (!list.length) { toast('没有可分享的提示词卡片'); return false; }
  const button = document.querySelector('#batchShare');
  if (button) { button.disabled = true; button.textContent = '正在整理…'; }
  try {
    const items = [];
    for (let index = 0; index < list.length; index++) {
      toast(list.length > 1 ? `正在整理分享图片 ${index + 1}/${list.length}…` : '正在整理分享图片…');
      items.push(await buildShareRecord(list[index]));
    }
    const payload = {
      format: 'dflow-share',
      version: 1,
      createdAt: new Date().toISOString(),
      items
    };
    const serialized = JSON.stringify(payload, null, 2);
    // Keep a batch export importable on the other side. Local images are
    // embedded in the JSON, so fail before downloading a file larger than the
    // import safety limit instead of producing an unusable partial share.
    if (new Blob([serialized]).size > 240 * 1024 * 1024) {
      throw Error('分享文件预计超过 240 MB，请分批分享');
    }
    const blob = new Blob([serialized], {type: 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = shareDownloadName();
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已导出 ${items.length} 张提示词卡片`);
    return true;
  } catch (error) {
    toast(`导出分享失败：${error.message || '未知错误'}`);
    return false;
  } finally {
    if (button) { button.disabled = false; updateShareActions(); }
  }
}
function updateShareImportSummary(message = '') {
  const summary = document.querySelector('#shareImportSummary');
  const status = document.querySelector('#shareImportStatus');
  const items = pendingShareImport?.items || [];
  const selected = pendingShareImport?.selected || new Set();
  if (summary) summary.textContent = `共 ${items.length} 张，已选择 ${selected.size} 张；确认后会加入本地收藏的“有词区”。`;
  if (status && message) status.textContent = message;
  const confirmButton = document.querySelector('#shareImportConfirm');
  if (confirmButton) confirmButton.disabled = selected.size === 0;
}
function closeShareImport() {
  pendingShareImport = null;
  const dialog = document.querySelector('#shareImportDialog');
  if (dialog?.open) dialog.close();
  const input = document.querySelector('#shareFileInput');
  if (input) input.value = '';
}
function showShareImportPreview(items, warning = '') {
  pendingShareImport = {items, selected: new Set(items.map((_, index) => index))};
  const container = document.querySelector('#shareImportItems');
  if (!container) return;
  container.replaceChildren();
  items.forEach((item, index) => {
    const row = document.createElement('label');
    row.className = 'share-import-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.index = String(index);
    checkbox.setAttribute('aria-label', `选择第 ${index + 1} 张`);
    checkbox.onchange = () => {
      if (checkbox.checked) pendingShareImport?.selected.add(index);
      else pendingShareImport?.selected.delete(index);
      updateShareImportSummary();
    };
    const preview = document.createElement('img');
    preview.loading = 'lazy';
    preview.alt = item.title || `${item.source} ${item.sourceId}`;
    const previewUrl = sharePreviewSrc(item);
    if (previewUrl) {
      preview.src = previewUrl;
      preview.onerror = () => { preview.removeAttribute('src'); preview.alt = '图片预览加载失败'; };
    }
    const copy = document.createElement('div');
    copy.className = 'share-import-copy';
    const title = document.createElement('strong');
    title.textContent = `${item.source === 'pixiv' ? 'P' : item.source === 'local' ? '本地' : 'D'} · ${item.title || item.sourceId || '无标题'}`;
    const prompt = document.createElement('p');
    prompt.textContent = item.prompt;
    const source = document.createElement('span');
    source.className = 'share-import-source';
    source.textContent = item.sourcePageUrl || `${item.source} / ${item.sourceId || item.id}`;
    copy.append(title, prompt, source);
    row.append(checkbox, preview, copy);
    container.append(row);
  });
  updateShareImportSummary(warning);
  const dialog = document.querySelector('#shareImportDialog');
  if (dialog && !dialog.open) {
    try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
  }
}
async function importShareFile(file) {
  if (!file) return;
  try {
    if (file.size > 250 * 1024 * 1024) throw Error('分享文件超过 250 MB');
    const payload = JSON.parse(await file.text());
    if (payload?.format !== 'dflow-share' || Number(payload?.version) !== 1) throw Error('不是受支持的 DFlow 分享文件');
    if (!Array.isArray(payload.items) || !payload.items.length) throw Error('分享文件里没有卡片');
    if (payload.items.length > 100) throw Error('单个分享文件最多导入 100 张卡片');
    const items = [];
    const errors = [];
    payload.items.forEach((raw, index) => {
      try { items.push(normalizeShareImportItem(raw, index)); }
      catch (error) { errors.push(error.message); }
    });
    if (!items.length) throw Error(errors.join('；') || '没有可导入的卡片');
    showShareImportPreview(items, errors.length ? `已忽略 ${errors.length} 项：${errors.join('；')}` : '');
  } catch (error) {
    toast(`读取分享文件失败：${error.message || '文件格式无效'}`);
  }
}
function importedFavoriteFromShare(item, now) {
  const source = item.source;
  const sourceId = String(item.sourceId || item.id || '').trim();
  const id = source === 'local'
    ? `local_${(globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '_')}`
    : source === 'pixiv' ? `px_${sourceId}_p0` : sourceId;
  const remoteImage = item.sourceImageUrl || '';
  const remotePreview = item.sourcePreviewUrl || remoteImage;
  const isPixivR18 = source === 'pixiv' && ['r18', 'e'].includes(String(item.rating || '').toLowerCase());
  return {
    id, source, sourceId, sourcePageUrl: item.sourcePageUrl || '', sourceImageUrl: remoteImage, sourcePreviewUrl: remotePreview,
    pixiv_id: source === 'pixiv' ? sourceId : '', pixivRating: source === 'pixiv' ? (isPixivR18 ? 'r18' : 'safe') : '',
    page_count: 1, title: item.title || '', author: item.author || '', rating: isPixivR18 ? 'e' : (item.rating || 'g'),
    preview_file_url: remotePreview, large_file_url: remoteImage, file_url: remoteImage,
    image_width: item.imageWidth || item.image?.width || 0, image_height: item.imageHeight || item.image?.height || 0,
    tag_string_general: item.tags || '', tag_string_character: '', tag_string_copyright: '', created_at: now,
    completed: false, folder: 'worded', preset: item.preset || presetConfig.defaultExpansion,
    reversePreset: presetConfig.defaultReverse, autoEnabled: false, queueOrder: 0, prompt: item.prompt,
    summary: item.summary || '', resolvedPreset: item.resolvedPreset || '', reverseStatus: 'idle', reverseError: '',
    cacheStatus: 'idle', cacheFile: '', cacheError: '', promptWrittenAt: now, wordedAt: now, completedAt: '', createdAt: now, updatedAt: now
  };
}
async function uploadImportedShareImage(favorite, image) {
  if (!image?.dataUrl) return;
  const blob = dataUrlToBlob(image.dataUrl);
  const response = await fetch(`/api/favorites/${encodeURIComponent(String(favorite.id))}/image?width=${encodeURIComponent(image.width || favorite.image_width || 0)}&height=${encodeURIComponent(image.height || favorite.image_height || 0)}`, {
    method: 'PUT', headers: {'Content-Type': blob.type}, body: blob
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  const index = favoriteCache.findIndex(item => String(item.id) === String(favorite.id));
  if (index >= 0) favoriteCache[index] = result.favorite || {...favoriteCache[index], cacheStatus: 'ready'};
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteCache));
  updateFavoriteCount();
}
async function confirmShareImport() {
  const importState = pendingShareImport;
  if (!importState) return;
  const selected = importState.items.filter((_, index) => importState.selected.has(index));
  if (!selected.length) { updateShareImportSummary('至少选择一张卡片'); return; }
  const button = document.querySelector('#shareImportConfirm');
  if (button) { button.disabled = true; button.textContent = '正在导入…'; }
  try {
    const now = new Date().toISOString();
    const existing = new Set(readFavorites().map(item => shareIdentity(item, 'favorite')));
    const favorites = [];
    const importPairs = [];
    const skipped = [];
    for (const item of selected) {
      const incomingIdentity = `${item.source}:${item.sourceId}`;
      if (item.source !== 'local' && existing.has(incomingIdentity)) { skipped.push(item); continue; }
      const favorite = importedFavoriteFromShare(item, now);
      if (item.source !== 'local' && existing.has(shareIdentity(favorite, 'favorite'))) { skipped.push(item); continue; }
      favorites.push(favorite);
      importPairs.push({ favorite, shareItem: item });
      existing.add(shareIdentity(favorite, 'favorite'));
    }
    if (!favorites.length) throw Error('选择的卡片都已经在本地收藏中');
    await saveFavorites([...readFavorites(), ...favorites]);
    const uploadErrors = [];
    for (const pair of importPairs) {
      if (pair.shareItem.source !== 'local') continue;
      try { await uploadImportedShareImage(pair.favorite, pair.shareItem.image); }
      catch (error) { uploadErrors.push(`${pair.favorite.title || pair.favorite.id}：${error.message}`); }
    }
    closeShareImport();
    exitShareSelection();
    mode = 'favorites';
    activateButton(document.querySelector('[data-mode="favorites"]'));
    document.querySelector('#favoriteFolders')?.classList.remove('hidden');
    favoriteFolder = 'worded';
    document.querySelectorAll('#favoriteFolders [data-folder]').forEach(item => item.classList.toggle('active', item.dataset.folder === 'worded'));
    refreshFavoriteGallery(false);
    const suffix = skipped.length ? `，跳过重复 ${skipped.length} 张` : '';
    toast(uploadErrors.length ? `已导入 ${favorites.length} 张；${uploadErrors.length} 张图片上传失败` : `已导入 ${favorites.length} 张到有词区${suffix}`);
  } catch (error) {
    updateShareImportSummary(`导入失败：${error.message}`);
    if (button) { button.disabled = false; button.textContent = '确认加入收藏'; }
  }
}
async function deleteSelectedShareCards() {
  const records = selectedShareRecords();
  if (!records.length) { toast('请先点击卡片选择要删除的内容'); return; }
  if (!confirm(`确定删除选中的 ${records.length} 张提示词卡片？本地图片缓存也会删除。`)) return;
  const worded = records.filter(record => record.kind === 'worded');
  const favorites = records.filter(record => record.kind === 'favorite');
  const errors = [];
  for (const record of worded) {
    try {
      const response = await fetch(`/api/worded/entries/${encodeURIComponent(String(record.item.id))}`, {method: 'DELETE'});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
    } catch (error) { errors.push(error.message); }
  }
  if (favorites.length) {
    const identities = new Set(favorites.map(record => shareIdentity(record.item, 'favorite')));
    const remaining = readFavorites().filter(item => !identities.has(shareIdentity(item, 'favorite')));
    await saveFavorites(remaining);
  }
  exitShareSelection();
  if (mode === 'favorites') refreshFavoriteGallery(true);
  toast(errors.length ? `已删除部分卡片，${errors.length} 张失败：${errors[0]}` : `已删除 ${records.length} 张卡片`);
}
function isFavorite(value) {
  if (value && typeof value === 'object') return Boolean(findFavoriteForPost(value));
  return readFavorites().some(item => String(item.id) === String(value));
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
  const retry = document.querySelector('#retryMissingCache');
  if (retry) {
    const missing = items.filter(item => item.cacheStatus !== 'ready').length;
    retry.textContent = `重新下载未缓存${missing ? `（${missing}）` : ''}`;
    retry.disabled = retryCacheBusy || missing === 0;
    retry.title = missing ? `重新下载 ${missing} 张没有高清缓存的图片` : '当前没有缺失高清缓存的图片';
  }
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
function sortableTime(value) {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
const MAX_DISPLAY_QUEUE_ORDER = 1000000;
function displayQueueOrder(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_DISPLAY_QUEUE_ORDER ? number : null;
}
function pendingQueueActive(item) {
  return item?.autoEnabled !== false;
}
function comparePendingRows(a, b) {
  const aActive = pendingQueueActive(a.value);
  const bActive = pendingQueueActive(b.value);
  if (aActive !== bActive) return Number(!aActive) - Number(!bActive);
  if (aActive) {
    return (displayQueueOrder(a.value.queueOrder) ?? Infinity) - (displayQueueOrder(b.value.queueOrder) ?? Infinity) || a.index - b.index;
  }
  return a.index - b.index;
}
function galleryItemTime(item, folder) {
  // Worded keeps prompt chronology; completed keeps the release chronology.
  const values = folder === 'completed'
    ? [item.completedAt, item.promptWrittenAt, item.wordedAt, item.createdAt, item.created_at]
    : [item.promptWrittenAt, item.wordedAt, item.createdAt, item.created_at];
  return values.map(sortableTime).find(value => value > 0) || 0;
}
function galleryOrientation(item) {
  const width = Number(item.image_width ?? item.width ?? 0);
  const height = Number(item.image_height ?? item.height ?? 0);
  return width > height ? 1 : 0;
}
function compareGalleryItems(a, b, folder, indexA = 0, indexB = 0) {
  return galleryOrientation(b) - galleryOrientation(a) ||
    galleryItemTime(b, folder) - galleryItemTime(a, folder) ||
    indexA - indexB;
}
function favoriteVisibleItems() {
  return readFavorites()
    .filter(item => postFolder(item) === favoriteFolder)
    .filter(favoriteMatches)
    .sort((a, b) => favoriteFolder === 'pending'
      ? Number(a.autoEnabled === false) - Number(b.autoEnabled === false) ||
        ((a.queueOrder || 999999) - (b.queueOrder || 999999))
      : compareGalleryItems(a, b, favoriteFolder));
}
function invalidateGalleryRequests() {
  clearTimeout(nextLoadTimer);
  requestController?.abort();
  requestController = null;
  generation++;
  galleryRenderRequest++;
  wordedGalleryRequest++;
  loading = false;
  pendingRatingResults.clear();
}
function refreshFavoriteGallery(preserveScroll = true) {
  if (mode !== 'favorites') return;
  // A folder refresh is authoritative. Invalidate both the normal API load
  // and the special worded-gallery request so a late response cannot restore
  // the previous card renderer.
  invalidateGalleryRequests();
  const requestedFolder = favoriteFolder;
  const renderId = galleryRenderRequest;
  if (['worded','pending','completed'].includes(requestedFolder)) {
    loadWordedGallery(preserveScroll, renderId);
    return;
  }
  const top = scrollY;
  const posts = favoriteVisibleItems();
  if (renderId !== galleryRenderRequest || mode !== 'favorites' || favoriteFolder !== requestedFolder) return;
  resetColumns();
  currentPosts = posts.slice();
  render(posts, {favoriteFolder: requestedFolder});
  ended = true;
  sentinel.classList.remove('loading');
  sentinel.classList.add('done');
  statusEl.textContent = posts.length ? `显示 ${posts.length} 个${folderName[requestedFolder]}` : `还没有${folderName[requestedFolder]}图片`;
  if (preserveScroll) requestAnimationFrame(() => {
    if (renderId === galleryRenderRequest && mode === 'favorites' && favoriteFolder === requestedFolder) scrollTo({ top });
  });
}
function updateVisibleFolderStatus() {
  const count = gallery.querySelectorAll('.card, .reverse-card').length;
  statusEl.textContent = count ? `显示 ${count} 个${folderName[favoriteFolder]}` : `还没有${folderName[favoriteFolder]}图片`;
  sentinel.classList.remove('loading');
  sentinel.classList.add('done');
}
function adjustWordedCount(delta) {
  const count = document.querySelector('#wordedCount');
  if (!count || !delta) return;
  count.textContent = String(Math.max(0, (Number(count.textContent) || 0) + delta));
}
function removeVisibleCard(id) {
  const top = scrollY;
  const escapedId = CSS.escape(String(id));
  const card = document.querySelector(
    `[data-completed-id="${escapedId}"], [data-reverse-id="${escapedId}"], [data-favorite-id="${escapedId}"]`
  )?.closest('.card, .reverse-card');
  if (!card) {
    // A card missing from the DOM means the view is already stale; recover once
    // instead of silently leaving a moved item visible.
    if (mode === 'favorites') refreshFavoriteGallery(true);
    return;
  }
  card.remove();
  currentPosts = currentPosts.filter(post => String(post.id) !== String(id));

  // Ordered worded/completed galleries can reflow in place. Removing one grid
  // child automatically fills the gap and keeps every other image element,
  // scroll position, and decoded bitmap alive.
  if (state.ordered) {
    updateVisibleFolderStatus();
    requestAnimationFrame(() => scrollTo({ top }));
    return;
  }

  // Pending combines favorite cards and worded entries; its queue order needs a
  // fresh merge after a removal. The user-facing no-refresh path is for the
  // ordered worded/completed folders above.
  if (favoriteFolder === 'pending') {
    refreshFavoriteGallery(true);
    return;
  }

  const posts = favoriteVisibleItems();
  const cards = new Map([...gallery.querySelectorAll('.card, .reverse-card')].map(node =>
    [String(node.dataset.reverseId || node.querySelector('[data-favorite-id]')?.dataset.favoriteId), node]));
  if (posts.some(post => !cards.has(String(post.id)))) { refreshFavoriteGallery(true); return; }
  state.heights = state.columns.map(() => 0);
  for (const post of posts) {
    const node = cards.get(String(post.id));
    if (!node) continue;
    const index = state.heights.indexOf(Math.min(...state.heights));
    state.columns[index].append(node);
    state.heights[index] += favoriteFolder === 'original' ? (post.image_height || 1) / (post.image_width || 1) + .03 : 1;
  }
  updateVisibleFolderStatus();
  requestAnimationFrame(() => scrollTo({ top }));
}
async function patchFavorite(id, changes) {
  const revision = ++favoriteStateRevision;
  const response = await fetch(`/api/favorites/${encodeURIComponent(id)}`, {
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(changes)
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  // Do not let an older PATCH response overwrite a newer local operation.  The
  // caller still receives the current local item, so its card cannot regress.
  if (revision !== favoriteStateRevision) {
    return favoriteCache.find(item => String(item.id) === String(id)) || result.favorite;
  }
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
async function patchWordedState(id, changes) {
  const response = await fetch(`/api/worded/state/${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(changes || {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  return result.entry || result.item || result;
}
async function moveFavorite(post, target) {
  // Invalidate any in-flight folder read before changing the source of truth.
  // Its late response must not repaint the card in the previous UI shape.
  invalidateGalleryRequests();
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
  invalidateGalleryRequests();
  const items = readFavorites();
  const identity = shareIdentity(post, 'favorite');
  const index = items.findIndex(item => shareIdentity(item, 'favorite') === identity);
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
      const currentIndex = items.findIndex(item => shareIdentity(item, 'favorite') === shareIdentity(action.post, 'favorite'));
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
  // Local collections are shared by Dflow and Pflow.  Pflow's radio values
  // are `safe`/`r18`, while Danbooru favorites store `g`/`s`/`q`/`e`;
  // applying the Pflow radio to every local card makes the whole collection
  // look empty. Keep Dflow's four-way filter for Danbooru views, and only
  // apply the Pflow age switch to Pixiv favorites.
  const isPixivFavorite = post?.source === 'pixiv' || String(post?.id || '').startsWith('px_');
  if (station === 'dflow') {
    if (!ratingChecks().includes(post.rating)) return false;
  } else if (station === 'pflow' && isPixivFavorite) {
    const isR18 = String(post.rating || '').toLowerCase() === 'e' || post.pixivRating === 'r18';
    if (pixivRating === 'r18' ? !isR18 : isR18) return false;
  }
  const wanted = [...selectedPopularTags];
  if (manualSearchTags) wanted.push(...manualSearchTags.split(/\s+/).filter(tag => !tag.includes(':')));
  if (!wanted.length) return true;
  const all = `${post.tag_string_general || ''} ${post.tag_string_character || ''} ${post.tag_string_copyright || ''} ${post.tag_string || ''}`.split(/\s+/);
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
    exitShareSelection();
    clearTimeout(nextLoadTimer);
    requestController?.abort();
    requestController = null;
    generation++;
    ++galleryRenderRequest;
    ++wordedGalleryRequest;
    loading = false;
    cursor = '';
    pageNo = 1;
    ended = false;
    loadFailed = false;
    currentPosts = [];
    pendingRatingResults.clear();
    resetColumns();
    scrollTo({ top: 0 });
  }
  const run = generation;
  const requestedMode = mode;
  const requestedStation = station;
  const requestedFolder = favoriteFolder;
  document.querySelector('#metadataUpload').hidden = mode !== 'metadata';
  if (mode === 'metadata') { await loadMetadataGallery(); return; }
  if (mode === 'favorites' && ['worded','pending','completed'].includes(favoriteFolder)) { await loadWordedGallery(); return; }
  if (mode === 'favorites') {
    const posts = favoriteVisibleItems();
    currentPosts = posts.slice();
    render(posts, {favoriteFolder: requestedFolder});
    ended = true;
    sentinel.classList.remove('loading');
    sentinel.classList.add('done');
    statusEl.textContent = posts.length ? `显示 ${posts.length} 个${folderName[requestedFolder]}` : `还没有${folderName[requestedFolder]}图片`;
    return;
  }
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
           if (run !== generation || mode !== requestedMode || station !== requestedStation || favoriteFolder !== requestedFolder) return;
          pendingRatingResults.set(rating, posts);
        }
        results.push(pendingRatingResults.get(rating));
      }
    }
    const popularFallbackDate = station === 'dflow' && mode === 'popular-day'
      ? [...new Set(results.map(batch => batch?.effectiveDate).filter(Boolean))][0] || ''
      : '';
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
    } else if (pixivRatingMode() === 'r18') {
      // Pixiv has two buckets in this UI. The ranking/search endpoint is also
      // asked for the matching bucket, but keep a hard client-side guard so a
      // mixed upstream response cannot leak works into the wrong view.
      posts = posts.filter(post => post.rating === 'e');
    } else {
      posts = posts.filter(post => post.rating !== 'e');
    }
    if (mode === 'viewed') posts = posts.filter(favoriteMatches);
    posts = posts.filter(post => post.preview_file_url || post.large_file_url || post.file_url);
    if (mode === 'latest') posts.sort((a, b) => b.id - a.id);
    if (run !== generation || mode !== requestedMode || station !== requestedStation || favoriteFolder !== requestedFolder) return;
    if (!posts.length) {
      ended = true;
      statusEl.textContent = popularFallbackDate
        ? `今日榜暂无数据，当前显示 ${popularFallbackDate} 日榜`
        : receivedCount ? `接口返回 ${receivedCount} 张，但没有可显示的图片` : (station === 'pflow' && !manualSearchTags ? 'Pixiv 榜单已到底' : '暂时没有更多图片');
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
      statusEl.textContent = popularFallbackDate
        ? `今日榜暂无数据，当前显示 ${popularFallbackDate} 日榜；继续下滑加载`
        : '继续下滑加载';
    }
  } catch (error) {
    if (run !== generation || mode !== requestedMode || station !== requestedStation || favoriteFolder !== requestedFolder) return;
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
       if (!loadFailed && mode === requestedMode && station === requestedStation && favoriteFolder === requestedFolder) queueNextLoad();
    }
  }
}function render(posts, options = {}) {
  const renderFolder = options.favoriteFolder || favoriteFolder;
  gallery.classList.toggle('reverse-gallery', mode === 'favorites' && renderFolder !== 'original');
  for (const post of posts) {
    if (mode === 'favorites' && renderFolder !== 'original') {
      renderReverseCard(post, {kind: 'favorite', folder: renderFolder});
      continue;
    }
    const isFavoriteGallery = mode === 'favorites';
    const isOriginalFavorite = isFavoriteGallery && renderFolder === 'original';
    const card = document.createElement('article');
    card.className = 'card';
    if (isOriginalFavorite) card.dataset.favoriteId = String(post.id);

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
    img.alt = post.title || (isPixiv ? `Pixiv #${post.pixiv_id || post.id}` : `Danbooru #${post.id}`);

    const remoteSources = [...new Set([
      post.preview_file_url,
      post.large_file_url,
      post.file_url
    ].filter(Boolean).map(imageSrc).filter(Boolean))];
    let remoteIndex = 0;
    let selectedSource = '';
    const setImageSource = () => {
      const useCache = isOriginalFavorite && post.cacheStatus === 'ready';
      const nextSource = useCache
        ? favoriteCacheSrc(post.id, post.cacheFile || post.updatedAt || '')
        : (remoteSources[0] || '');
      if (nextSource === selectedSource) return;
      selectedSource = nextSource;
      remoteIndex = 0;
      img.dataset.fallback = '';
      img.dataset.cacheReady = useCache ? '1' : '';
      img.dataset.cacheAttempt = useCache ? '1' : '0';
      if (!nextSource) { img.removeAttribute('src'); return; }
      const resolved = new URL(nextSource, document.baseURI).href;
      if (img.src !== resolved) img.src = nextSource;
    };
    setImageSource();    img.addEventListener('load', () => { img.classList.add('loaded'); queueNextLoad(); });
    img.addEventListener('error', () => {
      // If the local file disappeared unexpectedly, keep the card usable from
      // the remote source while the server reconciles the cache state.
      if (img.dataset.cacheReady === '1') {
        img.dataset.cacheReady = '';
        remoteIndex = 0;
        if (remoteSources.length) {
          img.dataset.fallback = '1';
          // Remember that the displayed source is now the remote fallback.
          // Otherwise a later shared-state refresh can think the cache URL is
          // still selected and never try the repaired local file again.
          selectedSource = remoteSources[0];
          img.src = remoteSources[0];
        }
        return;
      }
      if (remoteIndex + 1 < remoteSources.length) {
        remoteIndex += 1;
        img.dataset.fallback = '1';
        selectedSource = remoteSources[remoteIndex];
        img.src = remoteSources[remoteIndex];
      }
    });

    const badge = document.createElement('span');
    badge.className = `badge rating-${post.rating || 'g'}`;
    badge.title = `${ratingNames[post.rating] || post.rating || '全年龄'} · ${post.image_width || '?'}×${post.image_height || '?'}`;

    const favoriteButton = document.createElement('button');
    favoriteButton.className = 'favorite-button';
    favoriteButton.dataset.favoriteId = post.id;
    favoriteButton.innerHTML = isFavorite(post) ? HEART_SVG : HEART_OUTLINE_SVG;
    favoriteButton.classList.toggle('active', isFavorite(post));
    favoriteButton.title = isFavorite(post) ? '取消收藏' : '加入本地收藏';
    favoriteButton.setAttribute('aria-label', favoriteButton.title);
    favoriteButton.onclick = event => {
      event.stopPropagation();
      toggleFavorite(post);
    };

    let cacheFailure = null;
    let retry = null;
    if (isFavoriteGallery) {
      // 1. Top-left: Source badge [D] or [P]
      const sourceBadge = document.createElement('span');
      sourceBadge.className = `source-badge ${isPixiv ? 'source-pixiv' : 'source-danbooru'}`;
      sourceBadge.textContent = isPixiv ? 'P' : 'D';
      sourceBadge.title = isPixiv ? '来源：Pixiv' : '来源：Danbooru';
      card.append(sourceBadge, badge);

      cacheFailure = document.createElement('span');
      cacheFailure.className = 'cache-failure-label';
      cacheFailure.textContent = '失败';
      cacheFailure.hidden = post.cacheStatus !== 'error';
      cacheFailure.title = post.cacheError || '高清缓存失败';
      card.append(cacheFailure);

      retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'cache-retry-button';
      retry.textContent = post.cacheStatus === 'loading' ? '下载中…' : '重新下载';
      retry.title = '重新下载本地高清图';
      retry.disabled = post.cacheStatus === 'loading';
      retry.hidden = post.cacheStatus === 'ready';
      retry.onclick = async event => {
        event.stopPropagation(); retry.disabled = true;
        try {
          const updated = await patchFavorite(post.id, { retryCache: true });
          syncRenderedFavoriteCards([updated]);
        }
        catch (error) { retry.disabled = false; toast(`重新下载失败：${error.message}`); }
      };
      card.append(retry);

      // Bottom-right toolbar: [ AI ] -> [ 释放至已完成 ] -> [ ♥ 收藏 ]
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
      actions.append(completedButton, favoriteButton);
      card.append(img, actions);
    } else {
      // Online gallery: Top-right rating dot, bottom-right ONLY favorite button
      card.append(img, badge, favoriteButton);
    }

    card._updateFavoriteState = next => {
      if (!isOriginalFavorite) return;
      Object.assign(post, next || {});
      const cacheStatus = post.cacheStatus || 'idle';
      card.classList.toggle('cache-failed', cacheStatus === 'error');
      card.classList.toggle('cache-waiting', cacheStatus !== 'ready');
      if (cacheFailure) {
        cacheFailure.hidden = cacheStatus !== 'error';
        cacheFailure.title = post.cacheError || '高清缓存失败';
      }
      if (retry) {
        retry.hidden = cacheStatus === 'ready';
        retry.disabled = cacheStatus === 'loading';
        retry.textContent = cacheStatus === 'loading' ? '下载中…' : '重新下载';
      }
      setImageSource();
    };
    card._updateFavoriteState(post);
    card.oncontextmenu = event => showMenu(event, post);
    registerShareCard(card, post, 'favorite');
    card.addEventListener('click', () => openLightbox(post, card, isOriginalFavorite ? (img.currentSrc || img.src) : ''));
    appendRenderedCard(card, ratio + .03);
  }
}
function appendRenderedCard(card, weight = 1) {
  if (state.ordered) { gallery.append(card); return; }
  const index = state.heights.indexOf(Math.min(...state.heights));
  state.columns[index].append(card); state.heights[index] += weight;
}
function directButtonLabel(item) {
  if (item.directStatus === 'queued' || item.reverseStatus === 'direct-queued') return '重新唤起';
  if (item.directStatus === 'processing' || item.reverseStatus === 'processing') return '处理中';
  if (item.directStatus === 'failed') return '失败重试';
  return 'AI直推';
}
function updatePendingControls(item, controls) {
  if (!controls) return;
  const failed = item.reverseStatus === 'failed' || item.cacheStatus === 'error' || item.directStatus === 'failed';
  const done = Boolean(item.prompt || item.positive) && !failed && item.autoEnabled === false;
  const cacheReady = controls.kind === 'worded'
    ? Boolean(item.imageExt)
    : item.cacheStatus === 'ready';
  controls.card?.classList.toggle('uncached', !cacheReady);
  if (controls.image && cacheReady && !controls.image.dataset.cacheReady) {
    controls.image.dataset.cacheReady = '1';
    controls.image.dataset.fallback = '';
    controls.image.src = controls.kind === 'worded'
      ? `/api/worded/images/${encodeURIComponent(item.id)}?v=${encodeURIComponent(item.imageExt || 'cached')}`
      : `/api/reverse/image/${encodeURIComponent(item.id)}`;
  }
  if (controls.lamp) controls.lamp.className = `reverse-lamp ${failed ? 'red' : done ? 'green' : ''}`;
  if (controls.label) controls.label.textContent = failed ? '错误' : done ? '完成' : item.reverseStatus === 'processing' || item.directStatus === 'processing' ? '处理中' : '等待';
  if (controls.status) {
    controls.status.classList.toggle('retryable', failed);
    const dshDispatch = item.dshDispatch;
    controls.status.title = dshDispatch?.status === 'failed' ? `DSH 唤起失败：${dshDispatch.error || '点击 AI直推重试'}` :
      item.cacheStatus === 'error' ? `缓存错误：${item.cacheError || '点击重试'}` : item.reverseStatus === 'failed' || item.directStatus === 'failed' ? `反推错误：${item.reverseError || '点击重试'}` : !cacheReady ? '等待高清图缓存' : item.reverseStatus === 'processing' ? '正在反推' : item.directStatus === 'queued' ? '已入队，等待 DSH Agent 领取；点击按钮可重新唤起' : '等待反推';
  }
  if (controls.queueButton) {
    const order = displayQueueOrder(item.queueOrder) ?? displayQueueOrder(controls.displayQueueOrder);
    controls.queueButton.textContent = item.autoEnabled !== false ? String(order || '·') : '+';
    controls.queueButton.classList.toggle('active', item.autoEnabled !== false);
    controls.queueButton.setAttribute('aria-pressed', String(item.autoEnabled !== false));
  }
  if (controls.directButton) {
    controls.directButton.textContent = directButtonLabel(item);
    const processing = item.directStatus === 'processing' || item.reverseStatus === 'processing';
    controls.directButton.disabled = processing;
    controls.directButton.title = processing ? 'DSH Agent 正在处理这张图' : (item.directStatus === 'queued' || item.reverseStatus === 'direct-queued') ? '任务已入队，点击重新唤起已连接的 DSH 窗口' : '调用已连接的 DSH MCP Agent 直接反推这张图';
  }
}
async function runDirectReverse(item, controls) {
  if (controls.directButton?.disabled) return;
  const button = controls.directButton;
  button.disabled = true; button.textContent = '提交中';
  try {
    const response = await fetch(`/api/reverse/${encodeURIComponent(item.id)}/direct`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
    const request = result.request;
    if (result.item) Object.assign(item, result.item);
    if (!request?.id) throw Error('服务未返回直推任务编号');
    // The server also dispatches automatically. Calling the idempotent endpoint
    // here makes an already queued card recoverable after a page refresh or a
    // temporary DSH Bridge failure, without creating a second queue entry.
    if (request.status === 'queued') {
      const wake = await fetch(`/api/reverse/direct/${encodeURIComponent(request.id)}/dispatch`, { method: 'POST' });
      const wakeResult = await wake.json().catch(() => ({}));
      if (wakeResult.request) Object.assign(request, wakeResult.request);
      if (wakeResult.item) Object.assign(item, wakeResult.item);
      if (!wake.ok && wakeResult.error) toast(`DSH 唤起失败：${wakeResult.error}；任务仍保留在 MCP 队列`);
    }
    updatePendingControls(item, controls);
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      if (!['queued', 'processing'].includes(request.status)) break;
      await new Promise(resolve => setTimeout(resolve, 1400));
      const poll = await fetch(`/api/reverse/direct/${encodeURIComponent(request.id)}`, {cache:'no-store'});
      const state = await poll.json().catch(() => ({}));
      if (!poll.ok) throw Error(state.error || `HTTP ${poll.status}`);
      Object.assign(request, state.request || {});
      if (state.item) Object.assign(item, state.item);
      updatePendingControls(item, controls);
      if (request.status === 'completed') {
        toast('AI直推完成，已移入有词区');
        if (controls.kind === 'worded') loadWordedGallery(true);
        else refreshFavoriteGallery(true);
        return;
      }
      if (request.status === 'failed') {
        toast(`AI直推失败：${request.error || item.reverseError || '未知错误'}`);
        updatePendingControls(item, controls);
        return;
      }
      if (request.status === 'cancelled') return;
    }
    if (Date.now() >= deadline) toast('AI直推仍在后台处理中，可稍后查看状态');
  } catch (error) {
    button.disabled = false; button.textContent = '失败重试';
    toast(`AI直推失败：${error.message}`);
  } finally {
    if (document.body.contains(button)) updatePendingControls(item, controls);
  }
}
let currentTiltDeg = (() => {
  try {
    const saved = localStorage.getItem('dflowTiltSensitivity');
    if (saved !== null && !isNaN(Number(saved))) return Number(saved);
  } catch {}
  return 13;
})();

function attach3DCardTilt(card, cardWrapper) {
  let cachedRect = null;
  let rafId = null;

  card.addEventListener('mouseenter', () => {
    cachedRect = card.getBoundingClientRect();
  }, { passive: true });

  card.addEventListener('mousemove', (e) => {
    if (!cachedRect) cachedRect = card.getBoundingClientRect();
    if (rafId) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!cachedRect) return;
      if (currentTiltDeg <= 0) {
        cardWrapper.style.transform = 'rotateX(0deg) rotateY(0deg)';
        return;
      }
      const x = clientX - cachedRect.left;
      const y = clientY - cachedRect.top;
      const centerX = cachedRect.width / 2;
      const centerY = cachedRect.height / 2;
      const percentX = (x - centerX) / centerX;
      const percentY = (y - centerY) / centerY;
      const tiltX = -percentY * currentTiltDeg;
      const tiltY = percentX * currentTiltDeg;
      cardWrapper.style.transform = `rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg)`;
    });
  }, { passive: true });

  card.addEventListener('mouseleave', () => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    cachedRect = null;
    cardWrapper.style.transform = 'rotateX(0deg) rotateY(0deg)';
  }, { passive: true });
}

function attach3DCardFlip(card, cardInner) {
  let autoFlipTimer = null;
  const AUTO_FLIP_DELAY = 15000; // 自动翻回时间加长1/2（从10秒延长至15秒）

  function scheduleAutoFlip() {
    clearTimeout(autoFlipTimer);
    if (!cardInner.classList.contains('flipped')) return;
    autoFlipTimer = setTimeout(() => {
      // 若当前用户未处于悬停且焦点不在卡片内部，则平滑执行 3D 翻转动画返回正面
      if (cardInner.classList.contains('flipped') && !card.contains(document.activeElement) && !card.matches(':hover')) {
        cardInner.classList.remove('flipped');
      } else if (cardInner.classList.contains('flipped')) {
        scheduleAutoFlip();
      }
    }, AUTO_FLIP_DELAY);
  }

  function cancelAutoFlip() {
    clearTimeout(autoFlipTimer);
  }

  card._flipToggle = () => {
    const isFlipped = cardInner.classList.toggle('flipped');
    if (isFlipped) scheduleAutoFlip();
    else cancelAutoFlip();
  };

  card._flipToFront = () => {
    cancelAutoFlip();
    cardInner.classList.remove('flipped');
  };

  card.addEventListener('click', (e) => {
    if (e.target.closest('button, input, textarea, select, summary, details, [contenteditable="true"], .preset-option-item, .preset-bar-clickable, .param-item, a')) {
      scheduleAutoFlip();
      return;
    }
    card._flipToggle();
  });

  card.addEventListener('mouseenter', () => {
    cancelAutoFlip();
  }, { passive: true });

  card.addEventListener('mouseleave', () => {
    if (cardInner.classList.contains('flipped')) {
      scheduleAutoFlip();
    }
  }, { passive: true });
}

function renderReverseCard(item, options = {}) {
  const kind = options.kind || 'favorite';
  const isWordedEntry = kind === 'worded';
  const folder = options.folder || (isWordedEntry ? item.folder || 'worded' : favoriteFolder);
  const pending = folder === 'pending';
  const isWordedOrCompleted = folder === 'worded' || folder === 'completed';
  let prompt = String(isWordedEntry ? (item.positive || '') : (item.prompt || ''));
  const initialQueueOrder = displayQueueOrder(options.displayQueueOrder) ?? displayQueueOrder(item.queueOrder);
  const width = Math.max(1, Number(isWordedEntry ? item.width : item.image_width) || 1);
  const height = Math.max(1, Number(isWordedEntry ? item.height : item.image_height) || 1);
  const isLandscape = width > height;
  const cachedImage = isWordedEntry ? Boolean(item.imageExt) : item.cacheStatus === 'ready';
  const remoteSources = isWordedEntry ? [] : [...new Set([
    item.preview_file_url, item.large_file_url, item.file_url
  ].filter(Boolean).map(imageSrc).filter(Boolean))];
  const imageUrl = isWordedEntry
    ? wordedImageSrc(item)
    : cachedImage
      ? favoriteCacheSrc(item.id, item.cacheFile || item.updatedAt || '')
      : (remoteSources[0] || '');
  const hasImage = Boolean(imageUrl || remoteSources.length);

  const card = document.createElement('article');
  card.className = `reverse-card 3d-card ${isLandscape ? 'landscape' : 'portrait'} ${pending && !cachedImage ? 'uncached' : ''}${!hasImage ? ' text-only' : ''}${pending ? ' pending-card' : ' worded-card'}`;
  card.dataset.reverseId = String(item.id);
  if (isWordedEntry) card.dataset.wordedId = String(item.id);

  const cardWrapper = document.createElement('div');
  cardWrapper.className = 'card-wrapper';
  if (imageUrl) {
    cardWrapper.style.setProperty('--card-bg-img', `url("${imageUrl}")`);
  }

  const cardInner = document.createElement('div');
  cardInner.className = 'card-inner';

  const cardHolo = document.createElement('div');
  cardHolo.className = 'card-holo';
  cardHolo.style.display = 'none'; // 闪卡默认关闭

  // ---------------- FRONT FACE ----------------
  const frontFace = document.createElement('div');
  frontFace.className = `card-face card-front ${isLandscape ? 'landscape-front' : 'portrait-front'}`;

  const artworkContainer = document.createElement('div');
  artworkContainer.className = 'artwork-container';

  let sourceIndex = 0;
  const image = hasImage ? document.createElement('img') : null;
  if (image) {
    image.className = 'art-img';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.alt = item.name || `${isWordedEntry ? '提示词卡片' : 'Danbooru #'}${item.id}`;
    image.src = imageUrl || remoteSources[0] || '';
    if (width > 1 && height > 1) {
      image.style.aspectRatio = `${width} / ${height}`;
    }
    if (cachedImage) image.dataset.cacheReady = '1';
    image.onerror = () => {
      if (!isWordedEntry && sourceIndex + 1 < remoteSources.length) {
        sourceIndex += 1;
        image.dataset.fallback = '1';
        image.src = remoteSources[sourceIndex];
      }
    };
    image.ondblclick = (e) => {
      e.stopPropagation();
      openLightbox({...item, image_width: width, image_height: height}, card, image.currentSrc || image.src);
    };
    const specular = document.createElement('div');
    specular.className = 'art-specular';
    artworkContainer.append(image, specular);
  } else {
    const summary = document.createElement('span');
    summary.className = 'text-summary';
    summary.textContent = item.summary || prompt.slice(0, 30) || '暂无图片';
    artworkContainer.append(summary);
  }

  // Front UI strip (紧贴画芯，高斯模糊底色)
  const uiStrip = document.createElement('aside');
  uiStrip.className = `ui-strip blur-bg ${isLandscape ? 'horizontal-strip' : 'vertical-strip'}`;

  const patchState = changes => isWordedEntry
    ? patchWordedState(item.id, changes)
    : patchFavorite(item.id, changes);
  const refreshGallery = () => isWordedEntry ? loadWordedGallery(true) : refreshFavoriteGallery(true);
  const moveTo = target => isWordedEntry
    ? changeWordedFolder(item, target)
    : moveFavorite(item, target);

  const isPixiv = item.source === 'pixiv' || String(item.id).startsWith('px_');
  let pendingControls = null;

  if (pending) {
    // 待反推正面：[ ← ] 返回按钮
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'round-action-btn round-arrow-btn';
    backBtn.innerHTML = BACK_SVG;
    backBtn.title = isWordedEntry ? '返回有词区' : '返回原始收藏';
    backBtn.setAttribute('aria-label', backBtn.title);
    backBtn.onclick = event => { event.stopPropagation(); moveTo(isWordedEntry ? 'worded' : 'original'); };
    uiStrip.append(backBtn);

    // 待反推正面：[ ♥ ] 收藏按钮
    const heartBtn = document.createElement('button');
    heartBtn.type = 'button';
    heartBtn.className = 'round-action-btn round-heart-btn active';
    heartBtn.innerHTML = HEART_SVG;
    heartBtn.title = '取消本地收藏';
    heartBtn.setAttribute('aria-label', heartBtn.title);
    heartBtn.onclick = event => { event.stopPropagation(); toggleFavorite(item); };
    uiStrip.append(heartBtn);

    // 待反推正面：[ 🔍 HD ] 查看高清大图
    const hdBtn = document.createElement('button');
    hdBtn.type = 'button';
    hdBtn.className = 'round-action-btn round-hd-btn';
    hdBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`;
    hdBtn.title = '查看高清大图';
    hdBtn.setAttribute('aria-label', hdBtn.title);
    hdBtn.onclick = event => {
      event.stopPropagation();
      openLightbox({...item, image_width: width, image_height: height}, card, image?.currentSrc || image?.src || imageUrl);
    };
    uiStrip.append(hdBtn);

    // D / P 来源标识（点击翻面）
    const sourceBadge = document.createElement('div');
    sourceBadge.className = `source-badge-btn ${isPixiv ? 'source-pixiv' : 'source-danbooru'}`;
    sourceBadge.textContent = isPixiv ? 'P' : 'D';
    sourceBadge.title = `${isPixiv ? '来源：Pixiv' : '来源：Danbooru'} (点击翻面)`;
    sourceBadge.onclick = event => { event.stopPropagation(); if (card._flipToggle) card._flipToggle(); else cardInner.classList.toggle('flipped'); };
    uiStrip.append(sourceBadge);
  } else {
    // 有词区 / 已完成正面：[AI], [→], [♥], [🔍 HD]
    const aiBtn = document.createElement('button');
    aiBtn.type = 'button';
    aiBtn.className = 'action-btn ai-btn';
    aiBtn.textContent = 'AI';
    aiBtn.title = '移回待反推重新反推';
    aiBtn.onclick = event => { event.stopPropagation(); moveTo('pending'); };
    uiStrip.append(aiBtn);

    const arrowBtn = document.createElement('button');
    arrowBtn.type = 'button';
    arrowBtn.className = `action-btn arrow-btn ${folder === 'completed' ? 'active' : ''}`;
    arrowBtn.innerHTML = RELEASE_SVG;
    arrowBtn.title = folder === 'completed' ? '移回有词区' : '释放至已完成';
    arrowBtn.onclick = event => { event.stopPropagation(); moveTo(folder === 'completed' ? 'worded' : 'completed'); };
    uiStrip.append(arrowBtn);

    const heartBtn = document.createElement('button');
    heartBtn.type = 'button';
    heartBtn.className = 'action-btn heart-btn active';
    heartBtn.innerHTML = HEART_SVG;
    heartBtn.title = '取消本地收藏';
    heartBtn.setAttribute('aria-label', heartBtn.title);
    heartBtn.onclick = event => { event.stopPropagation(); toggleFavorite(item); };
    uiStrip.append(heartBtn);

    const hdBtn = document.createElement('button');
    hdBtn.type = 'button';
    hdBtn.className = 'action-btn hd-btn';
    hdBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`;
    hdBtn.title = '查看高清大图';
    hdBtn.setAttribute('aria-label', hdBtn.title);
    hdBtn.onclick = event => {
      event.stopPropagation();
      openLightbox({...item, image_width: width, image_height: height}, card, image?.currentSrc || image?.src || imageUrl);
    };
    uiStrip.append(hdBtn);

    const sourceBadge = document.createElement('div');
    sourceBadge.className = `source-badge-btn ${isPixiv ? 'source-pixiv' : 'source-danbooru'}`;
    sourceBadge.textContent = isPixiv ? 'P' : 'D';
    sourceBadge.title = `${isPixiv ? '来源：Pixiv' : '来源：Danbooru'} (点击翻面)`;
    sourceBadge.onclick = event => { event.stopPropagation(); if (card._flipToggle) card._flipToggle(); else cardInner.classList.toggle('flipped'); };
    uiStrip.append(sourceBadge);
  }

  frontFace.append(artworkContainer, uiStrip);

  // ---------------- BACK FACE ----------------
  const backFace = document.createElement('div');
  backFace.className = `card-face card-back ${pending ? 'pending-back' : 'premium-back'}`;

  const target = {
    kind: isWordedEntry ? 'worded' : 'favorite',
    id: item.id,
    preset: item.preset,
    imageUrl: image?.currentSrc || image?.src || imageUrl,
    summary: item.summary,
    onSaved: value => {
      prompt = value;
      if (isWordedEntry) item.positive = value;
      else item.prompt = value;
      refreshGallery();
    }
  };

  if (pending) {
    // 1. 顶部控制：[ 创建提示词卡片 | ▼ ]
    const copyControl = document.createElement('div');
    copyControl.className = 'pending-copy-control';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'pending-copy-btn';
    copyBtn.textContent = '创建提示词卡片';
    copyBtn.title = '创建提示词卡片并保存至有词区';
    const openCreateDialog = (e) => {
      e.stopPropagation();
      const createTarget = {
        kind: isWordedEntry ? 'moveWorded' : 'fromPost',
        post: item,
        id: item.id,
        preset: item.preset,
        imageUrl: image?.currentSrc || image?.src || imageUrl,
        summary: item.summary,
        onSaved: value => {
          prompt = value;
          if (isWordedEntry) item.positive = value;
          else item.prompt = value;
          refreshGallery();
        }
      };
      showPromptDialog(prompt, createTarget, val => {
        prompt = val;
        if (isWordedEntry) item.positive = val;
        else item.prompt = val;
        refreshGallery();
      });
    };
    copyBtn.onclick = openCreateDialog;
    const expandArrow = document.createElement('button');
    expandArrow.type = 'button';
    expandArrow.className = 'pending-copy-arrow';
    expandArrow.textContent = '▼';
    expandArrow.title = '展开查看/编辑提示词工作区';
    expandArrow.onclick = openCreateDialog;
    copyControl.append(copyBtn, expandArrow);

    // 2. 预设、字符数这两行最右边放 [ AI直推 ]
    const metaDirectRow = document.createElement('div');
    metaDirectRow.className = 'pending-meta-direct-row';
    const metaTextCol = document.createElement('div');
    metaTextCol.className = 'pending-meta-text-col';
    const presetLine = document.createElement('div');
    presetLine.innerHTML = `预设：<strong class="pending-preset-label">${item.preset || presetConfig.defaultExpansion || '艺术导演扩写'}</strong>`;
    const charsLine = document.createElement('div');
    charsLine.className = 'chars-line';
    charsLine.textContent = `字符：${promptCharacterCount(prompt)}`;
    metaTextCol.append(presetLine, charsLine);

    const directButton = document.createElement('button');
    directButton.type = 'button';
    directButton.className = 'pending-direct-btn';
    directButton.textContent = directButtonLabel(item);
    directButton.title = '调用已连接的 MCP Agent 直接反推这张图';
    directButton.onclick = event => { event.stopPropagation(); runDirectReverse(item, pendingControls); };

    metaDirectRow.append(metaTextCol, directButton);

    // 3. 状态灯与队列（在 AI直推 正下方）
    const statusQueueRow = document.createElement('div');
    statusQueueRow.className = 'pending-status-queue';

    const status = document.createElement('div');
    status.className = 'pending-status-lamp';
    const failed = item.reverseStatus === 'failed' || item.directStatus === 'failed' || item.cacheStatus === 'error';
    const done = Boolean(prompt) && !failed && item.autoEnabled === false;
    const lamp = document.createElement('span');
    lamp.className = `status-dot reverse-lamp ${failed ? 'red lamp-error' : done ? 'green lamp-done' : 'lamp-waiting'}`;
    const label = document.createElement('span');
    label.className = 'status-text';
    const setStatusText = () => {
      const curFailed = item.reverseStatus === 'failed' || item.directStatus === 'failed' || item.cacheStatus === 'error';
      const curDone = Boolean(isWordedEntry ? item.positive : item.prompt) && !curFailed && item.autoEnabled === false;
      lamp.className = `status-dot reverse-lamp ${curFailed ? 'red lamp-error' : curDone ? 'green lamp-done' : 'lamp-waiting'}`;
      label.textContent = curFailed ? '错误' : curDone ? '完成' : (item.reverseStatus === 'processing' || item.directStatus === 'processing' ? '处理中' : '等待');
      status.classList.toggle('retryable', curFailed);
    };
    setStatusText();
    status.append(lamp, label);

    if (failed) {
      status.setAttribute('role', 'button');
      status.tabIndex = 0;
      status.onclick = async () => {
        try {
          const changes = !isWordedEntry && item.cacheStatus === 'error' ? {retryCache: true} : {retryReverse: true};
          const updated = await patchState(changes);
          Object.assign(item, updated || {});
          card._updateFavoriteState?.(item);
          if (changes.retryReverse) refreshGallery();
        } catch (error) { toast(`重试失败：${error.message}`); }
      };
    }

    const queueWrap = document.createElement('div');
    queueWrap.className = 'pending-queue-wrap';
    const queueText = document.createElement('span');
    queueText.textContent = '队列';
    const queueButton = document.createElement('button');
    queueButton.type = 'button';
    queueButton.className = `queue-badge-btn ${item.autoEnabled !== false ? 'active' : ''}`;
    queueButton.textContent = item.autoEnabled !== false ? String(initialQueueOrder || '·') : '+';
    queueButton.title = item.autoEnabled !== false ? `队列第 ${initialQueueOrder || '?'} 位，点击移出` : '点击加入反推队列';
    queueButton.onclick = async event => {
      event.stopPropagation();
      queueButton.disabled = true;
      try {
        const updated = await patchState({autoEnabled: item.autoEnabled === false});
        Object.assign(item, updated || {});
        refreshGallery();
      } catch (error) { queueButton.disabled = false; toast(`更新队列失败：${error.message}`); }
    };
    queueWrap.append(queueText, queueButton);
    statusQueueRow.append(status, queueWrap);

    // 4. 扩写预设栏：整栏直接点击展开（Custom Dropdown）
    const presetDropdownWrap = document.createElement('div');
    presetDropdownWrap.className = 'preset-dropdown-wrap';

    const presetBarClickable = document.createElement('div');
    presetBarClickable.className = 'preset-bar-clickable';
    presetBarClickable.tabIndex = 0;
    presetBarClickable.setAttribute('role', 'button');
    presetBarClickable.setAttribute('aria-expanded', 'false');

    const currentPresetName = item.preset || presetConfig.defaultExpansion || '艺术导演扩写';
    const presetBarText = document.createElement('span');
    presetBarText.className = 'preset-bar-text';
    presetBarText.textContent = `扩写：${currentPresetName}`;

    const presetArrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    presetArrowSvg.setAttribute('class', 'preset-bar-arrow');
    presetArrowSvg.setAttribute('width', '14');
    presetArrowSvg.setAttribute('height', '14');
    presetArrowSvg.setAttribute('viewBox', '0 0 24 24');
    presetArrowSvg.setAttribute('fill', 'none');
    presetArrowSvg.setAttribute('stroke', 'currentColor');
    presetArrowSvg.setAttribute('stroke-width', '2.5');
    presetArrowSvg.setAttribute('stroke-linecap', 'round');
    presetArrowSvg.setAttribute('stroke-linejoin', 'round');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '6 9 12 15 18 9');
    presetArrowSvg.append(polyline);

    presetBarClickable.append(presetBarText, presetArrowSvg);

    const presetMenuList = document.createElement('div');
    presetMenuList.className = 'preset-menu-list';
    presetMenuList.hidden = true;

    for (const name of expansionNames()) {
      const optionItem = document.createElement('div');
      optionItem.className = `preset-option-item ${name === currentPresetName ? 'selected' : ''}`;
      optionItem.dataset.value = name;
      optionItem.textContent = `扩写：${name}`;
      presetMenuList.append(optionItem);
    }

    presetBarClickable.onclick = (e) => {
      e.stopPropagation();
      const isHidden = presetMenuList.hidden;
      presetMenuList.hidden = !isHidden;
      presetBarClickable.classList.toggle('open', !presetMenuList.hidden);
      presetBarClickable.setAttribute('aria-expanded', String(!presetMenuList.hidden));
    };

    presetMenuList.onclick = async (e) => {
      e.stopPropagation();
      const opt = e.target.closest('.preset-option-item');
      if (!opt) return;
      const val = opt.dataset.value;
      presetBarText.textContent = `扩写：${val}`;
      const lbl = presetLine.querySelector('strong');
      if (lbl) lbl.textContent = val;
      presetMenuList.querySelectorAll('.preset-option-item').forEach(i => i.classList.remove('selected'));
      opt.classList.add('selected');
      presetMenuList.hidden = true;
      presetBarClickable.classList.remove('open');
      presetBarClickable.setAttribute('aria-expanded', 'false');
      try {
        const updated = await patchState({preset: val});
        Object.assign(item, updated || {});
        toast(`已切换扩写预设：${val}`);
      } catch (err) { toast(`扩写预设保存失败：${err.message}`); }
    };

    document.addEventListener('click', (e) => {
      if (!presetDropdownWrap.contains(e.target)) {
        presetMenuList.hidden = true;
        presetBarClickable.classList.remove('open');
        presetBarClickable.setAttribute('aria-expanded', 'false');
      }
    });

    presetDropdownWrap.append(presetBarClickable, presetMenuList);

    // 5. 额外要求输入框
    const instructionWrap = document.createElement('div');
    instructionWrap.className = 'pending-instruction-wrap';
    const instructionInput = document.createElement('input');
    instructionInput.type = 'text';
    instructionInput.className = 'pending-instruction-input';
    instructionInput.maxLength = 4000;
    instructionInput.placeholder = '额外要求（与预设一起交给 AI）';
    instructionInput.value = item.customInstruction || '';
    instructionInput.onchange = async () => {
      try {
        const updated = await patchState({customInstruction: instructionInput.value});
        Object.assign(item, updated || {});
        toast('额外要求已保存');
      } catch (error) { toast('保存失败：' + error.message); }
    };
    instructionWrap.append(instructionInput);

    pendingControls = {kind, card, image, status, lamp, label, queueButton, directButton, displayQueueOrder: initialQueueOrder};

    backFace.append(copyControl, metaDirectRow, statusQueueRow, presetDropdownWrap, instructionWrap);
  } else {
    // Worded & Completed Back Face: 高级感卡背（顶部：提示词 | 复 译 ⤢；下方全是提示词框）
    const backTopRow = document.createElement('div');
    backTopRow.className = 'back-top-row';

    const backTitle = document.createElement('span');
    backTitle.className = 'back-title';
    backTitle.textContent = '提示词';

    const backBtnCluster = document.createElement('div');
    backBtnCluster.className = 'back-btn-cluster';

    // [ 复 ] Tool
    const copyTool = document.createElement('button');
    copyTool.type = 'button';
    copyTool.className = 'mini-tool-btn copy-tool';
    copyTool.textContent = '复';
    copyTool.title = '复制提示词';
    copyTool.onclick = async (e) => {
      e.stopPropagation();
      try {
        await copyTextToClipboard(promptFullBox.textContent.trim() || prompt);
        toast('📋 [复] 已复制提示词');
      } catch (err) { toast(`复制失败：${err.message}`); }
    };

    // [ 译 ] Tool (打开提示词栏并直接展开翻译)
    const transTool = document.createElement('button');
    transTool.type = 'button';
    transTool.className = 'mini-tool-btn trans-tool';
    transTool.textContent = '译';
    transTool.title = '打开提示词栏并直接展开翻译对照';
    transTool.onclick = (e) => {
      e.stopPropagation();
      showPromptDialog(promptFullBox.textContent.trim() || prompt, target, val => {
        prompt = val;
        promptFullBox.textContent = val;
        if (isWordedEntry) item.positive = val;
        else item.prompt = val;
      }, { expandTranslation: true });
    };

    // [ ⤢ ] Tool (展开提示词大工作区)
    const expandTool = document.createElement('button');
    expandTool.type = 'button';
    expandTool.className = 'mini-tool-btn expand-tool';
    expandTool.title = '展开提示词工作区';
    expandTool.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
    expandTool.onclick = (e) => {
      e.stopPropagation();
      showPromptDialog(promptFullBox.textContent.trim() || prompt, target, val => {
        prompt = val;
        promptFullBox.textContent = val;
        if (isWordedEntry) item.positive = val;
        else item.prompt = val;
      });
    };

    backBtnCluster.append(copyTool, transTool, expandTool);
    backTopRow.append(backTitle, backBtnCluster);

    // Full Prompt Box Below
    const promptFullBox = document.createElement('div');
    promptFullBox.className = 'prompt-full-box';
    promptFullBox.contentEditable = 'true';
    promptFullBox.spellcheck = false;
    promptFullBox.textContent = prompt || '';
    promptFullBox.addEventListener('blur', async () => {
      const newVal = promptFullBox.textContent.trim();
      if (newVal !== prompt) {
        prompt = newVal;
        if (isWordedEntry) item.positive = newVal;
        else item.prompt = newVal;
        try {
          await patchState({[isWordedEntry ? 'positive' : 'prompt']: newVal});
          toast('提示词已同步保存');
        } catch (err) { toast(`保存失败：${err.message}`); }
      }
    });

    backFace.append(backTopRow, promptFullBox);
  }

  cardInner.append(cardHolo, frontFace, backFace);
  cardWrapper.append(cardInner);
  card.append(cardWrapper);

  // 绑定 3D 鼠标微视差及点击翻面事件
  attach3DCardTilt(card, cardWrapper);
  attach3DCardFlip(card, cardInner);

  card._updateFavoriteState = next => { Object.assign(item, next || {}); updatePendingControls(item, pendingControls); };
  if (pendingControls) updatePendingControls(item, pendingControls);

  card.oncontextmenu = event => isWordedEntry ? showManualMenu(event, item) : showMenu(event, item);
  const cardWeight = Math.max(0.6, Math.min(2.5, (height / width) + (isLandscape ? 0.2 : 0)));
  appendRenderedCard(card, cardWeight);
}
function promptCharacterCount(value) {
  // Count visible characters while excluding punctuation, symbols, whitespace and line breaks.
  return [...String(value || "")].filter(char => !/[\p{P}\p{S}\s]/u.test(char)).length;
}
function promptPresetName(target) {
  return target?.preset || target?.expansionPreset || target?.post?.preset || presetConfig.defaultExpansion || "通用扩写";
}
async function copyTextToClipboard(value) {
  const text = String(value || '');
  if (!text) throw Error('提示词为空');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {}
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(area); area.focus(); area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw Error('浏览器未允许访问剪贴板');
}
function createPromptControl(initialPrompt, target) {
  let prompt = initialPrompt;
  const wrapper = document.createElement('div'); wrapper.className = 'prompt-control-wrap';
  const control = document.createElement('div'); control.className = 'prompt-control';
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy-prompt';
  copy.textContent = '复制提示词'; copy.title = '复制提示词'; copy.disabled = !prompt;
  copy.onclick = async event => {
    event.stopPropagation();
    try { await copyTextToClipboard(prompt); toast('已复制提示词'); }
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
  const meta = document.createElement('div'); meta.className = 'prompt-meta';
  const preset = document.createElement('span'); preset.className = 'prompt-preset-name';
  const count = document.createElement('span'); count.className = 'prompt-char-count';
  const updateMeta = () => { preset.textContent = `预设：${promptPresetName(target)}`; count.textContent = `字符：${promptCharacterCount(prompt)}`; };
  updateMeta(); meta.append(preset, count); wrapper.append(control, meta);
  const originalSaved = target.onSaved;
  target.onSaved = value => { prompt = value; updateMeta(); originalSaved?.(value); };
  return wrapper;
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
function showPromptDialog(prompt, target, onSaved, options = {}) {
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
      try { await copyTextToClipboard(dialog.querySelector('.prompt-dialog-text').value); toast('已复制提示词'); }
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
          if(!isFavorite(post)) await saveFavorites([favoriteFields(post),...readFavorites()]);
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
  if (options.expandTranslation) {
    requestAnimationFrame(() => {
      dialog.querySelector('.prompt-dialog-buttons button:nth-child(2)')?.click();
    });
  }
}
function getLightboxPageSrc(post, index) {
  if (!post) return '';
  if (Array.isArray(post.pages) && post.pages[index]) {
    return imageSrc(post.pages[index].large_file_url || post.pages[index].file_url);
  }
  const base = post.large_file_url || post.file_url || post.sourceImageUrl || '';
  if (base.includes('_p0')) {
    const pageUrl = base.replace(/_p0(?=(_[a-zA-Z0-9]+)?\.[a-zA-Z0-9]+)/, `_p${index}`);
    return imageSrc(pageUrl);
  }
  return imageSrc(hiRes(post));
}

function preloadLightboxPage(post, index) {
  if (!post || index < 0 || index >= lightboxPageCount) return;
  const src = getLightboxPageSrc(post, index);
  if (src) {
    const img = new Image();
    img.src = src;
  }
}

function updateLightboxPagination() {
  if (!lightboxPagination) return;
  if (lightboxPageCount > 1) {
    lightboxPagination.hidden = false;
    lightbox.classList.add('has-pages');
    if (lightboxPageIndicator) {
      lightboxPageIndicator.textContent = `${lightboxPageIndex + 1} / ${lightboxPageCount}`;
    }
    if (lightboxPrev) {
      lightboxPrev.disabled = (lightboxPageIndex <= 0);
    }
    if (lightboxNext) {
      lightboxNext.disabled = (lightboxPageIndex >= lightboxPageCount - 1);
    }
  } else {
    lightboxPagination.hidden = true;
    lightbox.classList.remove('has-pages');
  }
}

function switchLightboxPage(index) {
  if (!previewPost || index < 0 || index >= lightboxPageCount || index === lightboxPageIndex) return;
  lightboxPageIndex = index;
  updateLightboxPagination();
  const nextSrc = getLightboxPageSrc(previewPost, index);
  if (nextSrc) {
    lightboxImage.src = nextSrc;
  }
  preloadLightboxPage(previewPost, index + 1);
  preloadLightboxPage(previewPost, index - 1);
}

function openLightbox(post, card, imageUrl = '') {
  previewPost = post;
  previewCard = card;
  lightboxPageIndex = 0;
  lightboxPages = Array.isArray(post?.pages) ? post.pages : null;
  lightboxPageCount = Math.max(1, Number(post?.page_count) || (lightboxPages ? lightboxPages.length : 1));

  if (lightboxFetchAbort) {
    try { lightboxFetchAbort.abort(); } catch {}
    lightboxFetchAbort = null;
  }

  lightboxImage.src = imageUrl || getLightboxPageSrc(post, 0) || imageSrc(hiRes(post));
  lightbox.classList.remove('hidden');
  lightbox.setAttribute('aria-hidden', 'false');
  updateLightboxPagination();

  const illustId = post?.pixiv_id || (post?.source === 'pixiv' || String(post?.id || '').startsWith('px_')
    ? String(post.id || '').replace(/^px_/, '').split('_')[0]
    : '');
  if (lightboxPageCount > 1 && illustId && /^\d+$/.test(illustId) && !post.pages) {
    const abort = new AbortController();
    lightboxFetchAbort = abort;
    fetch(`/api/pixiv/illust/${illustId}/pages`, { signal: abort.signal })
      .then(r => r.json())
      .then(res => {
        if (res.ok && Array.isArray(res.pages) && res.pages.length > 0) {
          post.pages = res.pages;
          if (previewPost === post) {
            lightboxPages = res.pages;
            lightboxPageCount = res.pages.length;
            post.page_count = res.pages.length;
            updateLightboxPagination();
            preloadLightboxPage(post, 1);
            const curPage = res.pages[lightboxPageIndex];
            if (curPage && curPage.width && curPage.height) {
              placeLightbox(previewCard, {
                ...post,
                image_width: curPage.width,
                image_height: curPage.height
              });
            }
          }
        }
      })
      .catch(() => {});
  } else if (lightboxPageCount > 1) {
    preloadLightboxPage(post, 1);
  }

  requestAnimationFrame(() => placeLightbox(card, post));
}

function placeLightbox(card, post) {
  const vw = innerWidth, vh = innerHeight, rect = card?.getBoundingClientRect();
  const portrait = (post.image_height || 1) / (post.image_width || 1);
  const hasPages = (Number(post?.page_count) > 1 || lightboxPageCount > 1);
  const bottomMargin = hasPages ? 58 : 20;
  const targetArea = vw * vh * .24, minW = 260, maxW = Math.min(vw * .56, 760), minH = 180, maxH = Math.min(vh * .78, vh - bottomMargin - 30);
  let width = Math.sqrt(targetArea / Math.max(.35, portrait));
  width = Math.max(minW, Math.min(maxW, width));
  let height = width * portrait;
  if (height > maxH) { height = maxH; width = height / portrait; }
  if (width > maxW) { width = maxW; height = width * portrait; }
  if (height < minH) { height = minH; width = height / portrait; }
  width = Math.min(width, vw - 20); height = Math.min(height, vh - bottomMargin - 10);
  let left = rect ? rect.right + 14 : (vw - width) / 2;
  if (left + width > vw - 10) left = rect ? rect.left - width - 14 : 10;
  if (left < 10) left = Math.max(10, (vw - width) / 2);
  let top = rect ? rect.top : (vh - height) / 2;
  top = Math.max(10, Math.min(top, vh - height - bottomMargin));
  lightbox.style.setProperty('--panel-width', `${Math.round(width)}px`);
  lightbox.style.setProperty('--panel-height', `${Math.round(height)}px`);
  lightbox.style.setProperty('--panel-left', `${Math.round(left)}px`);
  lightbox.style.setProperty('--panel-top', `${Math.round(top)}px`);
}

function closeLightbox() {
  if (lightboxFetchAbort) {
    try { lightboxFetchAbort.abort(); } catch {}
    lightboxFetchAbort = null;
  }
  lightbox.classList.add('hidden');
  lightbox.setAttribute('aria-hidden', 'true');
  lightboxImage.removeAttribute('src');
  if (lightboxPagination) lightboxPagination.hidden = true;
  lightbox.classList.remove('has-pages');
  previewCard = null;
  previewPost = null;
  lightboxPageIndex = 0;
  lightboxPageCount = 1;
  lightboxPages = null;
}

if (lightboxPagination) {
  lightboxPagination.addEventListener('click', event => event.stopPropagation());
}
if (lightboxPrev) {
  lightboxPrev.addEventListener('click', event => {
    event.stopPropagation();
    switchLightboxPage(lightboxPageIndex - 1);
  });
}
if (lightboxNext) {
  lightboxNext.addEventListener('click', event => {
    event.stopPropagation();
    switchLightboxPage(lightboxPageIndex + 1);
  });
}
lightboxImage.addEventListener('load', () => {
  if (previewPost && !lightbox.classList.contains('hidden') && lightboxImage.naturalWidth && lightboxImage.naturalHeight) {
    placeLightbox(previewCard, {
      ...previewPost,
      image_width: lightboxImage.naturalWidth,
      image_height: lightboxImage.naturalHeight
    });
  }
});

lightbox.addEventListener('click', event => {
  if (event.target === lightbox || event.target.id === 'lightboxClose') closeLightbox();
});
window.addEventListener('resize', () => {
  // Tablet browser chrome expands/collapses the viewport and fires resize many
  // times. Reposition the open preview only; never rebuild the gallery here.
  if (!lightbox.classList.contains('hidden') && previewPost) placeLightbox(previewCard, previewPost);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeLightbox();
  if (!lightbox.classList.contains('hidden') && lightboxPageCount > 1) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      switchLightboxPage(lightboxPageIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      switchLightboxPage(lightboxPageIndex + 1);
    }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !event.target.closest('input, textarea, [contenteditable="true"]')) {
    event.preventDefault();
    undoLastAction();
  }
  if (event.code === 'Space' && !event.target.closest('input, textarea, [contenteditable="true"]')) {
    const cards = document.querySelectorAll('#gallery .reverse-card.3d-card');
    if (cards.length > 0) {
      event.preventDefault();
      cards.forEach(card => {
        if (card._flipToggle) card._flipToggle();
        else card.querySelector('.card-inner')?.classList.toggle('flipped');
      });
    }
  }
});
let activeManual = null;
function showManualMenu(event, item) {
  event.preventDefault(); activePost = null; activeManual = item;
  menu.querySelectorAll('[data-action]').forEach(button => {
    button.hidden = !['create-prompt', 'share', 'delete'].includes(button.dataset.action);
  });
  const shareBtn = menu.querySelector('[data-action="share"]');
  if (shareBtn) shareBtn.hidden = !sharePromptFor('worded', item).trim();
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
  menu.querySelector('[data-action="favorite"]').textContent = isFavorite(post) ? '取消本地收藏' : '加入本地收藏';
  const saved = findFavoriteForPost(post);
  const shareBtn = menu.querySelector('[data-action="share"]');
  if (shareBtn) shareBtn.hidden = !sharePromptFor('favorite', saved || post).trim();
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
  const saved = findFavoriteForPost(post);
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
    if (action === 'share') {
      await exportShareFile([activeManual ? {kind: 'worded', item: activeManual} : {kind: 'favorite', item: findFavoriteForPost(activePost) || activePost}]);
    }
    if (action === 'create-prompt') {
      if(activeManual)showPromptDialog(activeManual.positive,{kind:'moveWorded',id:activeManual.id,imageUrl:activeManual.imageExt?`/api/worded/images/${encodeURIComponent(activeManual.id)}`:'',summary:activeManual.summary});
      else {const saved=findFavoriteForPost(activePost);showPromptDialog(saved?.prompt||'',{kind:'fromPost',post:activePost,imageUrl:saved?.cacheStatus==='ready'?`/api/reverse/image/${activePost.id}`:imageSrc(activePost.large_file_url||activePost.preview_file_url)});}
    }
    if (action === 'copy') await copyImage(activePost || activeManual);
    if (action === 'url') { await copyTextToClipboard(hiRes(activePost)); toast('已复制高清图地址'); }
    if (action === 'open') open(`/api/image?url=${encodeURIComponent(hiRes(activePost))}`, '_blank', 'noopener');
  } catch (error) {
    if (action === 'copy') toast(`复制图片失败：${error.message || '浏览器拒绝剪贴板权限'}`);
    else {
      try { await copyTextToClipboard(hiRes(activePost)); toast('已复制高清图地址'); }
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
    isPixivMode(modeName) ? pixivDate(modeName) : '',
    modeName === 'favorites' ? favoriteFolder : ''
  ].join('|');
}
function saveCurrentView() {
  // The worded/pending/completed galleries contain a second persisted source
  // (the manual worded index). Their currentPosts array intentionally does
  // not represent every rendered card, so restoring it could reinsert an old
  // generic card shape. Always reload these folders through the unified
  // reverse-card renderer instead.
  if (!currentPosts.length || (mode === 'favorites' && ['worded', 'pending', 'completed'].includes(favoriteFolder))) return;
  viewCache.set(viewKey(), {
    posts: currentPosts.slice(), cursor, pageNo, ended, loadFailed,
    status: statusEl.textContent, scrollY: window.scrollY
  });
  while (viewCache.size > 30) viewCache.delete(viewCache.keys().next().value);
}
function restoreView(modeName) {
  if (modeName === 'favorites' && ['worded', 'pending', 'completed'].includes(favoriteFolder)) return false;
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
  if (nextMode === mode) {
    // Clicking the already-selected local collection is an explicit refresh.
    // This recovers cards whose shared cache state changed while the user was
    // browsing without forcing a detour through the D/P station buttons.
    if (nextMode === 'favorites') {
      if (['worded', 'pending', 'completed'].includes(favoriteFolder)) loadWordedGallery(true);
      else refreshFavoriteGallery(true);
    } else if (nextMode === 'metadata') {
      loadMetadataGallery();
    } else if (isPixivMode(nextMode)) {
      viewCache.delete(viewKey());
      load(true);
    }
    updatePixivControls();
    return;
  }
  saveCurrentView();
  exitShareSelection();
  invalidateGalleryRequests();
  mode = nextMode;
  activateButton(button || document.querySelector(`[data-mode="${nextMode}"]`));
  document.querySelector('#favoriteFolders')?.classList.toggle('hidden', nextMode !== 'favorites');
  updatePixivModeButtons();
  updatePixivControls();
  schedulePreferenceSave();
  if (nextMode === 'metadata' || (nextMode === 'favorites' && favoriteFolder === 'worded')) load(true);
  else if (!restoreView(nextMode)) load(true);
}
document.querySelectorAll('.mode[data-mode]').forEach(button => button.onclick = () => selectMode(button.dataset.mode, button));
function bindRatingMenu() {
  const menu = document.querySelector('.rating-menu');
  if (!menu) return;
  menu.querySelectorAll('input').forEach(input => input.onchange = () => {
    if (station === 'pflow') {
      pixivRating = input.value === 'r18' ? 'r18' : 'safe';
      localStorage.setItem(PIXIV_RATING_KEY, pixivRating);
      const nextMode = pixivModeForKind(pixivKind(mode), pixivRating);
      updatePixivModeButtons();
      updateRatingMenuForStation();
      updatePixivControls();
      schedulePreferenceSave();
      selectMode(nextMode, document.querySelector(`[data-mode="${nextMode}"]`));
      return;
    }
    const selected = ratingChecks();
    if (!selected.length) {
      input.checked = true;
      toast('至少保留一个分级');
    }
    dflowRatings = new Set(ratingChecks().filter(value => ['g', 's', 'q', 'e'].includes(value)));
    updateRatingLabel();
    schedulePreferenceSave();
    load(true);
  });
  const all = menu.querySelector('#allRatings');
  if (all) all.onclick = () => {
    dflowRatings = new Set(['g', 's', 'q', 'e']);
    menu.querySelectorAll('input').forEach(input => { input.checked = true; });
    updateRatingLabel();
    schedulePreferenceSave();
    load(true);
  };
}
function updateRatingMenuForStation() {
  const menu = document.querySelector('.rating-menu');
  if (!menu) return;
  const previous = [...menu.querySelectorAll('input:checked')].map(input => input.value);
  if (station === 'dflow' && previous.every(value => ['g', 's', 'q', 'e'].includes(value)) && previous.length) {
    dflowRatings = new Set(previous);
  }
  if (station === 'pflow') {
    menu.innerHTML = `
      <label><input type="radio" name="pixivRating" value="safe" ${pixivRating === 'safe' ? 'checked' : ''}> <i class="rating-dot dot-g"></i>全年龄</label>
      <label><input type="radio" name="pixivRating" value="r18" ${pixivRating === 'r18' ? 'checked' : ''}> <i class="rating-dot dot-e"></i>R18</label>
    `;
  } else {
    const ratings = dflowRatings.size ? dflowRatings : new Set(['g', 's', 'q', 'e']);
    menu.innerHTML = `
      <label><input type="checkbox" value="g" ${ratings.has('g') ? 'checked' : ''}> <i class="rating-dot dot-g"></i>全年龄</label>
      <label><input type="checkbox" value="s" ${ratings.has('s') ? 'checked' : ''}> <i class="rating-dot dot-s"></i>敏感</label>
      <label><input type="checkbox" value="q" ${ratings.has('q') ? 'checked' : ''}> <i class="rating-dot dot-q"></i>较敏感</label>
      <label><input type="checkbox" value="e" ${ratings.has('e') ? 'checked' : ''}> <i class="rating-dot dot-e"></i>成人</label>
      <button id="allRatings" type="button">全选</button>
    `;
  }
  bindRatingMenu();
  updateRatingLabel();
}
function updateRatingLabel() {
  const button = document.querySelector('#ratingButton');
  if (!button) return;
  const picker = document.querySelector('#ratingPicker');
  button.setAttribute('aria-expanded', String(Boolean(picker?.classList.contains('open'))));
  if (station === 'pflow') {
    const label = pixivRating === 'r18' ? 'R18' : '全年龄';
    button.textContent = `分级 ${label}⌄`;
    button.setAttribute('aria-label', `Pflow 年龄分级：${label}，点击切换`);
    return;
  }
  const count = ratingChecks().length;
  button.textContent = (count === 4 ? '分级' : `分级 ${count}/4`) + '⌄';
  button.setAttribute('aria-label', `Dflow 图片分级，当前选择 ${count} 类，点击展开`);
}
updateRatingMenuForStation();
document.querySelector('#ratingButton').onclick = () => {
  const picker = document.querySelector('#ratingPicker');
  const open = !picker.classList.contains('open');
  picker.classList.toggle('open', open);
  document.querySelector('#ratingButton')?.setAttribute('aria-expanded', String(open));
};
const columnPicker = document.querySelector('#columnPicker');
document.querySelector('#columnButton').onclick = () => {
  columnPicker.classList.toggle('open');
  document.querySelector('#columnButton').setAttribute('aria-expanded', columnPicker.classList.contains('open'));
};
document.querySelectorAll('#favoriteFolders [data-folder]').forEach(button => button.onclick = () => {
  if (favoriteFolder === button.dataset.folder) {
    if (mode === 'favorites') {
      if (['worded', 'pending', 'completed'].includes(favoriteFolder)) loadWordedGallery(true);
      else refreshFavoriteGallery(true);
    }
    return;
  }
  if (mode === 'favorites') saveCurrentView();
  exitShareSelection();
  invalidateGalleryRequests();
  favoriteFolder = button.dataset.folder;
  document.querySelectorAll('#favoriteFolders [data-folder]').forEach(item => item.classList.toggle('active', item === button));
  if (mode === 'favorites' && ['worded','pending','completed'].includes(favoriteFolder)) { load(true); return; }
  if (mode === 'favorites' && !restoreView('favorites')) refreshFavoriteGallery(false);
});
const retryMissingCache = document.querySelector('#retryMissingCache');
let retryCacheBusy = false;
if (retryMissingCache) retryMissingCache.onclick = async event => {
  event.stopPropagation();
  if (retryCacheBusy) return;
  retryCacheBusy = true;
  retryMissingCache.disabled = true;
  retryMissingCache.textContent = '正在提交补缓存任务…';
  const revision = ++favoriteStateRevision;
  try {
    const response = await fetch('/api/favorites/retry-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ folder: 'all' }),
      signal: AbortSignal.timeout(15000)
    });
    let result;
    try { result = await response.json(); }
    catch { throw Error('服务未返回有效的补缓存结果，请重启 DFlow 服务后重试'); }
    if (!response.ok || result.ok !== true) throw Error(result.error || `HTTP ${response.status}`);
    if (revision === favoriteStateRevision && Array.isArray(result.favorites)) {
      favoriteCache = result.favorites;
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteCache));
      sharedUpdatedAt = result.updatedAt || sharedUpdatedAt;
    }
    if (mode === 'favorites') refreshFavoriteGallery(true);
    const queued = Number(result.queued) || 0;
    toast(queued ? `已安排 ${queued} 张缺失高清图重新下载，后台下载中` : '高清缓存已齐全，无需重新下载');
  } catch (error) {
    toast(`补全缓存失败：${error.name === 'TimeoutError' ? '请求超时，请稍后重试' : error.message}`);
  } finally {
    retryCacheBusy = false;
    retryMissingCache.disabled = false;
    updateFavoriteCount();
    if (!retryMissingCache.hidden) retryMissingCache.textContent = '重新下载未缓存';
  }
};
const batchSelectButton = document.querySelector('#batchSelect');
if (batchSelectButton) batchSelectButton.onclick = event => {
  event.stopPropagation();
  if (shareSelectionMode) exitShareSelection();
  else enterShareSelection();
};
document.querySelector('#batchDelete')?.addEventListener('click', event => {
  event.stopPropagation();
  deleteSelectedShareCards();
});
document.querySelector('#batchShare')?.addEventListener('click', async event => {
  event.stopPropagation();
  const records = selectedShareRecords();
  if (!records.length) { toast('请先点击卡片选择要分享的内容'); return; }
  const success = await exportShareFile(records);
  if (success) exitShareSelection();
});
document.querySelector('#importShare')?.addEventListener('click', event => {
  event.stopPropagation();
  document.querySelector('#shareFileInput')?.click();
});
document.querySelector('#shareFileInput')?.addEventListener('change', event => {
  const file = event.target.files?.[0];
  importShareFile(file);
});
document.querySelector('#shareImportConfirm')?.addEventListener('click', confirmShareImport);
document.querySelector('#shareImportCancel')?.addEventListener('click', closeShareImport);
document.querySelector('#shareImportClose')?.addEventListener('click', closeShareImport);
document.querySelector('#shareImportDialog')?.addEventListener('cancel', event => {
  event.preventDefault();
  closeShareImport();
});
document.querySelector('#searchBtn').onclick = () => {
  manualSearchTags = normalizeSearchTags(searchInput.value);
  searchInput.value = manualSearchTags;
  updatePixivControls();
  schedulePreferenceSave();
  load(true);
};
searchInput.onkeydown = event => { if (event.key === 'Enter') document.querySelector('#searchBtn').click(); };
document.querySelector('#clearBtn').onclick = () => {
  searchInput.value = '';
  manualSearchTags = '';
  selectedPopularTags.clear();
  drawTags();
  updateSelectedTagCount();
  updatePixivControls();
  schedulePreferenceSave();
  load(true);
};
document.querySelector('#refresh').onclick = () => { viewCache.delete(viewKey()); load(true); };
document.addEventListener('click', event => {
  if (!menu.contains(event.target)) menu.classList.add('hidden');
  if (!event.target.closest('.rating-picker')) {
    const picker = document.querySelector('#ratingPicker');
    picker?.classList.remove('open');
    document.querySelector('#ratingButton')?.setAttribute('aria-expanded', 'false');
  }
  if (!event.target.closest('.column-picker')) document.querySelector('#columnPicker')?.classList.remove('open');
});
document.querySelector('#tagToggle').onclick = () => document.querySelector('#tagbar').classList.toggle('collapsed');
document.addEventListener('wheel', event => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const current = forcedCols || columnCount();
  setColumns(event.deltaY > 0 ? current - 1 : current + 1);
}, { passive: false });

function updatePixivModeButtons() {
  const labels = pixivRating === 'r18'
    ? { daily: '今日', weekly: '本周', monthly: '月榜', ai: 'AI生成' }
    : { daily: '日榜', weekly: '周榜', monthly: '月榜', ai: 'AI榜' };
  document.querySelectorAll('.nav-pflow [data-pixiv-kind]').forEach(button => {
    const kind = button.dataset.pixivKind || 'daily';
    button.dataset.mode = pixivModeForKind(kind, pixivRating);
    button.textContent = labels[kind] || kind;
    button.hidden = pixivRating === 'r18' && kind === 'monthly';
  });
}
function updatePixivControls() {
  const controls = document.querySelector('#pixivControls');
  const input = document.querySelector('#pixivDate');
  if (!controls || !input) return;
  // The date bar belongs to Pixiv board modes, not local folders or search.
  // Keep this condition explicit so switching from Dflow's local favorites to
  // Pflow cannot leave the control permanently hidden.
  const visible = station === 'pflow' && isPixivMode(mode) && !manualSearchTags;
  controls.hidden = !visible;
  controls.classList.toggle('hidden', !visible);
  if (!visible) return;
  const today = localIsoDate();
  const value = pixivDate(mode);
  input.value = value > today ? today : value;
  input.max = today;
  const label = document.querySelector('#pixivDateLabel');
  if (label) {
    const kind = pixivKind(mode);
    const ratingLabel = pixivRating === 'r18' ? 'R18' : '全年龄';
    label.textContent = `${ratingLabel} · ${kind === 'ai' ? 'AI榜日期' : '榜单日期'}`;
  }
  const previous = document.querySelector('#pixivPrevDay');
  const next = document.querySelector('#pixivNextDay');
  if (previous) previous.disabled = false;
  if (next) next.disabled = input.value >= today;
}
function shiftPixivDate(days) {
  if (station !== 'pflow' || !isPixivMode(mode)) return;
  const current = pixivDate(mode);
  const [year, month, day] = current.split('-').map(Number);
  const value = new Date(year, month - 1, day);
  value.setDate(value.getDate() + Number(days || 0));
  const next = localIsoDate(value);
  const today = localIsoDate();
  if (next > today) return;
  savePixivDate(mode, next);
  viewCache.delete(viewKey());
  updatePixivControls();
  load(true);
}
function choosePixivDate(value) {
  if (station !== 'pflow' || !isPixivMode(mode)) return;
  const normalized = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || normalized > localIsoDate()) {
    updatePixivControls();
    return;
  }
  savePixivDate(mode, normalized);
  viewCache.delete(viewKey());
  updatePixivControls();
  load(true);
}
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
  updatePixivModeButtons();
  updateRatingMenuForStation();
  updatePixivControls();
}

function switchStation(next) {
  const targetStation = next || (station === 'dflow' ? 'pflow' : 'dflow');
  if (targetStation === station && next) return;
  const previousStation = station;
  station = targetStation;
  // A Dflow search/tag query is not a Pflow board query. Leaving it in place
  // made the Pixiv date row disappear because the page still considered itself
  // a search view after the station switch. Entering Pflow therefore starts on
  // its selected ranking board; the user can type a new Pixiv search afterward.
  if (station === 'pflow' && previousStation !== 'pflow') {
    manualSearchTags = '';
    if (searchInput) searchInput.value = '';
    selectedPopularTags.clear();
    drawTags();
    updateSelectedTagCount();
  }
  localStorage.setItem('dflow_station', station);
  updateStationUI();

  const dflowModes = new Set(['latest', 'popular-day', 'popular-week', 'popular-month', 'viewed', 'favcount', 'comment', 'upvotes', 'score', 'rank', 'mpixels']);
  const pflowModes = new Set([...PIXIV_MODES, 'pixiv-r18']);

  // Favorites / metadata are shared navigation items and are not a Pixiv
  // board.  When the user switches stations while one of those items is open,
  // enter Pixiv's default board so the date bar and Pixiv rating selector are
  // immediately available instead of leaving the page on the local gallery.
  if (station === 'pflow' && !pflowModes.has(mode)) {
    const nextMode = mode === 'pixiv-r18'
      ? 'pixiv-r18-daily'
      : pixivModeForKind('daily', pixivRating);
    selectMode(nextMode, document.querySelector(`[data-mode="${nextMode}"]`));
  } else if (station === 'dflow' && pflowModes.has(mode)) {
    selectMode('latest');
  } else {
    load(true);
  }
}

document.querySelector('#stationSwitch').onclick = () => switchStation();
document.querySelector('#pixivPrevDay')?.addEventListener('click', () => shiftPixivDate(-1));
document.querySelector('#pixivNextDay')?.addEventListener('click', () => shiftPixivDate(1));
document.querySelector('#pixivToday')?.addEventListener('click', () => {
  if (station !== 'pflow' || !isPixivMode(mode)) return;
  savePixivDate(mode, localIsoDate());
  viewCache.delete(viewKey());
  updatePixivControls();
  load(true);
});
document.querySelector('#pixivDate')?.addEventListener('change', event => choosePixivDate(event.target.value));

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
  try {
    const response=await fetch('/api/mcp/sessions',{cache:'no-store'});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);
    const targetResponse=await fetch('/api/mcp/direct-target',{cache:'no-store'});
    const targetState=await targetResponse.json().catch(()=>({}));
    const targetId=String(targetState.sessionId || localStorage.getItem(DIRECT_SESSION_KEY) || '');
    if (targetId) localStorage.setItem(DIRECT_SESSION_KEY,targetId);
    container.replaceChildren();
    if(!result.length){
      container.textContent=targetId ? '当前没有连接中的 Agent（已保留原直推目标）' : '当前没有连接中的 Agent';
      return;
    }
    const liveIds=new Set(result.map(session=>String(session.id)));
    for(const session of result){
      const row=document.createElement('div'); row.className='mcp-session';
      const label=document.createElement('span'); label.className='mcp-session-label';
      const isTarget=String(session.id)===String(targetId);
      label.textContent=`${session.name} ${session.version || ''} · 已连接 ${new Date(session.since).toLocaleTimeString()}${isTarget?' · 直推目标':''}`;
      const actions=document.createElement('span'); actions.className='mcp-session-actions';
      const target=document.createElement('button'); target.type='button'; target.className='btn-subtle';
      target.textContent=isTarget?'当前直推目标':'设为直推目标'; target.disabled=isTarget;
      target.title=isTarget?'平板上的 AI直推会发送到此 Agent':'将平板上的 AI直推固定发送到此 Agent';
      target.onclick=async()=>{
        try {
          const selected=await fetch('/api/mcp/direct-target',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:String(session.id)})});
          const data=await selected.json().catch(()=>({})); if(!selected.ok) throw Error(data.error||`HTTP ${selected.status}`);
          localStorage.setItem(DIRECT_SESSION_KEY,String(session.id)); refreshMcpSessions();
        } catch(error) { toast(`设置直推目标失败：${error.message}`); }
      };
      const disconnect=document.createElement('button'); disconnect.type='button'; disconnect.className='btn-subtle'; disconnect.textContent='断开';
      disconnect.onclick=async()=>{if(!confirm(`断开 ${session.name} 的当前 MCP 会话？`))return;try{await fetch(`/api/mcp/sessions/${encodeURIComponent(session.id)}`,{method:'DELETE'});}finally{refreshMcpSessions();}};
      actions.append(target,disconnect); row.append(label,actions); container.append(row);
    }
    if(targetId&&!liveIds.has(String(targetId))){
      const note=document.createElement('div'); note.className='mcp-session-offline';
      note.textContent='已固定的直推目标当前离线；重新连接后会继续使用该目标。'; container.append(note);
    }
    const clear=document.createElement('button'); clear.type='button'; clear.className='btn-subtle mcp-clear-target'; clear.textContent='取消固定直推目标'; clear.disabled=!targetId;
    clear.onclick=async()=>{
      try { await fetch('/api/mcp/direct-target',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:''})}); } catch {}
      localStorage.removeItem(DIRECT_SESSION_KEY); refreshMcpSessions();
    }; container.append(clear);
  }catch(error){container.textContent='读取连接失败：'+error.message;}
}
async function refreshDshSessions(){
  const container=document.querySelector('#dshSessions');
  const status=document.querySelector('#dshBridgeStatus');
  if(!container || !status) return;
  container.textContent='正在读取 DSH 窗口…';
  try {
    const response=await fetch('/api/dsh/status',{cache:'no-store'});
    const result=await response.json().catch(()=>({}));
    if(!response.ok && !result.error) throw Error(`HTTP ${response.status}`);
    container.replaceChildren();
    if(!result.available){
      status.textContent=`DSH Bridge 不可用：${result.error || '请先启动 DSH Desktop'}`;
      container.textContent='暂时无法读取 DSH 窗口；AI直推任务仍会保留在 MCP 队列。';
      return;
    }
    status.textContent=result.configuredSessionId ? `已连接 · 固定窗口：${result.configuredTitle || result.configuredSessionId}` : '已连接 · 只有一个在线窗口时会自动使用它';
    const sessions=Array.isArray(result.sessions)?result.sessions:[];
    if(!sessions.length){container.textContent='没有找到 DSH 聊天窗口';return;}
    for(const session of sessions){
      const row=document.createElement('div');row.className='mcp-session';
      const label=document.createElement('span');label.className='mcp-session-label';
      label.textContent=`${session.title || '未命名窗口'} · ${session.live ? '在线' : '离线'}${session.readOnly ? ' · 只读' : ''}`;
      const actions=document.createElement('span');actions.className='mcp-session-actions';
      const choose=document.createElement('button');choose.type='button';choose.className='btn-subtle';choose.textContent=session.selected?'当前 AI直推窗口':'设为 AI直推窗口';choose.disabled=!session.live || session.readOnly || session.selected;choose.title=session.selected?'网页 AI直推会唤起此 DSH 窗口':'让网页 AI直推唤起此 DSH 窗口';
      choose.onclick=async()=>{try{const selected=await fetch('/api/dsh/target',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.sessionId})});const data=await selected.json().catch(()=>({}));if(!selected.ok)throw Error(data.error||`HTTP ${selected.status}`);refreshDshSessions();}catch(error){toast(`设置 DSH 直推窗口失败：${error.message}`)}};
      actions.append(choose);row.append(label,actions);container.append(row);
    }
    const clear=document.createElement('button');clear.type='button';clear.className='btn-subtle mcp-clear-target';clear.textContent='取消固定 DSH 窗口';clear.disabled=!result.configuredSessionId;clear.onclick=async()=>{try{await fetch('/api/dsh/target',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:''})});refreshDshSessions();}catch(error){toast(`清除 DSH 窗口失败：${error.message}`)}};container.append(clear);
  }catch(error){status.textContent='DSH 状态读取失败';container.textContent=error.message;}
}
document.querySelector('#refreshMcpSessions').onclick=refreshMcpSessions;
document.querySelector('#refreshDshSessions').onclick=refreshDshSessions;
document.querySelector('#copyMcpConfig').onclick=async()=>{try{await copyTextToClipboard(document.querySelector('#mcpConnectionConfig').value);toast('已复制 MCP 连接配置');}catch(error){toast('复制失败：'+error.message)}};
fetch('/api/mcp/setup').then(response=>response.json()).then(config=>{
  if(!config.args)throw Error('只能在运行 DFlow 的电脑上查看连接配置');
  document.querySelector('#mcpConnectionConfig').value=JSON.stringify({mcpServers:{'dflow-local':{command:config.command,args:config.args,env:{DFLOW_PORT:String(config.port)}}}},null,2);
}).catch(error=>{document.querySelector('#mcpConnectionConfig').value=error.message;});
setInterval(()=>{if(document.querySelector('#settingsDialog').open&&document.querySelector('#tabMcp').classList.contains('active')){refreshMcpSessions();refreshDshSessions();}},6000);

let mcpPresetRendered=false;
// Settings Dialog Tabs
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.toggle('active', p.id === tab.dataset.tab));
    if(tab.dataset.tab==='tabMcp') {
      if(!mcpPresetRendered){loadPresetConfig().then(ok=>{if(ok){renderMcpPresets();mcpPresetRendered=true;}});}
      refreshMcpSessions();
      refreshDshSessions();
    }
  };
});

document.querySelector('#closeSettingsHeader').onclick = () => document.querySelector('#settingsDialog').close();
document.querySelector('#closeSettings').onclick = () => document.querySelector('#settingsDialog').close();

const tiltSlider = document.querySelector('#tiltSlider');
const tiltVal = document.querySelector('#tiltVal');
if (tiltSlider && tiltVal) {
  tiltSlider.value = currentTiltDeg;
  tiltVal.textContent = `${currentTiltDeg}°`;
  tiltSlider.addEventListener('input', (e) => {
    currentTiltDeg = parseInt(e.target.value, 10);
    if (isNaN(currentTiltDeg)) currentTiltDeg = 0;
    tiltVal.textContent = `${currentTiltDeg}°`;
    try {
      localStorage.setItem('dflowTiltSensitivity', String(currentTiltDeg));
    } catch {}
  });
}

document.querySelector('#settings').onclick = () => {
  const dialog = document.querySelector('#settingsDialog');
  if (tiltSlider && tiltVal) {
    tiltSlider.value = currentTiltDeg;
    tiltVal.textContent = `${currentTiltDeg}°`;
  }
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
    mode, columns: columnCount(), ratings: station === 'dflow' ? [...dflowRatings] : [...dflowRatings],
    pixivRating, pixivDates: readPixivDates(), search: manualSearchTags,
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
  const savedMode = String(preferences.mode || '');
  const legacyPixivMode = savedMode === 'pixiv-r18' ? 'pixiv-r18-daily' : savedMode;
  const hasSavedPixivMode = PIXIV_MODES.has(legacyPixivMode);
  if (hasSavedPixivMode) {
    station = 'pflow';
    pixivRating = PIXIV_R18_MODES.has(legacyPixivMode)
      ? 'r18'
      : (preferences.pixivRating === 'r18' ? 'r18' : 'safe');
    mode = pixivModeForKind(pixivKind(legacyPixivMode), pixivRating);
  } else if (station === 'pflow') {
    pixivRating = preferences.pixivRating === 'r18' ? 'r18' : (localStorage.getItem(PIXIV_RATING_KEY) === 'r18' ? 'r18' : 'safe');
    mode = isPixivMode(savedMode) ? pixivModeForKind(pixivKind(savedMode), pixivRating) : pixivModeForKind('daily', pixivRating);
  } else {
    mode = validModes.has(savedMode) && !isPixivMode(savedMode) ? savedMode : 'latest';
  }
  localStorage.setItem(PIXIV_RATING_KEY, pixivRating);
  forcedCols = Math.max(3, Math.min(8, Number(preferences.columns) || 5));
  document.documentElement.style.setProperty('--cols', forcedCols);
  const ratings = Array.isArray(preferences.ratings) && preferences.ratings.length
    ? new Set(preferences.ratings.filter(value => ['g', 's', 'q', 'e'].includes(value)))
    : new Set(['g', 's', 'q', 'e']);
  dflowRatings = ratings.size ? ratings : new Set(['g', 's', 'q', 'e']);
  if (preferences.pixivDates && typeof preferences.pixivDates === 'object') {
    const dates = {};
    for (const modeName of PIXIV_MODES) {
      const value = preferences.pixivDates[modeName];
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= localIsoDate()) dates[modeName] = value;
    }
    localStorage.setItem(PIXIV_DATE_KEY, JSON.stringify(dates));
  }
  manualSearchTags = normalizeSearchTags(preferences.search);
  // A persisted Dflow search must not hide the Pflow ranking date controls
  // after a station switch or a shared-state restore.
  if (station === 'pflow' && isPixivMode(mode)) manualSearchTags = '';
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
  const initialRevision = favoriteStateRevision;
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const remote = await response.json();
    // Do not replace a collection changed while the first state request was in
    // flight.  This matters on a tablet where the user can tap a card quickly
    // while the initial page is still booting.
    const canApplyRemote = initialRevision === favoriteStateRevision;
    if (canApplyRemote) sharedUpdatedAt = remote.updatedAt || '';
    if (canApplyRemote && Array.isArray(remote.favorites) && remote.favorites.length) {
      favoriteCache = remote.favorites;
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteCache));
    } else if (canApplyRemote && localFavorites.length) {
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
const favoriteLayoutFields = [
  'id', 'folder', 'prompt', 'positive', 'promptWrittenAt', 'wordedAt', 'completedAt',
  'autoEnabled', 'queueOrder', 'preset', 'resolvedPreset', 'customInstruction',
  'image_width', 'image_height', 'imageExt', 'width', 'height',
  'cacheStatus', 'cacheFile', 'cacheError', 'source', 'rating',
  'preview_file_url', 'large_file_url', 'file_url'
];
function favoriteGalleryNeedsRebuild(previous, next) {
  if (!Array.isArray(previous) || previous.length !== next.length) return true;
  const before = new Map(previous.map(item => [String(item.id), item]));
  for (const item of next) {
    const old = before.get(String(item.id));
    if (!old) return true;
    if (favoriteLayoutFields.some(field => String(old[field] ?? '') !== String(item[field] ?? ''))) return true;
  }
  return false;
}
function syncRenderedFavoriteCards(items) {
  if (mode !== 'favorites') return;
  for (const item of items) {
    if (postFolder(item) !== favoriteFolder) continue;
    const selector = favoriteFolder === 'original'
      ? `.card[data-favorite-id="${CSS.escape(String(item.id))}"]`
      : `.reverse-card[data-reverse-id="${CSS.escape(String(item.id))}"]`;
    const card = gallery.querySelector(selector);
    card?._updateFavoriteState?.(item);
  }
}

async function pullSharedFavorites() {
  if (sharedFavoritesPulling) return;
  sharedFavoritesPulling = true;
  const revision = favoriteStateRevision;
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) return;
    const remote = await response.json();
    const timestampChanged = Boolean(remote.updatedAt && remote.updatedAt !== sharedUpdatedAt);
    const favoritesChanged = Array.isArray(remote.favorites) && JSON.stringify(remote.favorites) !== JSON.stringify(favoriteCache);
    if (!timestampChanged && !favoritesChanged) return;
    const canApplyFavorites = revision === favoriteStateRevision;
    if (canApplyFavorites && remote.updatedAt) sharedUpdatedAt = remote.updatedAt;
    if (Array.isArray(remote.favorites) && favoritesChanged && canApplyFavorites) {
      const previous = favoriteCache;
      favoriteCache = remote.favorites;
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteCache));
      updateFavoriteCount();
      document.querySelectorAll('[data-favorite-id]').forEach(button => updateFavoriteButtons(button.dataset.favoriteId));
      if (mode === 'favorites') {
        if (favoriteGalleryNeedsRebuild(previous, favoriteCache)) refreshFavoriteGallery(true);
        else syncRenderedFavoriteCards(favoriteCache);
      }
      if (mode === 'metadata') loadMetadataGallery();
    }
    if (remote.account && timestampChanged && canApplyFavorites) {
      if (remote.account.loginName) localStorage.loginName = remote.account.loginName;
      if (remote.account.loginKey) localStorage.loginKey = remote.account.loginKey;
      if (remote.account.pixivCookie) localStorage.pixivCookie = remote.account.pixivCookie;
      if (remote.account.primaryTranslator) localStorage.primaryTranslator = remote.account.primaryTranslator;
    }
  } catch {} finally {
    sharedFavoritesPulling = false;
  }
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
async function checkForUpdates() {
  const seen = localStorage.getItem('dflowUpdateSkip') || '';
  try {
    const response = await fetch('/api/version', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result.ok || !result.updateAvailable) return;
    const remote = result.latest?.commit || result.latest?.version || '';
    if (!remote || seen === 'permanent' || seen === remote) return;
    const dialog = document.querySelector('#updateDialog');
    dialog.querySelector('.update-current').textContent = `${result.current.version} · ${String(result.current.commit || '').slice(0, 7) || '本地版本'}`;
    const remoteVersion = result.latest?.version ? `v${result.latest.version} \u00b7 ` : '';
    const remoteCommit = result.latest?.commit ? String(result.latest.commit).slice(0, 7) : '\u8fdc\u7a0b\u7248\u672c';
    dialog.querySelector('.update-latest').textContent = `${remoteVersion}${remoteCommit}${result.latest.message ? ` \u00b7 ${result.latest.message}` : ''}`;
    dialog.dataset.remote = remote;
    const statusText = dialog.querySelector('#updateStatusText');
    if (statusText) { statusText.hidden = true; statusText.textContent = ''; statusText.className = 'update-status-text'; }
    const nowBtn = dialog.querySelector('#updateNow');
    if (nowBtn) { nowBtn.disabled = false; nowBtn.textContent = '一键拉取更新'; }
    dialog.querySelectorAll('.update-dialog-actions button').forEach(b => b.disabled = false);
    dialog.showModal();
  } catch { /* GitHub unavailable should never interrupt browsing. */ }
}
const updateNowBtn = document.querySelector('#updateNow');
if (updateNowBtn) {
  updateNowBtn.onclick = async () => {
    const dialog = document.querySelector('#updateDialog');
    const statusText = dialog.querySelector('#updateStatusText');
    const buttons = dialog.querySelectorAll('.update-dialog-actions button');
    buttons.forEach(b => b.disabled = true);
    updateNowBtn.textContent = '正在拉取...';
    if (statusText) {
      statusText.hidden = false;
      statusText.className = 'update-status-text';
      statusText.textContent = '正在从 GitHub 远程仓库拉取最新代码到本地...';
    }
    try {
      const res = await fetch('/api/version/update', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.detail || '拉取失败');
      }
      if (statusText) {
        statusText.className = 'update-status-text success';
        statusText.textContent = '更新成功！正在自动刷新页面...';
      }
      updateNowBtn.textContent = '更新成功';
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      if (statusText) {
        statusText.className = 'update-status-text error';
        statusText.textContent = `更新失败: ${err.message}`;
      }
      buttons.forEach(b => b.disabled = false);
      updateNowBtn.textContent = '重试更新';
    }
  };
}
document.querySelector('#updateLater').onclick = () => document.querySelector('#updateDialog').close();
document.querySelector('#updateSkipOnce').onclick = () => { localStorage.setItem('dflowUpdateSkip', document.querySelector('#updateDialog').dataset.remote || ''); document.querySelector('#updateDialog').close(); };
document.querySelector('#updateSkipForever').onclick = () => { localStorage.setItem('dflowUpdateSkip', 'permanent'); document.querySelector('#updateDialog').close(); };
initializeSharedState();
setTimeout(checkForUpdates, 900);
setInterval(pullSharedFavorites, 10000);
window.addEventListener('focus', () => pullSharedFavorites());
document.addEventListener('visibilitychange', () => { if (!document.hidden) pullSharedFavorites(); });




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
async function loadWordedGallery(preserveScroll = false, renderId = ++galleryRenderRequest) {
  const requestId = ++wordedGalleryRequest;
  const requestedFolder = favoriteFolder;
  if (mode !== 'favorites' || !['worded','pending','completed'].includes(favoriteFolder)) return;
  const top = scrollY;
  try {
    const res = await fetch('/api/worded/entries', {cache:'no-store'});
    if (!res.ok) throw Error('HTTP ' + res.status);
    const entries = await res.json();
    // Folder switches and refreshes can overlap.  A late response from the
    // previous folder must never paint its old card shape over the new view.
    if (requestId !== wordedGalleryRequest || renderId !== galleryRenderRequest || mode !== 'favorites' || favoriteFolder !== requestedFolder) return;
    const posts = readFavorites()
      .filter(item => postFolder(item) === requestedFolder)
      .filter(favoriteMatches)
      .sort((a, b) => requestedFolder === 'pending'
        ? Number(a.autoEnabled === false) - Number(b.autoEnabled === false) ||
          ((displayQueueOrder(a.queueOrder) ?? Infinity) - (displayQueueOrder(b.queueOrder) ?? Infinity))
        : compareGalleryItems(a, b, requestedFolder));
    const visible = entries.filter(item => (item.folder || 'worded') === requestedFolder);
    resetColumns(); currentPosts = posts.slice();
    if (requestedFolder === 'worded' || requestedFolder === 'completed') {
      const rows = [
        ...posts.map(value => ({ kind: 'favorite', value })),
        ...visible.map(value => ({ kind: 'entry', value }))
      ];
      rows.forEach((row, index) => row.index = index);
      rows.sort((a, b) => compareGalleryItems(a.value, b.value, requestedFolder, a.index, b.index));
      for (const row of rows) {
        row.kind === 'favorite'
          ? renderReverseCard(row.value, {kind: 'favorite', folder: requestedFolder})
          : renderWordedCard(row.value);
      }
    } else {
      // Favorites and hand-written cards share one pending queue.  Render them
      // from one sorted list as well; rendering the two collections separately
      // lets stale queueOrder values leak into the circular number buttons and
      // makes the visible order disagree with /api/reverse/queue.
      const rows = [
        ...posts.map(value => ({ kind: 'favorite', value })),
        ...visible.map(value => ({ kind: 'worded', value }))
      ];
      rows.forEach((row, index) => { row.index = index; });
      rows.sort(comparePendingRows);
      let queuePosition = 0;
      for (const row of rows) {
        const options = { kind: row.kind, folder: 'pending' };
        if (pendingQueueActive(row.value)) options.displayQueueOrder = ++queuePosition;
        row.kind === 'favorite'
          ? renderReverseCard(row.value, options)
          : renderWordedCard(row.value, options);
      }
    }
    statusEl.textContent = folderName[requestedFolder] + ' ' + (posts.length + visible.length) + ' 张';
    const count = document.querySelector('#wordedCount');
    if (count) count.textContent = entries.filter(item => (item.folder || 'worded') === 'worded').length + readFavorites().filter(item => postFolder(item) === 'worded').length;
    ended = true; sentinel.classList.remove('loading'); sentinel.classList.add('done');
    if (preserveScroll) requestAnimationFrame(() => {
      if (requestId === wordedGalleryRequest && renderId === galleryRenderRequest && mode === 'favorites' && favoriteFolder === requestedFolder) scrollTo({top});
    });
  } catch (error) {
    if (requestId === wordedGalleryRequest && renderId === galleryRenderRequest) statusEl.textContent = '读取有词区失败：' + error.message;
  }
}
async function changeWordedFolder(item, folder) {
  const sourceFolder = favoriteFolder;
  invalidateGalleryRequests();
  const renderId = galleryRenderRequest;
  try {
    const response = await fetch(`/api/worded/state/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder })
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
    Object.assign(item, data.entry || data.item || {});

    if (mode === 'favorites' && favoriteFolder === sourceFolder &&
        ['worded', 'completed'].includes(sourceFolder) && sourceFolder !== folder) {
      if (sourceFolder === 'worded' && folder !== 'worded') adjustWordedCount(-1);
      if (sourceFolder !== 'worded' && folder === 'worded') adjustWordedCount(1);
      removeVisibleCard(item.id);
      toast(`已移到“${folderName[folder]}”`);
      return;
    }
    await loadWordedGallery(true, renderId);
  } catch (error) {
    toast(`移动失败：${error.message}`);
  }
}
function renderWordedCard(item, options = {}) {
  const folder = ['pending', 'worded', 'completed'].includes(item.folder) ? item.folder : 'worded';
  return renderReverseCard(item, {
    kind: 'worded',
    folder,
    ...options
  });
}
function renderMetadataCard(item, collection = 'metadata') {
  if (collection === 'worded') return renderWordedCard(item);

  const card = document.createElement('article');
  const isLandscape = item.width > item.height;
  card.className = `reverse-card metadata-card 3d-card ${item.source === '手写' && !item.imageExt ? 'text-only' : isLandscape ? 'landscape' : 'portrait'}`;
  card.dataset.reverseId = String(item.id);

  const imageUrl = item.imageExt || item.source !== '手写'
    ? `/api/${collection}/images/${encodeURIComponent(item.id)}`
    : '';

  const cardWrapper = document.createElement('div');
  cardWrapper.className = 'card-wrapper';
  if (imageUrl) {
    cardWrapper.style.setProperty('--card-bg-img', `url("${imageUrl}")`);
  }

  const cardInner = document.createElement('div');
  cardInner.className = 'card-inner';

  const cardHolo = document.createElement('div');
  cardHolo.className = 'card-holo';
  cardHolo.style.display = 'none'; // 闪卡默认关闭

  // ---------------- FRONT FACE: 纯粹满幅画芯（无侧边 UI 栏） ----------------
  const frontFace = document.createElement('div');
  frontFace.className = 'card-face card-front full-bleed-front';

  const artworkContainer = document.createElement('div');
  artworkContainer.className = 'artwork-container full-artwork';

  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'art-img';
    img.loading = 'lazy';
    img.alt = item.name || '元数据图片';
    img.src = imageUrl;
    if (item.width && item.height) {
      img.style.aspectRatio = `${item.width} / ${item.height}`;
    }
    img.ondblclick = () => openLightbox({image_width: item.width, image_height: item.height}, card, img.src);
    const specular = document.createElement('div');
    specular.className = 'art-specular';
    artworkContainer.append(img, specular);

    // Floating HD Button in Top-Left Corner
    const floatingHdBtn = document.createElement('button');
    floatingHdBtn.type = 'button';
    floatingHdBtn.className = 'floating-hd-badge';
    floatingHdBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`;
    floatingHdBtn.title = '查看高清大图';
    floatingHdBtn.onclick = (e) => {
      e.stopPropagation();
      openLightbox({image_width: item.width, image_height: item.height}, card, imageUrl);
    };
    artworkContainer.append(floatingHdBtn);
  } else {
    const summary = document.createElement('span');
    summary.className = 'text-summary';
    summary.textContent = item.summary || item.positive?.slice(0, 30) || '暂无图片';
    artworkContainer.append(summary);
  }

  frontFace.append(artworkContainer);

  // ---------------- BACK FACE: 5 层次（底模、生图参数、正面提示词、详细参数、删除按钮） ----------------
  const backFace = document.createElement('div');
  backFace.className = 'card-face card-back metadata-back';

  // 1. 底模 (Model)
  const modelSection = document.createElement('div');
  modelSection.className = 'meta-section';
  const modelTitle = document.createElement('span');
  modelTitle.className = 'meta-label-title';
  modelTitle.textContent = '底模 (Model)';
  const modelBadge = document.createElement('div');
  modelBadge.className = 'meta-model-badge';
  modelBadge.textContent = item.model || '未识别';
  modelBadge.title = item.model || '未识别';
  modelSection.append(modelTitle, modelBadge);
  backFace.append(modelSection);

  // 2. 生图参数 (Parameters)
  const paramsSection = document.createElement('div');
  paramsSection.className = 'meta-section';
  const paramsTitle = document.createElement('span');
  paramsTitle.className = 'meta-label-title';
  paramsTitle.textContent = '生图参数 (Parameters)';
  const paramsGrid = document.createElement('div');
  paramsGrid.className = 'meta-params-grid';
  const paramItems = [
    ['Steps', item.steps || '—'],
    ['Sampler', item.sampler || '—'],
    ['CFG', item.cfg || '—'],
    ['Size', item.width && item.height ? `${item.width}×${item.height}` : '—'],
    ['Seed', item.seed || '—'],
    ['Denoise', item.denoise || item.scheduler || '—']
  ];
  for (const [k, v] of paramItems) {
    const div = document.createElement('div');
    div.className = 'param-item';
    div.innerHTML = `<span class="k">${k}:</span> <span class="v">${v}</span>`;
    paramsGrid.append(div);
  }
  paramsSection.append(paramsTitle, paramsGrid);
  backFace.append(paramsSection);

  // 3. 正面提示词（可展开的框，默认折叠）
  const promptDetails = document.createElement('details');
  promptDetails.className = 'meta-fold-details';
  const promptSummary = document.createElement('summary');
  promptSummary.className = 'meta-fold-summary';
  promptSummary.innerHTML = `<span>正面提示词 (Prompt)</span><span class="fold-indicator">▼</span>`;
  const promptContent = document.createElement('div');
  promptContent.className = 'meta-fold-content';
  promptContent.contentEditable = 'true';
  promptContent.spellcheck = false;
  promptContent.textContent = item.positive || '无正向提示词';
  promptDetails.append(promptSummary, promptContent);
  backFace.append(promptDetails);

  // 4. 详细参数（也是可展开默认折叠，展开显示所有）
  const rawDetails = document.createElement('details');
  rawDetails.className = 'meta-fold-details';
  const rawSummary = document.createElement('summary');
  rawSummary.className = 'meta-fold-summary';
  rawSummary.innerHTML = `<span>详细参数 (All Raw Metadata)</span><span class="fold-indicator">▼</span>`;
  const rawContent = document.createElement('div');
  rawContent.className = 'meta-fold-content meta-raw-box';
  const rawParts = [];
  if (item.negative) rawParts.push(`反向提示词：\n${item.negative}\n`);
  if (item.loras?.length) rawParts.push(`LoRA：\n${item.loras.map(l => `${l.name} (${l.strength ?? 1.0})`).join('\n')}\n`);
  if (item.rawMetadata) {
    try {
      rawParts.push(typeof item.rawMetadata === 'string' ? item.rawMetadata : JSON.stringify(item.rawMetadata, null, 2));
    } catch { rawParts.push(String(item.rawMetadata)); }
  } else {
    rawParts.push(JSON.stringify({
      source: item.source,
      model: item.model,
      sampler: item.sampler,
      scheduler: item.scheduler,
      cfg: item.cfg,
      steps: item.steps,
      seed: item.seed,
      denoise: item.denoise
    }, null, 2));
  }
  rawContent.textContent = rawParts.join('\n') || '无详细元数据';
  rawDetails.append(rawSummary, rawContent);
  backFace.append(rawDetails);

  // 5. 删除按钮 (Delete Button)
  const deleteWrap = document.createElement('div');
  deleteWrap.className = 'meta-delete-wrap';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'meta-delete-btn';
  deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>删除此条元数据</span>`;
  deleteBtn.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm('删除此卡片及本地图片？')) return;
    const url = collection === 'worded' ? `/api/worded/entries/${encodeURIComponent(item.id)}` : `/api/metadata/images/${encodeURIComponent(item.id)}`;
    const res = await fetch(url, {method: 'DELETE'});
    if (res.ok) {
      if (collection === 'worded') loadWordedGallery();
      else loadMetadataGallery();
      toast('已删除卡片及元数据');
    } else {
      toast('删除失败');
    }
  };
  deleteWrap.append(deleteBtn);
  backFace.append(deleteWrap);

  cardInner.append(cardHolo, frontFace, backFace);
  cardWrapper.append(cardInner);
  card.append(cardWrapper);

  attach3DCardTilt(card, cardWrapper);
  attach3DCardFlip(card, cardInner);

  const metaWeight = Math.max(0.6, Math.min(2.5, (Number(item.height) || 1) / (Number(item.width) || 1)));
  appendRenderedCard(card, metaWeight);
}
document.querySelector('#manualWorded').onclick=()=>showPromptDialog('',{kind:'create'});
async function uploadFavoriteImage(id,file) {
  const revision = ++favoriteStateRevision;
  const bitmap=await createImageBitmap(file);
  const url=`/api/favorites/${encodeURIComponent(id)}/image?width=${bitmap.width}&height=${bitmap.height}`;
  bitmap.close();
  const response=await fetch(url,{method:'PUT',headers:{'Content-Type':file.type},body:file});
  const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);
  if (revision !== favoriteStateRevision) return result.favorite;
  const index=favoriteCache.findIndex(item=>String(item.id)===String(id));
  if(index>=0)favoriteCache[index]=result.favorite;
  localStorage.setItem(FAVORITES_KEY,JSON.stringify(favoriteCache));
  updateFavoriteCount();
  return result.favorite;
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
setInterval(() => {
  if (mode === 'metadata' && !document.activeElement?.matches('input,textarea') && !document.querySelector('#gallery .card-inner.flipped')) {
    loadMetadataGallery();
  }
}, 15000);
document.querySelector('#metadataFiles').onchange=async event=>{
  const files=[...event.target.files]; let success=0;
  for(const file of files){try{const res=await fetch(`/api/metadata/images?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':'image/png'},body:file});const body=await res.json();if(!res.ok)throw Error(body.error || `HTTP ${res.status}`);success++;}catch(e){toast(`${file.name}：${e.message}`)}}
  event.target.value='';if(success) {toast(`已导入 ${success} 张图片`);loadMetadataGallery();}
};
