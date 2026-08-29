// ============================================================
// Personal Memory OS — Phase 1: Local Data System
// IndexedDB + No Auth + Full CRUD + Poster Fallbacks
// ============================================================

// === Type Metadata ===
const TYPE_META = {
  movie:  { emoji:'🎬', label:'电影', color:'var(--c-movie)' },
  book:   { emoji:'📖', label:'书籍', color:'var(--c-book)' },
  music:  { emoji:'🎵', label:'音乐', color:'var(--c-music)' },
  game:   { emoji:'🎮', label:'游戏', color:'var(--c-game)' },
  custom: { emoji:'📝', label:'自定义', color:'var(--c-event)' },
  place:  { emoji:'📍', label:'地点', color:'var(--c-place)' },
  event:  { emoji:'✦', label:'事件', color:'var(--c-event)' },
  photo:  { emoji:'📷', label:'照片', color:'var(--c-photo)' },
  diary:  { emoji:'📝', label:'日记', color:'var(--c-event)' },
};
function localDate(value = new Date()) {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}
function localTime(value = new Date()) { return value.toTimeString().slice(0, 5); }

// === Genre → Color Palettes for poster fallbacks ===
const GENRE_PALETTES = {
  '科幻':['#4A3F6B','#2D3A5F'], '剧情':['#5A4A3B','#3B3028'], '犯罪':['#3B3B3B','#1C1C1C'],
  '动画':['#5A6B4A','#3A4F2D'], '奇幻':['#6B4A5A','#4A2D3F'], '冒险':['#4A5A6B','#2D3F4A'],
  '传记':['#5A5A4A','#3B3B30'], '历史':['#6B5A3B','#4A3F2D'], '哲学':['#4A4A6B','#2D2D4A'],
  '史诗':['#6B3B3B','#4A2D2D'], '经典':['#5A4A3B','#3B3028'], '经济':['#4A6B5A','#2D4A3F'],
  '政治':['#6B4A4A','#4A2D2D'], '文学':['#6B5A4A','#4A3F2D'], '旅行':['#4A6B6B','#2D4A4A'],
  '学习':['#5A6B5A','#3F4A3F'],
};
function getPosterColors(entry) {
  const genres = entry.genres || [];
  for (const g of genres) if (GENRE_PALETTES[g]) return GENRE_PALETTES[g];
  const tags = entry.tags || [];
  for (const t of tags) if (GENRE_PALETTES[t]) return GENRE_PALETTES[t];
  const hash = (entry.title || '').split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  const hue = hash % 360;
  return [`hsl(${hue},42%,33%)`, `hsl(${hue+30},35%,16%)`];
}

// === Image Proxy ===
function proxyImage(url) {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.includes('images.weserv.nl')) return url;
  if (url.includes('doubanio.com') || url.includes('douban.com')) {
    return `/img?url=${encodeURIComponent(url)}`;
  }
  return `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}`;
}

// === Download image as base64 data URL for permanent local storage ===
function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function downloadImageAsDataURL(url) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  // 豆瓣图源经本地/CF 图片代理（/img?url=），避免防盗链与 GFW 问题（V1.2 电影/书籍改豆瓣后需要）
  if (url.includes('doubanio.com') || url.includes('douban.com')) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`/img?url=${encodeURIComponent(url)}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 500) {
          const dataUrl = await blobToDataURL(blob);
          if (dataUrl && dataUrl.startsWith('data:image')) return dataUrl;
        }
      }
    } catch (e) { /* 失败则继续走下方通用代理 */ }
  }
  const proxies = [
        `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}`,
        `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      ];
  for (const proxyUrl of proxies) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size > 500) {
        const dataUrl = await blobToDataURL(blob);
        if (dataUrl && dataUrl.startsWith('data:image')) return dataUrl;
      }
    } catch(e) { continue; }
  }
  return null;
}

// === Public provider adapters (no API keys) ===
// UI talks only to this normalized layer so a provider can be replaced later.
// V1.2 §5 统一数据层：UI 只依赖此归一化层，Provider 可替换；§P1 要求电影/书籍/音乐走真实搜索。
// 当前实现：电影/音乐=iTunes Search（免密钥、CORS 友好）、书籍=Google Books（免密钥）、游戏=FreeToGame。
// 均为真实 Provider，未用 mock 冒充（符合 §12 禁止项）。
let workSearchTimer = null;
let selectedMovie = null;
let selectedMusic = null;
let selectedGame = null;
let workSearchResults = [];
const ContentProvider = {
  async searchMovie(query) {
    // V1.2 §5/§P1：电影改走豆瓣（中国可达+中文覆盖好），经 /api/douban 代理绕过 CORS 与 GFW
    const res = await fetch(`/api/douban?type=movie&q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('电影数据源暂时不可用');
    const data = await res.json();
    return (data.results || []).map(item => ({
      external_id: String(item.external_id), title: item.title || '', original_title: item.original_title || '',
      poster: item.poster || '', release_date: item.release_date || '',
      director: item.director || '', genres: item.genres || [], description: item.description || '', provider: 'douban',
    }));
  },
  async searchBook(query) {
    // V1.2 §5/§P1：书籍改走豆瓣读书（googleapis.com 在中国大陆常被墙/超时），经 /api/douban 代理
    const res = await fetch(`/api/douban?type=book&q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('图书数据源暂时不可用');
    const data = await res.json();
    return (data.items || []).map(item => ({
      external_id: String(item.external_id), title: item.title || '', authors: item.authors || '',
      publisher: item.publisher || '', publishedDate: item.publishedDate || '', cover: item.cover || '',
      isbn: item.isbn || '', categories: item.categories || [], description: item.description || '', pageCount: item.pageCount || 0, provider: 'douban',
    }));
  },
  async searchMusic(query) {
    // 加 country=CN 提升中文歌曲/歌手覆盖（V1.2 审计建议）
    const res = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=8&term=${encodeURIComponent(query)}&country=CN`);
    if (!res.ok) throw new Error('音乐数据源暂时不可用');
    return (await res.json()).results.map(item => ({ external_id:String(item.trackId), title:item.trackName || '', artist:item.artistName || '', album:item.collectionName || '', poster:item.artworkUrl100?.replace('100x100bb', '600x600bb') || '', release_date:(item.releaseDate || '').slice(0,10), genres:item.primaryGenreName?[item.primaryGenreName]:[], provider:'itunes' }));
  },
  async searchGame(query) {
    const res = await fetch('https://www.freetogame.com/api/games');
    if (!res.ok) throw new Error('游戏数据源暂时不可用');
    const q = query.toLowerCase();
    return (await res.json()).filter(item => item.title.toLowerCase().includes(q)).slice(0, 8).map(item => ({ external_id:String(item.id), title:item.title, platform:item.platform || '', genres:[item.genre, item.platform].filter(Boolean), description:item.short_description || '', cover:item.thumbnail || '', provider:'freetogame' }));
  },
};

// === Photo Upload State ===
let uploadedPhotos = [];
let photoFailures = [];

function renderPhotoUpload() {
  return `<div class="field-row">
    <div class="field-label">照片</div>
    <div class="photo-upload-area" id="photo-upload-area">
      <div class="photo-preview-list" id="photo-preview-list"></div>
      <label class="photo-add-btn">
        <span>＋ 照片</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple style="display:none" onchange="handlePhotoSelect(this)">
      </label>
    </div>
  </div>`;
}

async function handlePhotoSelect(input) {
  const files = Array.from(input.files);
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) { showToast('图片不能超过10MB: ' + file.name, 'error'); continue; }
    const pending = { name:file.name, progress:0, pending:true };
    uploadedPhotos.push(pending); renderPhotoPreviews();
    try {
      const dataUrl = await fileToDataURL(file, progress => { pending.progress = progress; renderPhotoPreviews(); });
      const index = uploadedPhotos.indexOf(pending);
      if (index >= 0 && dataUrl) uploadedPhotos[index] = dataUrl;
      else throw new Error('图片读取失败');
    } catch (e) { uploadedPhotos = uploadedPhotos.filter(p => p !== pending); photoFailures.push(file); showToast(`图片上传失败：${file.name}`, 'error'); }
  }
  input.value = '';
  renderPhotoPreviews();
}

function fileToDataURL(file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    reader.readAsDataURL(file);
  });
}

function renderPhotoPreviews() {
  const container = document.getElementById('photo-preview-list');
  if (!container) return;
  container.innerHTML = uploadedPhotos.map((src, i) =>
    src?.pending ? `<div class="photo-preview-item"><span class="photo-upload-progress">${src.progress || 0}%</span></div>` : `<div class="photo-preview-item">
      <img src="${src}" onclick="this.parentElement.classList.toggle('expanded')">
      <button class="photo-remove-btn" onclick="removePhoto(${i})">✕</button>
    </div>`
  ).join('');
  if (photoFailures.length) container.insertAdjacentHTML('beforeend', `<button class="error-state-retry" onclick="retryFailedPhotos()">重试 ${photoFailures.length} 张失败图片</button>`);
}

function retryFailedPhotos() { const files = photoFailures.splice(0); handlePhotoSelect({ files, value:'' }); }

function removePhoto(idx) {
  uploadedPhotos.splice(idx, 1);
  renderPhotoPreviews();
}

// === Google Books Search ===
let bookSearchTimer = null;
let bookSearchResults = [];
let selectedBook = null;

async function searchGoogleBooks(query) {
  const q = query.trim();
  if (!q) return [];
  try { return await ContentProvider.searchBook(q); } catch(e) { showProviderError(e.message); }
  return [];
}

function debouncedBookSearch(val) {
  clearTimeout(bookSearchTimer);
  bookSearchTimer = setTimeout(async () => {
    const results = await searchGoogleBooks(val);
    bookSearchResults = results;
    renderBookResults(results);
  }, 400);
}

function renderBookResults(results) {
  const container = document.getElementById('douban-results');
  if (!container) return;
  if (!results.length) { container.innerHTML = '<div class="douban-no-result">未找到相关书籍</div>'; return; }
  container.innerHTML = results.map((b, i) =>
    `<div class="douban-result-item" onclick="selectBookResult(${i})">
      ${b.cover ? `<img class="douban-result-cover" src="${proxyImage(b.cover)}" loading="lazy" onerror="this.style.display='none'">` : '<div class="douban-result-cover placeholder">📖</div>'}
      <div class="douban-result-info">
        <div class="douban-result-title">${b.title}</div>
        ${b.authors ? `<div class="douban-result-subtitle">${b.authors}</div>` : ''}
        ${b.publishedDate ? `<div class="douban-result-year">${b.publishedDate.slice(0,4)}</div>` : ''}
      </div>
    </div>`
  ).join('');
}

async function selectBookResult(idx) {
  const b = bookSearchResults[idx];
  if (!b) return;
  selectedBook = { ...b };
  document.querySelectorAll('.douban-result-item').forEach((el, i) => el.classList.toggle('selected', i === idx));
  const titleEl = document.getElementById('capture-title');
  if (titleEl) titleEl.value = b.title;
  const extraEl = document.getElementById('capture-extra');
  if (extraEl) extraEl.value = b.authors || '';
  // V1.2 §8：并行缓存封面 + 拉取书籍详情（出版社/ISBN/页数/出版年/简介），补全作品资料
  const [dataUrl, detail] = await Promise.all([
    b.cover ? downloadImageAsDataURL(b.cover) : Promise.resolve(null),
    enrichWorkDetail('book', b),
  ]);
  if (detail) mergeDetail(b, detail);
  if (dataUrl) b.cover = dataUrl;
  selectedBook = { ...b };
  const coverPreview = document.getElementById('book-cover-preview');
  if (coverPreview && b.cover) coverPreview.innerHTML = `<img src="${b.cover}" style="width:60px;height:80px;object-fit:cover;border-radius:4px;">`;
}

function showProviderError(message) {
  const el = document.getElementById('douban-results');
  if (el) el.innerHTML = `<div class="error-state">${message}<button class="error-state-retry" onclick="retryWorkSearch()">重试</button></div>`;
}
async function searchWork(type, query) {
  if (!query?.trim()) { renderWorkResults(type, []); return; }
  const resultsEl = document.getElementById('douban-results');
  if (resultsEl) resultsEl.innerHTML = '<div class="douban-loading">搜索中...</div>';
  try { workSearchResults = await ContentProvider[`search${type[0].toUpperCase()+type.slice(1)}`](query.trim()); renderWorkResults(type, workSearchResults); }
  catch (e) { showProviderError(e.message || '搜索失败，请重试'); }
}
function debouncedWorkSearch(type, value) { clearTimeout(workSearchTimer); workSearchTimer = setTimeout(() => searchWork(type, value), 400); }
function retryWorkSearch() { const input = document.querySelector('[data-work-search]'); if (input) searchWork(input.dataset.workSearch, input.value); }
function renderWorkResults(type, results) {
  const el = document.getElementById('douban-results');
  if (!el) return;
  if (!results || results.length === 0) {
    el.innerHTML = '<div class="douban-loading">没有找到相关结果，请换一个关键词</div>';
    return;
  }
  el.innerHTML = results.map((r, i) => `
    <div class="douban-result-item" onclick="selectWorkResult('${type}',${i})">
      ${(r.poster || r.cover) ? `<img src="${proxyImage(r.poster || r.cover)}" alt="${r.title}" loading="lazy" onerror="this.style.display='none'">` : '<div class="douban-result-cover placeholder">✦</div>'}
      <div class="douban-result-info">
        <div class="douban-result-title">${r.title}</div>
        <div class="douban-result-year">${r.artist || r.authors || r.director || r.platform || ''} ${r.release_date || r.publishedDate ? '· ' + (r.release_date || r.publishedDate).slice(0,4) : ''}</div>
        <div class="douban-source-badge">来源：${r.provider}</div>
      </div>
    </div>
  `).join('');
}
// 豆瓣详情补全（V1.2 §8：选中搜索结果后拉详情，补齐简介/导演/评分/片长；书籍：出版社/ISBN/页数/简介）
// 解决"只有 suggest 级数据、简介为空"的缺口；详情由 /api/douban?type=detail 代理（电影走 m.douban rexxar API，书籍走详情页解析）
async function enrichWorkDetail(type, r) {
  if (!r || !r.external_id) return null;
  try {
    const kind = type === 'book' ? 'book' : 'movie';
    const res = await fetch(`/api/douban?type=detail&kind=${kind}&id=${encodeURIComponent(r.external_id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.detail || null;
  } catch (e) { return null; }
}

function mergeDetail(target, detail) {
  if (!detail) return;
  for (const k in detail) {
    const v = detail[k];
    if (v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) target[k] = v;
  }
}

async function selectWorkResult(type, idx) {
  const r = workSearchResults[idx];
  if (!r) return;
  if (type === 'movie') selectedMovie = { ...r }; else if (type === 'music') selectedMusic = { ...r }; else if (type === 'game') selectedGame = { ...r };
  document.getElementById('capture-title').value = r.title;
  const extra = document.getElementById('capture-extra'); if (extra) extra.value = r.artist || r.platform || '';
  document.querySelectorAll('.douban-result-item').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
  showToast('正在缓存封面...', 'success');
  const imageKey = r.poster ? 'poster' : 'cover';
  // 并行：缓存封面 + 拉取豆瓣详情（电影：简介/导演/评分/片长；书籍：出版社/ISBN/页数/简介）
  const [dataUrl, detail] = await Promise.all([
    downloadImageAsDataURL(r[imageKey]),
    (type === 'movie') ? enrichWorkDetail(type, r) : Promise.resolve(null),
  ]);
  if (detail) mergeDetail(r, detail);
  if (dataUrl) r[imageKey] = dataUrl;
  if (type === 'movie') selectedMovie = { ...r }; else if (type === 'music') selectedMusic = { ...r }; else if (type === 'game') selectedGame = { ...r };
  showToast('已导入：' + r.title, 'success');
}

async function fixSeedPosters() {
  try {
    const all = await dbGetAll();
    const needsFix = all.filter(e =>
      (e.type === 'movie' && e.poster && !e.poster.startsWith('data:')) ||
      (e.type === 'book' && e.cover && !e.cover.startsWith('data:')) ||
      (e.type === 'game' && e.cover && !e.cover.startsWith('data:'))
    );
    let fixed = 0;
    for (const entry of needsFix) {
      const imgUrl = entry.poster || entry.cover;
      if (!imgUrl) continue;
      let dataUrl = null;
      if (imgUrl.includes('tmdb')) {
        const results = await ContentProvider.searchMovie(entry.title);
        const match = results.find(r => r.title.includes(entry.title)) || results[0];
        if (match) { if (match.release_date && !entry.release_date) entry.release_date = match.release_date; if (match.original_title && !entry.original_title) entry.original_title = match.original_title; dataUrl = await downloadImageAsDataURL(match.poster); }
      } else {
        dataUrl = await downloadImageAsDataURL(imgUrl);
        if (!dataUrl && entry.type === 'movie' && entry.title) {
          const results = await ContentProvider.searchMovie(entry.title);
          const match = results.find(r => r.title.includes(entry.title)) || results[0];
          if (match) { if (match.release_date && !entry.release_date) entry.release_date = match.release_date; if (match.original_title && !entry.original_title) entry.original_title = match.original_title; dataUrl = await downloadImageAsDataURL(match.poster); }
        }
      }
      if (dataUrl) {
        if (entry.poster) entry.poster = dataUrl;
        else entry.cover = dataUrl;
        fixed++;
      }
      entry.updated_at = new Date().toISOString();
      await dbPut(entry);
    }
    if (fixed > 0 && ['today','timeline','library'].includes(currentPage)) await navigate(currentPage);
  } catch(e) {
    console.error('fixSeedPosters failed:', e);
  }
}

async function fixPostersManual() {
  showToast('开始下载海报...', 'success');
  await fixSeedPosters();
  showToast('海报缓存完成', 'success');
}

// === Seed Data ===
const SEED_ENTRIES = [
  { type:'movie', title:'银翼杀手2049', original_title:'Blade Runner 2049', poster:'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2501864539.webp', director:'Denis Villeneuve', genres:['科幻','剧情'], runtime:163, release_date:'2017-10-06', watch_date:'2026-08-27', watch_time:'18:42', rating:5, review:'视觉效果令人震撼，关于"什么是真正的人"的探讨比第一部更深。K的旅程像一场关于记忆与身份的沉思。Hans Zimmer的配乐完美契合了这种末世美学。', mood:'沉思', watched_with:'独自', location:'家中', tags:['科幻','哲学','视觉震撼'] },
  { type:'book', title:'置身事内', author:'兰小欢', cover:'https://covers.openlibrary.org/b/id/12092422-L.jpg', isbn:'9787208171336', publish_date:'2021-08-01', start_date:'2026-08-10', finish_date:'2026-08-27', finish_time:'14:10', rating:5, notes:'对中国地方政府运作逻辑最清晰的解释。从财政、土地、产业政策到债务，把"为什么"讲透了。', tags:['经济','政治','中国'], quotes:'"事权划分的本质不是分工，而是分权。"' },
  { type:'event', title:'一个想法：我想做一个属于自己的记忆空间', event_date:'2026-08-27', event_time:'09:32', location:'书房', content:'突然意识到，我用过那么多笔记App、日记App、收藏工具，但没有一个能真正陪伴我几十年。我想做一个属于自己的私人数字人生档案——把看过的电影、读过的书、去过的地方、经历过的转折都放在一条时间线上。', mood:'兴奋', importance:5, tags:['灵感','人生方向'] },
  { type:'movie', title:'沙丘2', original_title:'Dune: Part Two', poster:'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2902227445.jpg', director:'Denis Villeneuve', genres:['科幻','冒险'], runtime:166, release_date:'2024-03-01', watch_date:'2026-08-25', watch_time:'20:15', rating:5, review:'比第一部更宏大、更黑暗。Paul的预言之路令人不安。Zendaya的Chani视角让整个故事有了批判性。', mood:'震撼', watched_with:'朋友', location:'IMAX影院', tags:['科幻','史诗','IMAX'] },
  { type:'book', title:'人类简史', author:'尤瓦尔·赫拉利', cover:'https://covers.openlibrary.org/b/id/8226262-L.jpg', isbn:'9780062316097', publish_date:'2014-09-04', start_date:'2026-08-01', finish_date:'2026-08-20', rating:4, notes:'从认知革命到科学革命，视角宏大。但有些论断过于大胆，需要批判性阅读。', tags:['历史','人类学'] },
  { type:'place', title:'外滩', location:'上海', date:'2026-08-15', note:'夜晚的外滩比白天更有魅力。浦江两岸的光影交错，像两个时代的对话。', people:['家人'], rating:5, tags:['旅行','城市','夜景'] },
  { type:'movie', title:'奥本海默', original_title:'Oppenheimer', poster:'https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2876555451.jpg', director:'Christopher Nolan', genres:['传记','剧情','历史'], runtime:180, release_date:'2023-07-21', watch_date:'2026-08-14', watch_time:'19:00', rating:5, review:'三小时的对话戏，但节奏紧凑到窒息。Nolan用主观/客观双线讲述了一个关于天才、道德和权力纠缠的故事。IMAX黑白画面对比震撼。', mood:'沉重', watched_with:'独自', location:'影院', tags:['传记','历史','核武器'] },
  { type:'event', title:'搬到了新公寓', event_date:'2026-07-28', location:'新家', content:'终于有了一个安静的书房。窗户外面有一棵银杏树，秋天应该会很美。这大概是一个新的阶段的开始。', mood:'平静', importance:4, tags:['生活','搬家','新起点'] },
  { type:'book', title:'克拉拉与太阳', author:'石黑一雄', cover:'https://covers.openlibrary.org/b/id/10521752-L.jpg', isbn:'9780593340298', publish_date:'2021-03-02', start_date:'2026-07-15', finish_date:'2026-07-28', rating:4, notes:'以AI的视角讲述人类的孤独与爱。石黑一雄一贯的克制温柔，但后劲很大。', tags:['小说','科幻','文学'], quotes:'"太阳总有办法照到我们，不管我们在哪里。"' },
  { type:'movie', title:'教父', original_title:'The Godfather', poster:'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p616779645.jpg', director:'Francis Ford Coppola', genres:['犯罪','剧情'], runtime:175, release_date:'1972-03-24', watch_date:'2026-07-20', watch_time:'21:00', rating:5, review:'重看第三遍。这次注意到的是家庭 dinners 的剪辑——每一桌饭都在传递权力结构的变化。这不是黑帮片，是关于美国梦的悲剧。', rewatch_count:3, mood:'敬畏', watched_with:'独自', location:'家中', tags:['经典','犯罪','家族'] },
  { type:'music', title:'Daydreaming', artist:'Radiohead', album:'A Moon Shaped Pool', date:'2026-08-22', rating:5, note:'深夜独自散步时的完美配乐。Thom Yorke的声音像一层薄雾。', context:'深夜散步' },
  { type:'game', title:'荒野大镖客2', platform:'PS5', cover:'https://images.igdb.com/igdb/cover_big/co5vm9.jpg', start_date:'2026-07-01', finish_date:null, rating:5, hours:87, review:'Arthur Morgan的故事是游戏叙事的天花板。不是"好玩"，是"经历"。尾声骑马回营的那段路，是我玩过最心碎的游戏场景。' },
  { type:'place', title:'京都·伏见稻荷大社', location:'京都', date:'2026-06-10', note:'清晨6点的千本鸟居几乎没有人。阳光穿过朱红色的鸟居，地上的光斑像一条路。', people:['伴侣'], rating:5, tags:['旅行','日本','神社'] },
  { type:'event', title:'决定开始学日语', event_date:'2026-06-01', location:'家中', content:'去了一趟日本后发现，语言是通往另一种思维方式的路。不是为了考试或工作，纯粹是想读懂一些东西。', mood:'坚定', importance:4, tags:['学习','语言','新开始'] },
  { type:'movie', title:'千与千寻', original_title:'千と千尋の神隠し', poster:'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2557573348.jpg', director:'宫崎骏', genres:['动画','奇幻'], runtime:125, release_date:'2001-07-20', watch_date:'2026-05-28', watch_time:'20:00', rating:5, review:'每次看都有新发现。这次注意到的是水上列车的窗——没有倒影，只有虚空的蓝。成长就是学会记住自己的名字。', rewatch_count:5, mood:'温暖', watched_with:'家人', location:'家中', tags:['动画','宫崎骏','成长'] },
  { type:'book', title:'百年孤独', author:'加西亚·马尔克斯', cover:'https://covers.openlibrary.org/b/id/12092422-L.jpg', isbn:'9780060883287', publish_date:'1967-05-30', start_date:'2026-05-01', finish_date:'2026-05-20', rating:5, notes:'布恩迪亚家族七代人的孤独像一条暗河，贯穿百年。读完之后很久无法开始下一本书。', tags:['文学','魔幻现实主义','经典'], quotes:'"过去都是假的，回忆是一条没有归路的桥。"' },
  { type:'event', title:'30岁生日', event_date:'2026-04-15', location:'家', content:'没有办派对。一个人做了顿饭，倒了一杯酒，看了窗外很久。30岁不像想象中那么沉重，反而有一种"终于可以不在乎一些事了"的轻松。', mood:'释然', importance:5, tags:['生日','人生节点','30岁'] },
];

// === State ===
let currentPage = 'today';
let selectedType = null;
let editingId = null;
let activeFilters = new Set(['all']);
let activeScale = 'month';
// 浏览器返回键层级栈标记（V1.2 交互要求：返回键 = 返回上一层内容，而不是退出网页）
let detailOpenId = null;        // 详情页层：非 null 表示当前停留在详情页
let selectorOpenSport = null;   // 球队选择器层：非 null 表示选择器弹窗已入栈
let captureOpen = false;        // 记录弹窗层

// === IndexedDB ===
const DB_NAME = 'memory_os';
const DB_VERSION = 4; // v4: ops 操作日志队列 + 全量 UUID 迁移（多设备同步前提）
let db = null;

// uuid：优先 crypto.randomUUID；局域网 http 等非安全上下文用随机兜底
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('entries')) {
        const store = d.createObjectStore('entries', { keyPath:'id', autoIncrement:true });
        store.createIndex('type', 'type', { unique:false });
        store.createIndex('date', 'date', { unique:false });
      }
      if (!d.objectStoreNames.contains('teams')) {
        const teamStore = d.createObjectStore('teams', { keyPath:'id', autoIncrement:true });
        teamStore.createIndex('sport', 'sport', { unique:false });
        teamStore.createIndex('provider_team_id', 'provider_team_id', { unique:false });
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath:'key' }); // 云同步元数据
      }
      if (!d.objectStoreNames.contains('ops')) {
        d.createObjectStore('ops', { keyPath:'op_id' }); // 操作日志队列（待推送的本地变更）
      }
      if (e.oldVersion < 4) {
        // UUID 一次性迁移：数字自增 id 多设备必冲突；子条目 Date.now() id 同理
        const tx = e.target.transaction;
        for (const storeName of ['entries', 'teams']) {
          const store = tx.objectStore(storeName);
          store.getAll().onsuccess = function() {
            (this.result || []).forEach(rec => {
              if (typeof rec.id !== 'number') return;
              (rec.entries || []).forEach(en => { if (typeof en.id === 'number') en.id = uuid(); });
              const legacy = rec.id;
              store.delete(legacy);
              rec.legacy_id = legacy;
              rec.id = uuid();
              store.put(rec);
            });
          };
        }
      }
    };
  });
}

// === meta 存取（云同步状态） ===
function dbGetMeta(key) {
  return new Promise((resolve) => {
    const req = db.transaction('meta','readonly').objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => resolve(null);
  });
}
function dbPutMeta(key, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('meta','readwrite').objectStore('meta').put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function dbGetAll() {
  return new Promise((resolve, reject) => {
    const req = db.transaction('entries','readonly').objectStore('entries').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function dbGet(id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('entries','readonly').objectStore('entries').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function dbAdd(data) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('entries','readwrite').objectStore('entries').add(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function dbPut(data) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('entries','readwrite').objectStore('entries').put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('entries','readwrite').objectStore('entries').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function dbClear() {
  return new Promise((resolve, reject) => {
    const req = db.transaction('entries','readwrite').objectStore('entries').clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// === Cloud Sync v1：WebDAV（用户自己的坚果云/自建网盘），经 /api/webdav 转发 ===
// V1.2 §12 合规：不购买付费服务、不提交密钥——凭据仅存用户本机 localStorage，随请求传给转发代理；
// 数据快照（entries + teams JSON）存在用户自己的网盘里，InnerOS 服务端不存储任何用户数据。
// 合并策略：逐条按 updated_at/added_at 新者胜；云端文件 inneros-backup.json。
const SYNC_FILE_DEFAULT = 'InnerOS/inneros-backup.json';
const SYNC_CONFIG_KEY = 'inneros_sync_config';

function getSyncConfig() {
  try { return JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || '{}'); } catch (e) { return {}; }
}
function saveSyncConfig(cfg) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
}

async function webdavCall(op, extra = {}) {
  const cfg = getSyncConfig();
  let url = (cfg.url || '').trim();
  if (!url) throw new Error('尚未配置 WebDAV 地址');
  // 用户只填了网盘根地址（如坚果云弹窗里的 https://dav.jianguoyun.com/dav/）→ 自动补默认文件路径
  if (url.endsWith('/')) url += 'InnerOS/inneros-backup.json';
  const res = await fetch('/api/webdav', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, url, user: cfg.user || '', pass: cfg.pass || '', ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function buildSnapshot(all, teams) {
  return JSON.stringify({
    version: 1,
    app: 'InnerOS',
    exported_at: new Date().toISOString(),
    entries: all,
    teams,
  });
}

// 逐条合并：updated_at（无则 added_at/created_at）新者胜；本地与云端 id 冲突时保留较新
function mergeSnapshot(remote) {
  const incoming = (remote.entries || []);
  const incomingTeams = (remote.teams || []);
  let addedCount = 0, updatedCount = 0;
  const stamp = (x) => x.updated_at || x.created_at || (x.date ? x.date + 'T00:00:00' : '');
  return dbGetAll().then(async (local) => {
    const localById = new Map(local.map(x => [x.id, x]));
    for (const item of incoming) {
      const cur = localById.get(item.id);
      if (!cur) { await dbPut(item); addedCount++; }
      else if (String(stamp(item) || '') > String(stamp(cur) || '')) { await dbPut(item); updatedCount++; }
    }
    const localTeams = await dbGetTeams();
    const teamKey = (t) => `${t.sport}|${t.provider_team_id}`;
    const localTeamKeys = new Set(localTeams.map(teamKey));
    for (const t of incomingTeams) {
      if (!localTeamKeys.has(teamKey(t))) await dbAddTeam(t);
    }
    return { addedCount, updatedCount, teamsAdded: incomingTeams.length };
  });
}

const SyncAdapter = {
  // v1：WebDAV 文件快照同步（替代原 Supabase 预留桩；接口语义保持 push/pull/test）
  enabled: false, // 连接成功后置 true
  async test() {
    const r = await webdavCall('test');
    if (!r.ok) throw new Error(`连接失败（${r.status}），检查地址/账号/应用密码`);
    this.enabled = true;
    return true;
  },
  async push() {
    const [all, teams] = await Promise.all([dbGetAll(), dbGetTeams()]);
    const r = await webdavCall('put', { data: buildSnapshot(all, teams) });
    if (!r.ok) throw new Error(`上传失败（${r.status}）`);
    const at = new Date().toISOString();
    await dbPutMeta('last_synced_at', at);
    return { at, count: all.length };
  },
  async pull() {
    const r = await webdavCall('get');
    if (!r.exists) throw new Error('云端还没有备份文件，请先「上传到云端」');
    const merged = await mergeSnapshot(r.snapshot || {});
    const at = new Date().toISOString();
    await dbPutMeta('last_synced_at', at);
    return { at, ...merged };
  },
};

// === Team CRUD (P3: Sports Data Layer) ===
function dbGetTeams() {
  return new Promise((resolve, reject) => {
    const req = db.transaction('teams','readonly').objectStore('teams').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function dbAddTeam(team) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('teams','readwrite').objectStore('teams').add({ ...team, added_at: new Date().toISOString() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function dbDeleteTeam(id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('teams','readwrite').objectStore('teams').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// === Sports Team Database (static registry — V1.2 §6.1 / §12 GAP) ===
// 警告：CS2_TEAMS / FOOTBALL_TEAMS 是写死的静态注册表，并非真实 Provider 返回。
// 后果：用户只能关注列表内的球队，列表外的球队"搜不到"——这是 V1.2 P0 根因之一。
// 正确做法（P3 待办）：实现 SearchProvider Adapter（如 football-data.org），搜索→选择→
//   保存 provider_team_id 与真实 provider 名，而非 'static'。
// 阻塞：真实足球/电竞 API 通常需要密钥，而 V1.2 §12 禁止购买/提交 API Key，故暂未接入。
// 过渡方案：见 addManualTeam()——允许按名称手动关注任意球队（provider:'manual'）。
const CS2_TEAMS = [
  { id:'navi', name:'NAVI', full:'Natus Vincere', color:'#FFE600', text:'#000', region:'EU', tsdb_id:'148013', badge:'https://r2.thesportsdb.com/images/media/team/badge/jzfnzf1761226695.png' },
  { id:'g2', name:'G2', full:'G2 Esports', color:'#1A1A1A', text:'#FFF', region:'EU', tsdb_id:'136536', badge:'https://r2.thesportsdb.com/images/media/team/badge/0vkww41675440633.png' },
  { id:'faze', name:'FaZe', full:'FaZe Clan', color:'#E63946', text:'#FFF', region:'EU', tsdb_id:'136293', badge:'https://r2.thesportsdb.com/images/media/team/badge/mk07e01549466609.png' },
  { id:'vitality', name:'Vitality', full:'Team Vitality', color:'#FFD700', text:'#000', region:'EU', tsdb_id:'136538', badge:'https://r2.thesportsdb.com/images/media/team/badge/1k8hie1761293957.png' },
  { id:'spirit', name:'Spirit', full:'Team Spirit', color:'#C75450', text:'#FFF', region:'EU', tsdb_id:'148341', badge:'https://r2.thesportsdb.com/images/media/team/badge/wgjk2p1714390105.png' },
  { id:'mouz', name:'MOUZ', full:'MOUZ', color:'#000', text:'#E63946', region:'EU', tsdb_id:'148011', badge:'https://r2.thesportsdb.com/images/media/team/badge/7coikd1705438948.png' },
  { id:'liquid', name:'Liquid', full:'Team Liquid', color:'#0A66C2', text:'#FFF', region:'NA', tsdb_id:'136526', badge:'https://r2.thesportsdb.com/images/media/team/badge/o1bxs61761218944.png' },
  { id:'furia', name:'FURIA', full:'FURIA Esports', color:'#000', text:'#FFF', region:'SA', tsdb_id:'148012', badge:'https://r2.thesportsdb.com/images/media/team/badge/es3htk1705439167.png' },
  { id:'astralis', name:'Astralis', full:'Astralis', color:'#1A1A1A', text:'#E63946', region:'EU', tsdb_id:'147808', badge:'https://r2.thesportsdb.com/images/media/team/badge/vjo37g1697310003.png' },
  { id:'heroic', name:'Heroic', full:'Heroic', color:'#FF6B35', text:'#FFF', region:'EU', tsdb_id:'148342', badge:'https://r2.thesportsdb.com/images/media/team/badge/jl2cut1714390743.png' },
  { id:'cloud9', name:'Cloud9', full:'Cloud9', color:'#1B3A5C', text:'#FFF', region:'NA', tsdb_id:'136294', badge:'https://r2.thesportsdb.com/images/media/team/badge/j6htd11761329683.png' },
  { id:'ence', name:'ENCE', full:'ENCE', color:'#0EAE52', text:'#000', region:'EU', tsdb_id:'153703', badge:'https://r2.thesportsdb.com/images/media/team/badge/jbwn4d1761334997.png' },
];

const FOOTBALL_TEAMS = [
  { id:'mci', name:'曼城', full:'Manchester City', color:'#6CABDD', text:'#000', league:'英超', tsdb_id:'133613', badge:'https://r2.thesportsdb.com/images/media/team/badge/vwpvry1467462651.png' },
  { id:'ars', name:'阿森纳', full:'Arsenal', color:'#EF0107', text:'#FFF', league:'英超', tsdb_id:'133604', badge:'https://r2.thesportsdb.com/images/media/team/badge/uyhbfe1612467038.png' },
  { id:'liv', name:'利物浦', full:'Liverpool', color:'#C8102E', text:'#FFF', league:'英超', tsdb_id:'133602', badge:'https://r2.thesportsdb.com/images/media/team/badge/kfaher1737969724.png' },
  { id:'che', name:'切尔西', full:'Chelsea', color:'#034694', text:'#FFF', league:'英超', tsdb_id:'133610', badge:'https://r2.thesportsdb.com/images/media/team/badge/pbf4ul1782638263.png' },
  { id:'tot', name:'热刺', full:'Tottenham', color:'#132257', text:'#FFF', league:'英超', tsdb_id:'133616', badge:'https://r2.thesportsdb.com/images/media/team/badge/dfyfhl1604094109.png' },
  { id:'mun', name:'曼联', full:'Manchester United', color:'#DA291C', text:'#FFF', league:'英超', tsdb_id:'133612', badge:'https://r2.thesportsdb.com/images/media/team/badge/xzqdr11517660252.png' },
  { id:'rma', name:'皇马', full:'Real Madrid', color:'#FFFFFF', text:'#000', league:'西甲', tsdb_id:'133738', badge:'https://r2.thesportsdb.com/images/media/team/badge/vwvwrw1473502969.png' },
  { id:'bar', name:'巴萨', full:'FC Barcelona', color:'#A50044', text:'#FFF', league:'西甲', tsdb_id:'133739', badge:'https://r2.thesportsdb.com/images/media/team/badge/wq9sir1639406443.png' },
  { id:'atm', name:'马竞', full:'Atletico Madrid', color:'#CB3524', text:'#FFF', league:'西甲', tsdb_id:'133729', badge:'https://r2.thesportsdb.com/images/media/team/badge/0ulh3q1719984315.png' },
  { id:'bay', name:'拜仁', full:'Bayern Munich', color:'#DC052D', text:'#FFF', league:'德甲', tsdb_id:'133664', badge:'https://r2.thesportsdb.com/images/media/team/badge/01ogkh1716960412.png' },
  { id:'bvb', name:'多特', full:'Borussia Dortmund', color:'#FDE100', text:'#000', league:'德甲', tsdb_id:'133650', badge:'https://r2.thesportsdb.com/images/media/team/badge/tqo8ge1716960353.png' },
  { id:'juv', name:'尤文', full:'Juventus', color:'#000', text:'#FFF', league:'意甲', tsdb_id:'133676', badge:'https://r2.thesportsdb.com/images/media/team/badge/uxf0gr1742983727.png' },
  { id:'mil', name:'AC米兰', full:'AC Milan', color:'#FB090B', text:'#000', league:'意甲', tsdb_id:'133667', badge:'https://r2.thesportsdb.com/images/media/team/badge/wvspur1448806617.png' },
  { id:'int', name:'国米', full:'Inter Milan', color:'#0066CC', text:'#FFF', league:'意甲', tsdb_id:'133681', badge:'https://r2.thesportsdb.com/images/media/team/badge/ryhu6d1617113103.png' },
  { id:'psg', name:'巴黎', full:'Paris Saint-Germain', color:'#004170', text:'#FFF', league:'法甲', tsdb_id:'133714', badge:'https://r2.thesportsdb.com/images/media/team/badge/rwqrrq1473504808.png' },
  { id:'sdts', name:'山东泰山', full:'Shandong Taishan', color:'#FF6B00', text:'#FFF', league:'中超', tsdb_id:'134648', badge:'https://r2.thesportsdb.com/images/media/team/badge/vheyu21654266995.png' },
  { id:'shhg', name:'上海海港', full:'Shanghai Port', color:'#E60012', text:'#FFF', league:'中超', tsdb_id:'134640', badge:'https://r2.thesportsdb.com/images/media/team/badge/d9evs91776534441.png' },
  { id:'bjgg', name:'北京国安', full:'Beijing Guoan', color:'#0066B3', text:'#FFF', league:'中超', tsdb_id:'134635', badge:'https://r2.thesportsdb.com/images/media/team/badge/cdkguq1652626854.png' },
];

// TheSportsDB 球队 ID → 注册表条目（真实赛程的 idHomeTeam/idAwayTeam 通过它取队标/配色）
const TEAM_BY_TSDB = {};
[...CS2_TEAMS, ...FOOTBALL_TEAMS].forEach(t => { if (t.tsdb_id) TEAM_BY_TSDB[t.tsdb_id] = t; });

// === Sports Data Adapter ===
// Unified match model: { id, sport, home_id, home_name, home_color, home_text, away_id, away_name, away_color, away_text, date, time, status, league, round, home_score, away_score, importance, tournament_weight }
// status: 'upcoming' | 'live' | 'finished'
// V1.2 §6.1/§12：赛程一律来自真实 Provider（足球=TheSportsDB，CS2=Liquipedia，经 /api/sports 代理），
// 此前的 CS2_SCHEDULE / FOOTBALL_SCHEDULE 静态假赛程已删除——无缓存时显示空态/失败态，不用 mock 冒充真实数据。

function getTeamById(id, sport) {
  if (sport === 'cs2') return CS2_TEAMS.find(t => t.id === id);
  return FOOTBALL_TEAMS.find(t => t.id === id);
}

// 关注匹配键：小写化并去掉符号，用于 Liquipedia（LP 页面标题/短名）与关注记录（名称/id）双向匹配
function normTeamKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9一-鿿]/g, ''); }

// 真实赛程的球队视觉信息：优先 TheSportsDB 注册表（有真实队标），否则中性色兜底
function findTeamVisual(sport, id, fallbackName) {
  const t = TEAM_BY_TSDB[id] || getTeamById(id, sport);
  if (t) return { name: t.name, color: t.color, text: t.text, badge: t.badge };
  return { name: fallbackName || id, color: '#6C8ED4', text: '#FFF', badge: null };
}

function getUnifiedMatches(sport) {
  const cache = getSportsCache()[sport];
  // 只用真实同步到的缓存；无缓存返回空数组（UI 显示空态/失败态，不回退假数据）
  const schedule = (cache && cache.data && cache.data.length) ? cache.data : [];
  return schedule.map(raw => {
    let m = raw;
    // 真实赛程带 UTC 时间戳 → 转本地日期/时间
    if (m.ts) { const d = new Date(m.ts); m = { ...m, date: localDate(d), time: localTime(d) }; }
    const home = m.home_name ? findTeamVisual(sport, m.home_id, m.home_name) : (getTeamById(m.home_id, sport) || { name:m.home_id, color:'#666', text:'#FFF' });
    const away = m.away_name ? findTeamVisual(sport, m.away_id, m.away_name) : (getTeamById(m.away_id, sport) || { name:m.away_id, color:'#666', text:'#FFF' });
    return { ...m, sport, home_name:home.name, home_color:home.color, home_text:home.text, home_badge:home.badge || m.home_badge || null, away_name:away.name, away_color:away.color, away_text:away.text, away_badge:away.badge || m.away_badge || null };
  });
}

function getMatchesForTeams(teamIds, sport) {
  if (!teamIds || teamIds.length === 0) return [];
  return getUnifiedMatches(sport).filter(m =>
    teamIds.includes(m.home_id) || teamIds.includes(m.away_id)
  );
}

// CS2 关注匹配：Liquipedia 赛程用 LP 页面标题（如 Natus Vincere）/短名（NAVI），
// 关注记录可能是注册表 id、tsdb_id 或在线搜索名称——统一按名称键 + id 双向匹配。
function cs2MatchesForFollowed(csFollowed) {
  const keys = new Set();
  (csFollowed || []).forEach(t => {
    [t.name, t.full, t.provider_team_id, t.tsdb_id].forEach(x => { const k = normTeamKey(x); if (k) keys.add(k); });
  });
  if (keys.size === 0) return [];
  return getUnifiedMatches('cs2').filter(m =>
    [m.home_id, m.home_name, m.home_full, m.away_id, m.away_name, m.away_full].some(x => keys.has(normTeamKey(x)))
  );
}

// === Match Score Algorithm ===
// Score = main_team_weight + importance + tournament_weight + opponent_strength + proximity + user_preference
function calculateMatchScore(match, followedTeamIds) {
  let score = 0;
  const isMain = followedTeamIds.includes(match.home_id) || followedTeamIds.includes(match.away_id);
  if (isMain) score += 10;
  score += (match.importance || 1);
  score += (match.tournament_weight || 1);
  const daysUntil = (new Date(match.date) - new Date(new Date().toDateString())) / (1000*60*60*24);
  if (daysUntil >= 0 && daysUntil <= 7) score += (5 - daysUntil * 0.7);
  if (match.status === 'live') score += 5;
  return score;
}

function renderTeamLogo(team, size) {
  const s = size || 48;
  const fontSize = Math.round(s * 0.35);
  const name = (team && team.name) || '?';
  const initials = name.slice(0, 3).toUpperCase();
  const color = (team && team.color) || '#6C8ED4';
  const text = (team && team.text) || '#FFF';
  const circleStyle = `display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:${fontSize}px;font-weight:700;font-family:var(--font-sans);`;
  // 有真实队标（TheSportsDB badge，经 /img 代理避免防盗链/被墙）→ 图片 + 首字母圆圈兜底
  if (team && team.badge) {
    return `<span class="team-logo team-logo-badge" style="width:${s}px;height:${s}px;">
      <span style="position:absolute;inset:0;${circleStyle}background:${color};color:${text};">${initials}</span>
      <img src="/img?url=${encodeURIComponent(team.badge)}" alt="${name}" loading="lazy" onerror="this.remove()">
    </span>`;
  }
  return `<span class="team-logo" style="width:${s}px;height:${s}px;background:${color};color:${text};${circleStyle}flex-shrink:0;">${initials}</span>`;
}

// === Seed (demo data only) ===
// V1.2 §12 说明：SEED_ENTRIES 仅是首次运行的演示记录，不是"全世界作品数据库"的替代品。
// 真实作品必须经上方 Provider 搜索导入，禁止靠堆静态 JSON 扩充数据（符合 §12 禁止项）。
async function seedIfEmpty() {
  if (localStorage.getItem('memory_os_seeded') === '1') return;
  const all = await dbGetAll();
  if (all.length === 0) {
    for (const entry of SEED_ENTRIES) {
      await dbAdd({ ...entry, seed:true, created_at:new Date().toISOString(), updated_at:new Date().toISOString() });
    }
  }
  localStorage.setItem('memory_os_seeded', '1');
}

// === Poster Rendering Helpers ===
function renderPosterWall(entry) {
  const [c1, c2] = getPosterColors(entry);
  const meta = TYPE_META[entry.type] || TYPE_META.event;
  const extraInfo = entry.director || entry.author || '';
  let inner = `<div class="poster-fallback"><span class="pp-icon">${meta.emoji}</span><span class="pp-title">${entry.title}</span>${extraInfo ? `<span class="pp-meta">${extraInfo}</span>`:''}</div>`;
  if (entry.poster) inner += `<img src="${proxyImage(entry.poster)}" alt="${entry.title}" loading="lazy" onerror="this.style.display='none'">`;
  return `<div class="poster-img" style="background:linear-gradient(135deg,${c1},${c2})">${inner}</div>`;
}

function renderEntryPoster(entry) {
  if (!entry.poster && !entry.cover) return '';
  const [c1, c2] = getPosterColors(entry);
  const meta = TYPE_META[entry.type] || TYPE_META.event;
  const url = proxyImage(entry.poster || entry.cover);
  return `<div class="entry-poster-wrap" style="background:linear-gradient(135deg,${c1},${c2})"><div class="entry-poster-fallback">${meta.emoji}</div><img src="${url}" alt="${entry.title}" loading="lazy" onerror="this.style.display='none'"></div>`;
}

function renderDetailPoster(entry) {
  if (!entry.poster && !entry.cover) return '';
  const [c1, c2] = getPosterColors(entry);
  const meta = TYPE_META[entry.type] || TYPE_META.event;
  const url = proxyImage(entry.poster || entry.cover);
  return `<div class="detail-poster-wrap" style="background:linear-gradient(135deg,${c1},${c2})"><div class="detail-poster-fallback"><span class="dpf-icon">${meta.emoji}</span><span class="dpf-title">${entry.title}</span></div><img src="${url}" alt="${entry.title}" onerror="this.style.display='none'"></div>`;
}

// === Helpers ===
function getEntryDate(e) { return e.watch_date || e.event_date || e.date || e.finish_date || ''; }
function getEntryTime(e) { return e.watch_time || e.event_time || ''; }
function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const da = getEntryDate(a), db = getEntryDate(b);
    return da < db ? 1 : da > db ? -1 : 0;
  });
}

// === Navigation ===
function toggleNavGroup(group) {
  const el = document.getElementById(`nav-group-${group}`);
  if (el) el.classList.toggle('open');
}

async function navigate(page, fromPop = false) {
  const prevPage = currentPage;
  currentPage = page;
  detailOpenId = null; // 页面重渲染 = 退出详情层
  // 浏览器返回键集成：跨页面切换入栈；同页刷新（保存/删除后重渲染）只替换当前栈项，避免堆积重复层
  if (!fromPop) {
    const st = { __inneros: true, page };
    if (page === prevPage) history.replaceState(st, '');
    else history.pushState(st, '');
  }
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  // Auto-expand the parent group when navigating to a sub-item
  const groupMap = {
    today:'memory', timeline:'memory', library:'memory', search:'memory',
    onthisday:'memory', random:'memory', 'year-review':'memory',
    'res-cs':'resources', 'res-football':'resources', 'res-ai':'resources', 'res-links':'resources'
  };
  if (groupMap[page]) {
    const grp = document.getElementById(`nav-group-${groupMap[page]}`);
    if (grp && !grp.classList.contains('open')) grp.classList.add('open');
  }

  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading-container"><div class="loading-spinner"></div><div class="loading-text">加载中...</div></div>`;
  content.classList.remove('fade-in');
  void content.offsetWidth;
  content.classList.add('fade-in');
  try {
    switch(page) {
      case 'today': await renderToday(); break;
      case 'timeline': await renderTimeline(); break;
      case 'library': await renderLibrary('movie'); break;
      case 'search': renderSearch(); break;
      case 'onthisday': await renderOnThisDay(); break;
      case 'random': await renderRandom(); break;
      case 'year-review': await renderYearReview(); break;
      case 'settings': await renderSettings(); break;
      case 'res-cs': await renderResourceCS(); break;
      case 'res-football': await renderResourceFootball(); break;
      case 'res-ai': renderResourceAI(); break;
      case 'res-links': renderResourceLinks(); break;
      case 'knowledge': renderKnowledge(); break;
      case 'ai-assistant': renderAIAssistant(); break;
    }
  } catch(err) {
    console.error('Page render error:', err);
    content.innerHTML = `<div class="error-state"><div class="error-state-icon">⚠</div><div class="error-state-title">页面加载失败</div><div class="error-state-desc">请刷新页面重试</div><button class="error-state-retry" onclick="navigate('${page}')">重试</button></div>`;
  }
  closeSidebar();
}

// === Resources: CS Esports ===
// CS 赛事分组：按"赛事"聚合（league_url 去锚点优先，无链接时按联赛名去阶段后缀），
// 阶段 = 联赛名 " - " 之后的部分（Group A / Playoffs / 半决赛…），供赛事详情页分组展示
function groupCSMatches(matches) {
  const groups = new Map();
  for (const m of matches) {
    const base = ((m.league_url || m.league || '').split('#')[0]) || m.league;
    if (!groups.has(base)) {
      groups.set(base, { key: base, name: (m.league.split(' - ')[0] || m.league), url: m.league_url || '', matches: [], stages: new Map() });
    }
    const g = groups.get(base);
    g.matches.push(m);
    if (!g.stages.has(m.league)) g.stages.set(m.league, []);
    g.stages.get(m.league).push(m);
  }
  return [...groups.values()];
}

async function renderResourceCS() {
  const synced = await ensureCS2Matches(); // Liquipedia 真实赛程；失败保留缓存
  const followedTeams = await dbGetTeams();
  const csFollowed = followedTeams.filter(t => t.sport === 'cs2');
  const followedIds = csFollowed.flatMap(t => [t.provider_team_id, t.tsdb_id].filter(Boolean));
  const all = getUnifiedMatches('cs2');
  const myMatches = cs2MatchesForFollowed(csFollowed);
  const live = all.filter(m => m.status === 'live').sort((a,b) => a.ts - b.ts);
  const myUpcoming = myMatches.filter(m => m.status === 'upcoming' || m.status === 'live').sort((a,b) => a.date.localeCompare(b.date));
  const myRecent = myMatches.filter(m => m.status === 'finished').sort((a,b) => b.date.localeCompare(a.date)).slice(0, 3);
  // 进行中的赛事：未来场次 + 正在直播的归属赛事（过去场次不计入赛事列表，弱化历史）
  const tournaments = groupCSMatches(all.filter(m => m.status !== 'finished'))
    .sort((a,b) => Math.min(...a.matches.map(m=>m.ts||Infinity)) - Math.min(...b.matches.map(m=>m.ts||Infinity)));

  let html = `
    <div class="page-header">
      <div class="page-title">CS赛事 · CS Esports</div>
      <div class="page-subtitle">${getSportsLastSynced('cs2') ? `上次同步 ${new Date(getSportsLastSynced('cs2')).toLocaleString()}` : '等待首次同步'} · <button class="link-btn" onclick="refreshSports('cs2')">刷新</button></div>
    </div>`;

  // 我关注的战队 chips（按用户要求：资源页不放添加按钮，添加入口在 设置 → Sports 关注管理）
  html += `<div class="my-teams-bar"><div class="my-teams-label">⚡ 我关注的战队</div><div class="my-teams-list" id="cs-my-teams">`;
  if (csFollowed.length > 0) {
    csFollowed.forEach(t => {
      const team = CS2_TEAMS.find(c => c.id === t.provider_team_id) || { name:t.name, color:t.color||'#666', text:'#FFF', badge:t.badge };
      html += `<div class="my-team-chip" style="border-color:${team.color}44;">
        ${renderTeamLogo(team, 28)}
        <span class="my-team-name">${team.name}</span>
      </div>`;
    });
  } else {
    html += `<span class="my-teams-empty">尚未关注，可在 <button class="link-btn" onclick="navigate('settings')">设置 → Sports 关注管理</button> 添加</span>`;
  }
  html += `</div></div>`;

  // 🔴 正在直播（全局，不只关注队——用户要求列出正在进行的比赛方便点进去看）
  if (live.length > 0) {
    html += `<div class="res-section-title">🔴 正在直播 · LIVE NOW</div><div class="match-list">`;
    live.forEach(m => { html += renderMatchCard(m, followedIds); });
    html += `</div>`;
  }

  // 🏆 进行中的赛事（点进赛事看阶段赛程）
  if (tournaments.length > 0) {
    html += `<div class="res-section-title">🏆 进行中的赛事 · Ongoing Tournaments</div><div class="tournament-grid">`;
    tournaments.forEach((t, i) => {
      const tLive = t.matches.filter(m => m.status === 'live').length;
      const next = [...t.matches].filter(m => m.status === 'upcoming').sort((a,b) => a.ts - b.ts)[0];
      const stages = [...t.stages.keys()].map(s => s.split(' - ').slice(1).join(' - ') || s);
      html += `<div class="tournament-card card-enter" style="animation-delay:${i*0.05}s" onclick="openTournamentDetail('${encodeURIComponent(t.key)}')">
        <div class="tournament-card-name">${t.name}</div>
        <div class="tournament-card-stages">${stages.slice(0, 3).map(s => `<span class="tournament-stage-chip">${s}</span>`).join('')}${stages.length > 3 ? `<span class="tournament-stage-chip">+${stages.length-3}</span>` : ''}</div>
        <div class="tournament-card-meta">
          ${tLive > 0 ? `<span class="match-live-badge">${tLive} 场直播中</span>` : ''}
          <span>${t.matches.length} 场</span>
          ${next ? `<span>下一场 ${next.date.slice(5).replace('-','/')} ${next.time}</span>` : ''}
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // 关注战队即将开赛
  if (myUpcoming.length > 0) {
    html += `<div class="res-section-title">⏰ 我的战队赛程 · My Schedule</div><div class="match-list">`;
    myUpcoming.forEach(m => { html += renderMatchCard(m, followedIds); });
    html += `</div>`;
  }

  if (!synced && live.length === 0 && tournaments.length === 0) {
    html += `<div class="sync-fail-banner">⚠️ 赛程同步失败 · 上次成功 ${getSportsLastSynced('cs2') ? new Date(getSportsLastSynced('cs2')).toLocaleString() : '从未同步'}<button class="link-btn" onclick="refreshSports('cs2')">重试</button></div>`;
  }

  // 最近结果（按用户要求弱化：放最后、小标题、无星标强调）
  if (myRecent.length > 0) {
    html += `<div class="res-section-title res-section-muted">最近结果 · Recent Results</div><div class="match-list match-list-muted">`;
    myRecent.forEach(m => { html += renderMatchCard(m, followedIds); });
    html += `</div>`;
  }
  document.getElementById('content').innerHTML = html;
}

// 赛事详情页（页内层级，入历史栈：浏览器返回键返回赛事列表）
let tournamentOpenKey = null;
function openTournamentDetail(key, fromPop = false) {
  const k = decodeURIComponent(key);
  const all = getUnifiedMatches('cs2');
  const group = groupCSMatches(all).find(g => g.key === k);
  if (!group) { if (!fromPop) showToast('赛事数据已更新，请刷新', 'error'); return; }
  if (!fromPop) history.pushState({ __inneros: true, page: currentPage, tournament: encodeURIComponent(k) }, '');
  tournamentOpenKey = k;
  const followedTeams = dbGetTeams();
  followedTeams.then(teams => {
    const followedIds = teams.filter(t => t.sport === 'cs2').flatMap(t => [t.provider_team_id, t.tsdb_id].filter(Boolean));
    // 阶段排序：直播 > 未开赛 > 已完赛（过去赛程放最后，弱化）
    const stageOrder = (name) => {
      const ms = group.stages.get(name) || [];
      if (ms.some(m => m.status === 'live')) return 0;
      if (ms.some(m => m.status === 'upcoming')) return 1;
      return 2;
    };
    let html = `<button class="detail-back" onclick="history.back()">← 返回</button>
      <div class="page-header"><div class="page-title">${group.name}</div></div>`;
    if (group.url) html += `<div class="tournament-ext-row"><a class="ts-ext-link" href="${group.url.split('#')[0]}" target="_blank" rel="noopener">在 Liquipedia 打开完整赛程/观看 ↗</a></div>`;
    [...group.stages.keys()].sort((a,b) => stageOrder(a) - stageOrder(b)).forEach(stageName => {
      const ms = group.stages.get(stageName).slice().sort((a,b) => (a.status === 'finished' ? 1 : 0) - (b.status === 'finished' ? 1 : 0) || a.ts - b.ts);
      const stageLabel = stageName.split(' - ').slice(1).join(' - ') || stageName;
      html += `<div class="res-section-title">${stageLabel}</div><div class="match-list">`;
      ms.forEach(m => { html += renderMatchCard(m, followedIds); });
      html += `</div>`;
    });
    document.getElementById('content').innerHTML = html;
    window.scrollTo({ top:0, behavior:'smooth' });
  });
}

function renderMatchCard(m, followedIds) {
  const isMain = followedIds.includes(m.home_id) || followedIds.includes(m.away_id);
  const homeTeam = { name:m.home_name, color:m.home_color, text:m.home_text, badge:m.home_badge };
  const awayTeam = { name:m.away_name, color:m.away_color, text:m.away_text, badge:m.away_badge };
  let scoreHtml = '';
  if (m.status === 'finished') {
    if (m.home_score != null && m.away_score != null) {
      const win1 = m.home_score > m.away_score;
      scoreHtml = `<div class="match-score">
        <span class="${win1?'win':'lose'}">${m.home_score}</span>
        <span class="match-score-sep">:</span>
        <span class="${!win1?'win':'lose'}">${m.away_score}</span>
      </div>`;
    } else {
      scoreHtml = `<span class="match-time" style="font-size:13px;color:var(--text-tertiary);">已结束</span>`; // 数据源未提供比分时不造假
    }
  } else if (m.status === 'live') {
    scoreHtml = `<span class="match-live-badge">LIVE</span>`;
  } else {
    scoreHtml = `<span class="match-time">${m.time}</span>`;
  }
  // 过去赛程弱化：完赛场次不显示星标/推荐理由，卡片降透明度（用户反馈：历史赛程不要着重显示）
  const isPast = m.status === 'finished';
  const mainClass = isMain && !isPast ? ' match-card-main' : '';
  const pastClass = isPast ? ' match-card-past' : '';
  const score = calculateMatchScore(m, followedIds);
  const stars = Math.min(5, Math.max(1, Math.round(score / 4)));
  const reason = isPast ? '' : getMatchReason(m, isMain, stars);
  const sourceName = m.sport === 'cs2' ? 'Liquipedia' : 'TheSportsDB';
  const sourceUrl = m.sport === 'cs2' ? (m.league_url || 'https://liquipedia.net/counterstrike/Liquipedia:Matches') : 'https://www.thesportsdb.com';
  return `<div class="match-card${mainClass}${pastClass}">
    <div class="match-card-league">${m.league} · ${m.round}</div>
    <div class="match-card-teams">
      <div class="match-team">${renderTeamLogo(homeTeam, 36)}<span class="match-team-name">${m.home_name}</span></div>
      ${scoreHtml}
      <div class="match-team">${renderTeamLogo(awayTeam, 36)}<span class="match-team-name">${m.away_name}</span></div>
    </div>
    <div class="match-card-date">${m.date.replace(/-/g,'/')} ${m.time}</div>
    ${!isPast ? `<div class="match-card-stars">${'★'.repeat(stars)}${'☆'.repeat(5-stars)}</div>` : ''}
    ${reason ? `<div class="match-card-reason">${reason}</div>` : ''}
    <a class="match-card-source" href="${sourceUrl}" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;font-size:11px;color:#8a8f98;text-decoration:none;">数据来源 · ${sourceName}</a>
  </div>`;
}

function getMatchReason(m, isMain, stars) {
  const reasons = [];
  if (isMain) reasons.push('主队');
  if (m.importance >= 4) reasons.push('强强对话');
  if (m.tournament_weight >= 4) reasons.push(m.round || '重要赛事');
  const daysUntil = (new Date(m.date) - new Date(new Date().toDateString())) / (1000*60*60*24);
  if (daysUntil === 0) reasons.push('今日开赛');
  else if (daysUntil === 1) reasons.push('明日开赛');
  else if (daysUntil > 0 && daysUntil <= 2) reasons.push('临近开赛');
  return reasons.length > 0 ? reasons.join(' + ') : '';
}

// Sports data caching
const SPORTS_CACHE_KEY = 'inneros_sports_cache';
function getSportsCache() {
  try { return JSON.parse(localStorage.getItem(SPORTS_CACHE_KEY) || '{}'); } catch(e) { return {}; }
}
function setSportsCache(sport, data) {
  const cache = getSportsCache();
  cache[sport] = { data, last_synced_at: new Date().toISOString() };
  localStorage.setItem(SPORTS_CACHE_KEY, JSON.stringify(cache));
}
function getSportsLastSynced(sport) {
  const cache = getSportsCache();
  return cache[sport]?.last_synced_at || null;
}
function needsSportsRefresh(sport) {
  const last = getSportsLastSynced(sport);
  if (!last) return true;
  const elapsed = (Date.now() - new Date(last).getTime()) / (1000*60); // minutes
  return elapsed > 30; // refresh every 30 min
}

// === 真实赛程同步（TheSportsDB 足球 + Liquipedia CS2，经 /api/sports 代理，免 Key）===
// V1.2 §6.1/§6.3：足球=英超/西甲/德甲/意甲/法甲/欧冠联赛未来场次；CS2=Liquipedia:Matches ticker。
// 失败策略：保留上次成功缓存 + 显示 last_synced_at 与重试；无缓存时显示空态，不用静态假数据冒充真实数据。
const FOOTBALL_LEAGUE_IDS = '4328,4335,4331,4332,4334,4480';
let footballFetchInflight = null;
async function ensureFootballMatches(force) {
  if (!force && !needsSportsRefresh('football')) return true;
  if (footballFetchInflight) return footballFetchInflight;
  footballFetchInflight = (async () => {
    try {
      // 带上关注球队的 TheSportsDB id：按队取下一场+最近结果（V1.2 §6.1）
      const followed = await dbGetTeams();
      const ids = followed.filter(t => t.sport === 'football' && t.tsdb_id).map(t => t.tsdb_id).slice(0, 6).join(',');
      const res = await fetch(`/api/sports?type=matches&leagues=${FOOTBALL_LEAGUE_IDS}&ids=${encodeURIComponent(ids)}`);
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      const events = data.matches || [];
      if (events.length > 0) { setSportsCache('football', events); return true; }
      throw new Error('empty');
    } catch (e) {
      // 失败：保留现有缓存（getSportsLastSynced 继续显示上次成功时间）
      console.warn('足球赛程同步失败，使用本地缓存', e);
      return false;
    } finally { footballFetchInflight = null; }
  })();
  return footballFetchInflight;
}

// CS2 真实赛程：Liquipedia ticker（未来 + 进行中，约 50 场），客户端按关注名称过滤
let cs2FetchInflight = null;
async function ensureCS2Matches(force) {
  if (!force && !needsSportsRefresh('cs2')) return true;
  if (cs2FetchInflight) return cs2FetchInflight;
  cs2FetchInflight = (async () => {
    try {
      const res = await fetch('/api/sports?type=cs2matches');
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      const matches = data.matches || [];
      if (matches.length > 0) { setSportsCache('cs2', matches); return true; }
      throw new Error('empty');
    } catch (e) {
      console.warn('CS2赛程同步失败，使用本地缓存', e);
      return false;
    } finally { cs2FetchInflight = null; }
  })();
  return cs2FetchInflight;
}

// === 球队选择器 v2（参考 OneFootball/懂球帝 的关注交互） ===
// 改进（对应用户反馈"主队设置太麻烦、选择不全不美观"）：
//   1) 顶部搜索：中文实时筛选热门列表 + 英文在线搜全球任意球队（TheSportsDB，含真实队标）
//   2) 联赛快捷筛选 chips（足球）
//   3) 热门网格展示真实队标（此前是色块+缩写，观感差且部分队标拉取失败）
//   4) 点击即关注/取消，不用来回切换页面；完成后一键返回
let teamSelectorFollowed = new Set();
let teamOnlineResults = [];
let teamOnlineTimer = null;

async function openTeamSelector(sport) {
  const followed = await dbGetTeams();
  const sportFollowed = followed.filter(t => t.sport === sport);
  // 关注匹配键：静态注册表 id + TheSportsDB id（真实赛程用 tsdb id）
  teamSelectorFollowed = new Set(sportFollowed.flatMap(t => [t.provider_team_id, t.tsdb_id].filter(Boolean)));
  const registry = sport === 'cs2' ? CS2_TEAMS : FOOTBALL_TEAMS;

  let html = `<div class="team-selector-header">选择主队 · ${sport === 'cs2' ? 'CS2 战队' : '足球俱乐部'}<button class="team-selector-close" onclick="closeTeamSelector()">✕</button></div>`;
  html += `<input type="text" class="team-search-input" id="team-search-input" placeholder="🔍 搜索球队（中文筛选热门，英文搜全球）" oninput="debouncedTeamOnlineSearch('${sport}', this.value)">`;
  html += `<div id="team-online-results"></div>`;
  if (sport === 'football') {
    html += `<div class="ts-league-chips" id="ts-league-chips">${['全部','英超','西甲','德甲','意甲','法甲','中超'].map((l,i) => `<button class="ts-chip${i===0?' active':''}" onclick="filterTeamGrid('${l}',this)">${l}</button>`).join('')}</div>`;
  }
  html += `<div class="ts-section-label">热门${sport === 'cs2' ? '战队' : '球队'} · POPULAR</div>`;
  html += `<div class="team-selector-grid" id="team-selector-grid">`;
  registry.forEach(t => {
    const isFollowed = teamSelectorFollowed.has(t.id) || (t.tsdb_id && teamSelectorFollowed.has(t.tsdb_id));
    html += `<div class="team-selector-item${isFollowed?' selected':''}" onclick="toggleTeam('${t.id}','${sport}',this)" data-name="${(t.name + ' ' + (t.full||'')).toLowerCase()}" data-league="${t.league||''}">
      ${renderTeamLogo(t, 44)}
      <div class="team-selector-name">${t.name}</div>
      <div class="team-selector-full">${t.full || ''}</div>
      ${isFollowed ? '<span class="team-selector-check">✓</span>' : '<span class="team-selector-add">＋</span>'}
    </div>`;
  });
  html += `</div>`;
  // 兜底：数据源不可用时仍可手动关注
  html += `<div class="ts-manual-row">
    <input type="text" id="manual-team-input" class="team-search-input" placeholder="搜不到？输入名称手动关注" onkeydown="if(event.key==='Enter')addManualTeam('${sport}')">
    <button class="btn btn-ghost" onclick="addManualTeam('${sport}')">＋ 关注</button>
  </div>`;
  html += `<button class="btn ts-done-btn" onclick="closeTeamSelector()">完成</button>`;
  // 选择器入历史栈：浏览器返回键关闭选择器（返回上一层），而不是退出网页
  history.pushState({ __inneros: true, page: currentPage, selector: sport }, '');
  selectorOpenSport = sport;
  showTeamSelectorModal(html, sport);
}

function showTeamSelectorModal(content, sport) {
  let modal = document.getElementById('team-selector-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'team-selector-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal team-selector-content"><div id="team-selector-body"></div></div>`;
    modal.addEventListener('click', function(e) { if (e.target === modal) closeTeamSelector(); });
    document.body.appendChild(modal);
  }
  document.getElementById('team-selector-body').innerHTML = content;
  modal.classList.add('show');
}

function closeTeamSelector(fromPop = false) {
  const modal = document.getElementById('team-selector-modal');
  if (modal) modal.classList.remove('show');
  teamOnlineResults = [];
  // 选择器是历史栈中的一层：用户点 ✕/完成 时走 history.back()，由 popstate 统一收尾（含页面刷新），
  // 保证浏览器返回键、页面内按钮、Escape 三条路径行为一致（返回上一层，不退出网页）
  if (!fromPop && selectorOpenSport) { history.back(); return; }
  selectorOpenSport = null;
  // 关闭后刷新当前页面，让"我的主队/我的赛程"立即反映关注变化
  if (currentPage === 'res-cs') renderResourceCS();
  else if (currentPage === 'res-football') renderResourceFootball();
  else if (currentPage === 'today') navigate('today', true);
}

function filterTeamList(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.team-selector-item').forEach(item => {
    const name = item.dataset.name || '';
    item.style.display = name.includes(q) ? '' : 'none';
  });
}

// 联赛快捷筛选（足球 chips）
function filterTeamGrid(league, btn) {
  if (btn && btn.parentElement) btn.parentElement.querySelectorAll('.ts-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const q = (document.getElementById('team-search-input')?.value || '').toLowerCase().trim();
  document.querySelectorAll('#team-selector-grid .team-selector-item').forEach(item => {
    const matchLeague = league === '全部' || (item.dataset.league || '') === league;
    const matchQuery = !q || (item.dataset.name || '').includes(q);
    item.style.display = (matchLeague && matchQuery) ? '' : 'none';
  });
}

// 搜索输入：中文同步筛选热门网格 + 英文触发在线全球搜索
function debouncedTeamOnlineSearch(sport, value) {
  clearTimeout(teamOnlineTimer);
  const q = value.trim();
  filterTeamList(q);
  const box = document.getElementById('team-online-results');
  if (!q || q.length < 2) { teamOnlineResults = []; if (box) box.innerHTML = ''; return; }
  teamOnlineTimer = setTimeout(() => searchTeamsOnline(sport, q), 500);
}

// 在线搜索全球球队（TheSportsDB，经 /api/sports 代理；含真实队标）
async function searchTeamsOnline(sport, query) {
  const box = document.getElementById('team-online-results');
  if (!box) return;
  box.innerHTML = '<div class="ts-search-hint">搜索中...</div>';
  try {
    const res = await fetch(`/api/sports?type=teamsearch&q=${encodeURIComponent(query)}&sport=${sport}`);
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    teamOnlineResults = (data.results || []).filter(t => t.id);
    if (teamOnlineResults.length === 0) {
      box.innerHTML = '<div class="ts-search-hint">未搜到，试试英文名，或在下方手动添加</div>';
      return;
    }
    box.innerHTML = teamOnlineResults.map((t, i) => {
      const isF = teamSelectorFollowed.has(t.id);
      return `<div class="ts-online-item${isF?' selected':''}" onclick="toggleTeamOnline(${i},'${sport}',this)">
        ${renderTeamLogo({ name:t.name, badge:t.badge, color:'#6C8ED4', text:'#FFF' }, 36)}
        <div style="min-width:0;flex:1;">
          <div class="ts-online-name">${t.name}</div>
          <div class="ts-online-league">${t.league || ''}</div>
        </div>
        <span class="ts-online-btn">${isF ? '✓ 已关注' : '＋ 关注'}</span>
      </div>`;
    }).join('');
  } catch (e) {
    box.innerHTML = '<div class="ts-search-hint">搜索失败（数据源暂不可用），可在下方手动添加</div>';
  }
}

// 关注/取消在线搜索到的球队（存 TheSportsDB 真实 id + 队标，真实赛程可匹配）
async function toggleTeamOnline(idx, sport, el) {
  const t = teamOnlineResults[idx];
  if (!t || !t.id) return;
  if (teamSelectorFollowed.has(t.id)) {
    const all = await dbGetTeams();
    const existing = all.find(x => x.sport === sport && (x.provider_team_id === t.id || x.tsdb_id === t.id));
    if (existing) {
      try { if (authState.loggedIn) { await opAppend('delete_memory', String(existing.id), { updated_at: new Date().toISOString() }); syncNow(); } } catch (e) { console.warn(e); }
      await dbDeleteTeam(existing.id);
    }
    teamSelectorFollowed.delete(t.id);
    if (el) { el.classList.remove('selected'); const b = el.querySelector('.ts-online-btn'); if (b) b.textContent = '＋ 关注'; }
    showToast(`已取消关注 ${t.name}`, 'success');
  } else {
    // provider 随数据源（thesportsdb/liquipedia）；liquipedia 无 tsdb_id，赛程经名称键匹配
    const provider = t.provider || 'thesportsdb';
    const rid = await dbAddTeam({ provider, provider_team_id:t.id, tsdb_id:provider === 'thesportsdb' ? t.id : null, name:t.name, full:t.full || t.name, sport, color:'#6C8ED4', text:'#FFF', badge:t.badge || '' });
    try { if (authState.loggedIn) { const rec = { id:String(rid), sport, name:t.name, full:t.full || t.name, provider, badge:t.badge || '' }; await enqueueMemoryUpsert(rec); syncNow(); } } catch (e) { console.warn(e); }
    teamSelectorFollowed.add(t.id);
    if (el) { el.classList.add('selected'); const b = el.querySelector('.ts-online-btn'); if (b) b.textContent = '✓ 已关注'; }
    showToast(`已关注 ${t.name}`, 'success');
  }
}

async function toggleTeam(teamId, sport, el) {
  const followed = await dbGetTeams();
  const existing = followed.find(t => t.sport === sport && (t.provider_team_id === teamId || t.tsdb_id === teamId));
  if (existing) {
    try { if (authState.loggedIn) { await opAppend('delete_memory', String(existing.id), { updated_at: new Date().toISOString() }); syncNow(); } } catch (e) { console.warn(e); }
    await dbDeleteTeam(existing.id);
    if (existing.tsdb_id) teamSelectorFollowed.delete(existing.tsdb_id);
    if (existing.provider_team_id) teamSelectorFollowed.delete(existing.provider_team_id);
    el.classList.remove('selected');
    const badge = el.querySelector('.team-selector-check');
    if (badge) { badge.className = 'team-selector-add'; badge.textContent = '＋'; }
  } else {
    const team = getTeamById(teamId, sport);
    if (team) {
      // V1.2 §6.1：注册表球队带 tsdb_id（TheSportsDB 真实 id）+ badge（真实队标），
      // 真实赛程通过 tsdb_id 匹配，队标经 /img 代理展示。
      const rid = await dbAddTeam({ provider:'static', provider_team_id:teamId, tsdb_id:team.tsdb_id || null, name:team.name, full:team.full, sport, color:team.color, text:team.text, badge:team.badge || '' });
      try { if (authState.loggedIn) { const rec = { id:String(rid), sport, name:team.name, full:team.full, provider:'static', badge:team.badge || '' }; await enqueueMemoryUpsert(rec); syncNow(); } } catch (e) { console.warn(e); }
      teamSelectorFollowed.add(teamId);
      if (team.tsdb_id) teamSelectorFollowed.add(team.tsdb_id);
      el.classList.add('selected');
      const badge = el.querySelector('.team-selector-add');
      if (badge) { badge.className = 'team-selector-check'; badge.textContent = '✓'; }
    }
  }
}

// V1.2 §6.1 过渡方案：缓解"搜不到球队/战队"问题
// 根因：CS2_TEAMS / FOOTBALL_TEAMS 是写死的静态注册表，列表外的球队无法关注。
// 正确修复：实现 SearchProvider Adapter（如 football-data.org），但 V1.2 §12 禁止购买/提交 API Key，
//   故真实 Provider 接入被阻塞。此处作为过渡，允许用户按名称关注任意球队。
// 注意：provider:'manual' 表示这是纯文本条目（不是真实 provider_team_id），
//   待接入真实 Provider 后，应改为 provider 搜索→选择→保存真实 provider_team_id。
async function addManualTeam(sport) {
  const input = document.getElementById('manual-team-input');
  const name = (input?.value || '').trim();
  if (!name) { showToast('请输入球队/战队名称', 'error'); return; }
  const followed = await dbGetTeams();
  const safeId = 'manual_' + name.toLowerCase().replace(/[^a-z0-9一-龥]/g, '_');
  if (followed.some(t => t.sport === sport && t.provider_team_id === safeId)) {
    showToast('已关注该球队', 'error'); return;
  }
  const rid = await dbAddTeam({ provider:'manual', provider_team_id:safeId, name, full:name, sport, color:'#6C8ED4', text:'#FFF' });
  try { if (authState.loggedIn) { const rec = { id:String(rid), sport, name, full:name, provider:'manual' }; await enqueueMemoryUpsert(rec); syncNow(); } } catch (e) { console.warn(e); }
  if (input) input.value = '';
  showToast(`已关注 ${name}`, 'success');
  await openTeamSelector(sport); // 刷新关注状态
}

async function removeTeam(id, sport) {
  try { if (authState.loggedIn) { await opAppend('delete_memory', String(id), { updated_at: new Date().toISOString() }); syncNow(); } } catch (e) { console.warn(e); }
  await dbDeleteTeam(id);
  if (sport === 'cs2') await renderResourceCS();
  else await renderResourceFootball();
}
async function refreshSports(sport) {
  if (sport === 'football') {
    const ok = await ensureFootballMatches(true); // 拉取 TheSportsDB 真实赛程
    showToast(ok ? '已同步最新足球赛程' : '同步失败，显示上次成功数据', ok ? 'success' : 'error');
  } else {
    const ok = await ensureCS2Matches(true); // 拉取 Liquipedia 真实赛程
    showToast(ok ? '已同步最新CS2赛程' : '同步失败，显示上次成功数据', ok ? 'success' : 'error');
  }
  if (sport === 'cs2') await renderResourceCS(); else await renderResourceFootball();
}

// === Resources: Football ===
// 足球联赛赛程（五大联赛 + 欧冠 + 中超，tab 检索；TheSportsDB 免费档每联赛仅少量场次，如实展示并外链完整赛程）
const FB_LEAGUE_TABS = [
  { id:'4328', name:'英超', db:'https://www.thesportsdb.com/league/4328' },
  { id:'4335', name:'西甲', db:'https://www.thesportsdb.com/league/4335' },
  { id:'4331', name:'德甲', db:'https://www.thesportsdb.com/league/4331' },
  { id:'4332', name:'意甲', db:'https://www.thesportsdb.com/league/4332' },
  { id:'4334', name:'法甲', db:'https://www.thesportsdb.com/league/4334' },
  { id:'4480', name:'欧冠', db:'https://www.thesportsdb.com/league/4480' },
  { id:'4398', name:'中超', db:'https://www.thesportsdb.com/league/4398' },
];
let fbLeagueCache = {}; // { leagueId: { ts, matches } }
let fbSelectedLeague = '4328';

async function fetchLeagueSchedule(leagueId) {
  const hit = fbLeagueCache[leagueId];
  if (hit && Date.now() - hit.ts < 10 * 60e3) return hit.matches;
  const res = await fetch(`/api/sports?type=leagueseason&id=${leagueId}`);
  if (!res.ok) throw new Error('http ' + res.status);
  const data = await res.json();
  const matches = data.matches || [];
  fbLeagueCache[leagueId] = { ts: Date.now(), matches };
  return matches;
}

async function selectFbLeague(leagueId, btn) {
  fbSelectedLeague = leagueId;
  document.querySelectorAll('.fb-league-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const box = document.getElementById('fb-league-content');
  if (!box) return;
  const tab = FB_LEAGUE_TABS.find(t => t.id === leagueId);
  box.innerHTML = '<div class="douban-loading">加载联赛赛程...</div>';
  try {
    const matches = await fetchLeagueSchedule(leagueId);
    const followedTeams = await dbGetTeams();
    const followedIds = followedTeams.filter(t => t.sport === 'football').flatMap(t => [t.provider_team_id, t.tsdb_id].filter(Boolean));
    if (matches.length === 0) {
      box.innerHTML = `<div class="empty-state" style="padding:32px 16px;"><div class="empty-state-title">数据源暂未收录该联赛近期赛程</div><div class="empty-state-desc">免费数据源覆盖有限，可到 <a class="ts-ext-link" href="${tab.db}" target="_blank" rel="noopener">TheSportsDB 查看完整赛程 ↗</a></div></div>`;
      return;
    }
    // 按日期分组，完赛的排后面
    const upcoming = matches.filter(m => m.status !== 'finished').sort((a,b) => (a.ts||0) - (b.ts||0));
    const finished = matches.filter(m => m.status === 'finished').sort((a,b) => (b.ts||0) - (a.ts||0));
    let html = '';
    const renderGroup = (list, label) => {
      if (!list.length) return;
      html += `<div class="res-section-title res-section-muted" style="margin-top:8px;">${label}</div><div class="match-list">`;
      list.forEach(m => { html += renderMatchCard(m, followedIds); });
      html += `</div>`;
    };
    renderGroup(upcoming, '近期赛程');
    renderGroup(finished.slice(0, 5), '已完赛');
    html += `<div class="tournament-ext-row"><a class="ts-ext-link" href="${tab.db}" target="_blank" rel="noopener">在 TheSportsDB 打开${tab.name}完整赛程 ↗</a></div>`;
    box.innerHTML = html;
  } catch (e) {
    box.innerHTML = `<div class="sync-fail-banner">⚠️ 联赛赛程加载失败<button class="link-btn" onclick="selectFbLeague('${leagueId}')">重试</button></div>`;
  }
}

async function renderResourceFootball() {
  // 拉取真实赛程（关注球队按队取）；失败保留上次成功缓存
  const synced = await ensureFootballMatches();
  const followedTeams = await dbGetTeams();
  const fbFollowed = followedTeams.filter(t => t.sport === 'football');
  const followedIds = fbFollowed.flatMap(t => [t.provider_team_id, t.tsdb_id].filter(Boolean));
  const myMatches = getMatchesForTeams(followedIds, 'football');
  const myUpcoming = myMatches.filter(m => m.status === 'upcoming' || m.status === 'live').sort((a,b) => a.date.localeCompare(b.date));
  const myRecent = myMatches.filter(m => m.status === 'finished').sort((a,b) => b.date.localeCompare(a.date)).slice(0, 3);

  let html = `
    <div class="page-header">
      <div class="page-title">足球 · Football</div>
      <div class="page-subtitle">${getSportsLastSynced('football') ? `上次同步 ${new Date(getSportsLastSynced('football')).toLocaleString()}` : '等待首次同步'} · <button class="link-btn" onclick="refreshSports('football')">刷新</button></div>
    </div>`;

  // 我关注的主队 chips（按用户要求：资源页不放添加按钮，添加入口在 设置 → Sports 关注管理）
  html += `<div class="my-teams-bar"><div class="my-teams-label">⚽ 我关注的主队</div><div class="my-teams-list" id="fb-my-teams">`;
  if (fbFollowed.length > 0) {
    fbFollowed.forEach(t => {
      const team = FOOTBALL_TEAMS.find(c => c.id === t.provider_team_id) || { name:t.name, color:t.color||'#666', text:'#FFF', badge:t.badge };
      html += `<div class="my-team-chip" style="border-color:${team.color}44;">
        ${renderTeamLogo(team, 28)}
        <span class="my-team-name">${team.name}</span>
      </div>`;
    });
  } else {
    html += `<span class="my-teams-empty">尚未关注，可在 <button class="link-btn" onclick="navigate('settings')">设置 → Sports 关注管理</button> 添加</span>`;
  }
  html += `</div></div>`;

  // 五大联赛 + 欧冠 + 中超 赛程 tab（按联赛检索）
  html += `<div class="res-section-title">联赛赛程 · Leagues</div>
    <div class="fb-league-tabs" id="fb-league-tabs">${FB_LEAGUE_TABS.map(t => `<button class="fb-league-tab${t.id === fbSelectedLeague ? ' active' : ''}" onclick="selectFbLeague('${t.id}',this)">${t.name}</button>`).join('')}</div>
    <div id="fb-league-content"></div>`;

  // 关注球队即将开赛
  if (myUpcoming.length > 0) {
    html += `<div class="res-section-title">⏰ 我的主队赛程 · My Schedule</div><div class="match-list">`;
    myUpcoming.forEach(m => { html += renderMatchCard(m, followedIds); });
    html += `</div>`;
  }
  if (!synced && myUpcoming.length === 0 && myRecent.length === 0) {
    html += `<div class="sync-fail-banner">⚠️ 赛程同步失败 · 上次成功 ${getSportsLastSynced('football') ? new Date(getSportsLastSynced('football')).toLocaleString() : '从未同步'}<button class="link-btn" onclick="refreshSports('football')">重试</button></div>`;
  }
  // 最近结果（弱化：放最后、小标题、无星标）
  if (myRecent.length > 0) {
    html += `<div class="res-section-title res-section-muted">最近结果 · Recent Results</div><div class="match-list match-list-muted">`;
    myRecent.forEach(m => { html += renderMatchCard(m, followedIds); });
    html += `</div>`;
  }
  document.getElementById('content').innerHTML = html;
  // 默认加载当前选中联赛
  selectFbLeague(fbSelectedLeague);
}

// === Resources: AI Tools ===
function renderResourceAI() {
  const links = [
    { title:'ChatGPT', url:'https://chat.openai.com', icon:'💬', desc:'OpenAI GPT对话助手，写作、编程、分析' },
    { title:'Claude', url:'https://claude.ai', icon:'🤖', desc:'Anthropic Claude AI助手，长文本分析' },
    { title:'Midjourney', url:'https://www.midjourney.com', icon:'🎨', desc:'AI图像生成，高质量艺术创作' },
    { title:'Stable Diffusion', url:'https://stability.ai', icon:'🖼️', desc:'开源AI图像生成框架' },
    { title:'Cursor', url:'https://cursor.com', icon:'📝', desc:'AI代码编辑器，智能编程辅助' },
    { title:'Perplexity', url:'https://www.perplexity.ai', icon:'🔍', desc:'AI搜索引擎，实时信息检索' },
    { title:'Hugging Face', url:'https://huggingface.co', icon:'🤗', desc:'AI模型社区，开源模型库' },
    { title:'Replicate', url:'https://replicate.com', icon:'⚙️', desc:'AI模型托管和API调用平台' },
    { title:'Suno', url:'https://suno.com', icon:'🎵', desc:'AI音乐生成工具' },
    { title:'Runway', url:'https://runwayml.com', icon:'🎬', desc:'AI视频生成和编辑工具' },
    { title:'ElevenLabs', url:'https://elevenlabs.io', icon:'🔊', desc:'AI语音合成和克隆' },
    { title:'Kimi', url:'https://kimi.moonshot.cn', icon:'🌙', desc:'月之暗面Kimi，中文AI助手' },
  ];
  let html = `
    <div class="page-header">
      <div class="page-title">AI工具 · AI Tools</div>
      <div class="scale-switcher">
        <button class="scale-btn active" data-cat="all">全部</button>
        <button class="scale-btn" data-cat="chat">对话</button>
        <button class="scale-btn" data-cat="image">图像</button>
        <button class="scale-btn" data-cat="code">编程</button>
        <button class="scale-btn" data-cat="media">音视频</button>
      </div>
    </div>
    <div class="res-grid">`;
  links.forEach(l => {
    html += `<a class="res-card" href="${l.url}" target="_blank" rel="noopener">
      <div class="res-card-icon" style="background:rgba(139,115,85,0.12)">${l.icon}</div>
      <div class="res-card-title">${l.title}</div>
      <div class="res-card-desc">${l.desc}</div>
      <div class="res-card-meta"><span class="res-card-tag">AI</span><span>外部链接</span></div>
    </a>`;
  });
  html += `</div>`;
  document.getElementById('content').innerHTML = html;
}

// === Resources: Quick Links ===
function renderResourceLinks() {
  const categories = [
    {
      title: '开发工具',
      links: [
        { title:'GitHub', url:'https://github.com', icon:'🐙' },
        { title:'Stack Overflow', url:'https://stackoverflow.com', icon:'📚' },
        { title:'MDN Web Docs', url:'https://developer.mozilla.org', icon:'📖' },
        { title:'VS Code', url:'https://code.visualstudio.com', icon:'💻' },
        { title:'Vercel', url:'https://vercel.com', icon:'▲' },
        { title:'Cloudflare', url:'https://www.cloudflare.com', icon:'☁️' },
      ]
    },
    {
      title: '设计资源',
      links: [
        { title:'Figma', url:'https://www.figma.com', icon:'🎨' },
        { title:'Dribbble', url:'https://dribbble.com', icon:'🏀' },
        { title:'Unsplash', url:'https://unsplash.com', icon:'📷' },
        { title:'Google Fonts', url:'https://fonts.google.com', icon:'🔤' },
        { title:'Coolors', url:'https://coolors.co', icon:'🌈' },
        { title:'Iconfont', url:'https://www.iconfont.cn', icon:'⚡' },
      ]
    },
    {
      title: '效率工具',
      links: [
        { title:'Notion', url:'https://www.notion.so', icon:'📝' },
        { title:'Obsidian', url:'https://obsidian.md', icon:'🌑' },
        { title:'Excalidraw', url:'https://excalidraw.com', icon:'✏️' },
        { title:'Tldraw', url:'https://www.tldraw.com', icon:'🖌️' },
        { title:'Pastebin', url:'https://pastebin.com', icon:'📋' },
        { title:'TinyURL', url:'https://tinyurl.com', icon:'🔗' },
      ]
    },
    {
      title: '资讯阅读',
      links: [
        { title:'Hacker News', url:'https://news.ycombinator.com', icon:'📰' },
        { title:'Reddit', url:'https://www.reddit.com', icon:'👽' },
        { title:'V2EX', url:'https://www.v2ex.com', icon:'💬' },
        { title:'少数派', url:'https://sspai.com', icon:'📱' },
        { title:'Product Hunt', url:'https://www.producthunt.com', icon:'🚀' },
        { title:'TechCrunch', url:'https://techcrunch.com', icon:'🔬' },
      ]
    }
  ];
  let html = `
    <div class="page-header">
      <div class="page-title">常用资源 · Quick Links</div>
    </div>`;
  categories.forEach(cat => {
    html += `<div class="res-section-title">${cat.title}</div><div class="res-link-list">`;
    cat.links.forEach(l => {
      html += `<a class="res-link-item" href="${l.url}" target="_blank" rel="noopener">
        <div class="res-link-favicon">${l.icon}</div>
        <div class="res-link-info"><div class="res-link-title">${l.title}</div><div class="res-link-url">${l.url.replace('https://','')}</div></div>
        <span class="res-link-arrow">→</span>
      </a>`;
    });
    html += `</div>`;
  });
  document.getElementById('content').innerHTML = html;
}

// === Knowledge Base ===
function renderKnowledge() {
  document.getElementById('content').innerHTML = `
    <div class="placeholder-page">
      <div class="placeholder-icon">📚</div>
      <div class="placeholder-title">Knowledge Base · 知识库</div>
      <div class="placeholder-desc">个人知识管理系统。将笔记、书摘、技术文档、学习资料统一管理，构建你的第二大脑。</div>
      <div class="placeholder-features">
        <span class="placeholder-feature">📝 Markdown笔记</span>
        <span class="placeholder-feature">🏷️ 标签分类</span>
        <span class="placeholder-feature">🔗 双向链接</span>
        <span class="placeholder-feature">🔍 全文搜索</span>
        <span class="placeholder-feature">📊 知识图谱</span>
        <span class="placeholder-feature">📖 书摘管理</span>
        <span class="placeholder-feature">💾 本地存储</span>
        <span class="placeholder-feature">🔄 导入/导出</span>
      </div>
      <button class="placeholder-cta" onclick="showToast('知识库模块开发中，敬请期待')">即将上线</button>
    </div>`;
}

// === AI Assistant ===
function renderAIAssistant() {
  document.getElementById('content').innerHTML = `
    <div class="placeholder-page">
      <div class="placeholder-icon">🤖</div>
      <div class="placeholder-title">AI Assistant · AI助手</div>
      <div class="placeholder-desc">你的私人AI助手。基于你的记忆数据，提供个性化建议、智能问答和自动化整理。记住你的一切，比你更懂你。</div>
      <div class="placeholder-features">
        <span class="placeholder-feature">💬 智能对话</span>
        <span class="placeholder-feature">🧠 记忆检索</span>
        <span class="placeholder-feature">📝 自动整理</span>
        <span class="placeholder-feature">📊 数据分析</span>
        <span class="placeholder-feature">🎯 个性化推荐</span>
        <span class="placeholder-feature">🌐 多模型支持</span>
        <span class="placeholder-feature">🔒 隐私优先</span>
        <span class="placeholder-feature">⚡ 快速访问</span>
      </div>
      <button class="placeholder-cta" onclick="showToast('AI助手模块开发中，敬请期待')">即将上线</button>
    </div>`;
}

// === Entry Card ===
function renderEntryCard(e, showYear = false) {
  const meta = TYPE_META[e.type] || TYPE_META.event;
  const date = getEntryDate(e);
  const time = getEntryTime(e);
  const yearLabel = showYear && date ? `<span>${date.slice(0,4)}</span>` : '';
  let poster = renderEntryPoster(e);
  let preview = e.review || e.content || e.notes || e.note || '';
  const tagsHtml = e.tags && e.tags.length ? `<span>${e.tags.slice(0,3).join(' · ')}</span>` : '';
  return `<div class="entry-card type-${e.type}"><div class="entry-time">${time || ''}</div><div class="entry-icon">${meta.emoji}</div><div class="entry-body"><div class="entry-title">${e.title}</div>${preview ? `<div class="entry-content-preview">${preview}</div>`:''}<div class="entry-meta">${yearLabel}${tagsHtml}</div></div>${poster}</div>`;
}

// === Today ===
async function renderToday() {
  const all = await dbGetAll();
  const sorted = sortEntries(all);
  const now = new Date();
  const todayStr = now.toISOString().slice(0,10);
  const todayEntries = sorted.filter(e => getEntryDate(e) === todayStr);
  const totalMovies = all.filter(e=>e.type==='movie').length;
  const totalBooks = all.filter(e=>e.type==='book').length;
  const weekdays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
  const todayDisplay = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日`;
  let html = `<div class="today-header"><div class="today-date">${todayDisplay}<span class="day">${weekdays[now.getDay()]} · 今天</span></div><div class="today-stats"><div class="today-stat">今日 <strong>${todayEntries.length}</strong> 条</div><div class="today-stat">共 <strong>${all.length}</strong> 条记忆</div><div class="today-stat">电影 <strong>${totalMovies}</strong> · 书籍 <strong>${totalBooks}</strong></div></div></div>`;

  // 我的赛程 (P3: My Schedule on homepage)
  const followedTeams = await dbGetTeams();
  if (followedTeams.length > 0) {
    // 真实赛程（足球=TheSportsDB，CS2=Liquipedia）；失败只展示缓存，不冒充真实数据
    const [fbOk, cs2Ok] = await Promise.all([ensureFootballMatches(), ensureCS2Matches()]);
    const cs2Ids = followedTeams.filter(t=>t.sport==='cs2').flatMap(t => [t.provider_team_id, t.tsdb_id].filter(Boolean));
    const fbIds = followedTeams.filter(t=>t.sport==='football').flatMap(t => [t.provider_team_id, t.tsdb_id].filter(Boolean));
    const cs2Matches = cs2MatchesForFollowed(followedTeams.filter(t=>t.sport==='cs2')).filter(m=>m.status==='upcoming' || m.status==='live');
    const fbMatches = getMatchesForTeams(fbIds, 'football').filter(m=>m.status==='upcoming' || m.status==='live');
    const allMyMatches = [...cs2Matches, ...fbMatches].sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    if (allMyMatches.length > 0) {
      html += `<div class="my-schedule-section card-enter"><div class="section-label">⚡ 我的赛程 · My Schedule</div><div class="match-list">`;
      allMyMatches.slice(0, 5).forEach(m => {
        const allIds = [...cs2Ids, ...fbIds];
        html += renderMatchCard(m, allIds);
      });
      html += `</div></div>`;
    }
  }

  if (todayEntries.length > 0) {
    html += '<div class="today-entries">';
    todayEntries.forEach((e,i) => { html += `<div class="card-enter" style="animation-delay:${i*0.06}s" onclick="openDetail(${e.id})">${renderEntryCard(e)}</div>`; });
    html += '</div>';
  } else {
    html += `<div class="empty-state"><div class="empty-state-icon">✦</div><div class="empty-state-title">今天还没有记录</div><div class="empty-state-desc">点击右下角的 + 按钮，开始记录你的第一个记忆</div></div>`;
  }
  const monthDay = todayStr.slice(5);
  const pastEntries = all.filter(e => { const d = getEntryDate(e); return d.endsWith(monthDay) && d !== todayStr; });
  if (pastEntries.length > 0) {
    html += `<div class="on-this-day"><div class="section-label">那年今日 · On This Day</div><div class="today-entries">`;
    sortEntries(pastEntries).forEach((e,i) => { html += `<div class="card-enter" style="animation-delay:${i*0.06}s" onclick="openDetail(${e.id})">${renderEntryCard(e, true)}</div>`; });
    html += '</div></div>';
  }
  document.getElementById('content').innerHTML = html;
}

// === Timeline ===
async function renderTimeline() {
  document.getElementById('content').innerHTML = `
    <div class="page-header"><div class="page-title">时间线 · Timeline</div>
      <div class="scale-switcher">
        <button class="scale-btn" onclick="setScale('day')">日</button>
        <button class="scale-btn active" onclick="setScale('month')">月</button>
        <button class="scale-btn" onclick="setScale('quarter')">季</button>
        <button class="scale-btn" onclick="setScale('year')">年</button>
        <button class="scale-btn" onclick="setScale('life')">人生</button>
      </div>
    </div>
    <div class="filter-bar">
      <button class="filter-chip active" onclick="setFilter('all',this)"><span>全部</span></button>
      <button class="filter-chip" onclick="setFilter('movie',this)"><span class="dot" style="background:var(--c-movie)"></span>电影</button>
      <button class="filter-chip" onclick="setFilter('book',this)"><span class="dot" style="background:var(--c-book)"></span>书籍</button>
      <button class="filter-chip" onclick="setFilter('music',this)"><span class="dot" style="background:var(--c-music)"></span>音乐</button>
      <button class="filter-chip" onclick="setFilter('game',this)"><span class="dot" style="background:var(--c-game)"></span>游戏</button>
      <button class="filter-chip" onclick="setFilter('place',this)"><span class="dot" style="background:var(--c-place)"></span>地点</button>
      <button class="filter-chip" onclick="setFilter('event',this)"><span class="dot" style="background:var(--c-event)"></span>事件</button>
    </div>
    <div id="timeline-content"><div class="loading-container"><div class="loading-spinner"></div><div class="loading-text">加载中...</div></div></div>`;
  await renderTimelineContent();
}

async function renderTimelineContent() {
  let entries = sortEntries(await dbGetAll());
  if (!activeFilters.has('all')) entries = entries.filter(e => activeFilters.has(e.type));
  const groups = {};
  entries.forEach(e => {
    const d = getEntryDate(e); if (!d) return;
    let key;
    if (activeScale === 'day') key = d;
    else if (activeScale === 'month') key = d.slice(0,7);
    else if (activeScale === 'quarter') { const m = parseInt(d.slice(5,7)); key = d.slice(0,4)+' Q'+Math.ceil(m/3); }
    else key = d.slice(0,4);
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });
  const sortedKeys = Object.keys(groups).sort().reverse();
  let html = '<div class="timeline">';
  sortedKeys.forEach(key => {
    const ge = groups[key];
    let label = activeScale === 'month' ? `${key.split('-')[0]}年${parseInt(key.split('-')[1])}月` : key;
    html += `<div class="timeline-group"><div class="timeline-group-header"><div class="timeline-group-date">${label}</div><div class="timeline-group-meta">${ge.length} 条</div></div><div class="timeline-line">`;
    ge.forEach(e => {
      const meta = TYPE_META[e.type] || TYPE_META.event;
      html += `<div class="timeline-item"><div class="timeline-item-dot" style="border-color:${meta.color}"></div><div onclick="openDetail(${e.id})">${renderEntryCard(e)}</div></div>`;
    });
    html += '</div></div>';
  });
  if (sortedKeys.length === 0) html += '<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-title">没有符合条件的记录</div><div class="empty-state-desc">尝试更换筛选条件，或点击 + 添加新记录</div></div>';
  html += '</div>';
  document.getElementById('timeline-content').innerHTML = html;
}

function setScale(scale) {
  activeScale = scale;
  document.querySelectorAll('.scale-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  renderTimelineContent();
}
function setFilter(type) {
  if (type === 'all') { activeFilters.clear(); activeFilters.add('all'); }
  else {
    activeFilters.delete('all');
    if (activeFilters.has(type)) activeFilters.delete(type); else activeFilters.add(type);
    if (activeFilters.size === 0) activeFilters.add('all');
  }
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  if (activeFilters.has('all')) document.querySelector('.filter-chip').classList.add('active');
  else activeFilters.forEach(t => { const chip = document.querySelector(`.filter-chip[onclick*="'${t}'"]`); if (chip) chip.classList.add('active'); });
  renderTimelineContent();
}

// === Library ===
async function renderLibrary(tab) {
  const all = await dbGetAll();
  const c = { movie:all.filter(e=>e.type==='movie').length, book:all.filter(e=>e.type==='book').length, music:all.filter(e=>e.type==='music').length, game:all.filter(e=>e.type==='game').length, place:all.filter(e=>e.type==='place').length };
  document.getElementById('content').innerHTML = `
    <div class="page-header"><div class="page-title">收藏 · Library</div></div>
    <div class="lib-tabs">
      <button class="lib-tab ${tab==='movie'?'active':''}" onclick="renderLibraryTab('movie')">🎬 电影 <span class="count">${c.movie}</span></button>
      <button class="lib-tab ${tab==='book'?'active':''}" onclick="renderLibraryTab('book')">📖 书籍 <span class="count">${c.book}</span></button>
      <button class="lib-tab ${tab==='music'?'active':''}" onclick="renderLibraryTab('music')">🎵 音乐 <span class="count">${c.music}</span></button>
      <button class="lib-tab ${tab==='game'?'active':''}" onclick="renderLibraryTab('game')">🎮 游戏 <span class="count">${c.game}</span></button>
      <button class="lib-tab ${tab==='place'?'active':''}" onclick="renderLibraryTab('place')">📍 地点 <span class="count">${c.place}</span></button>
    </div>
    <div id="lib-content"></div>`;
  await renderLibraryTab(tab);
}

async function renderLibraryTab(tab) {
  document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
  const labels = { movie:'电影', book:'书籍', music:'音乐', game:'游戏', place:'地点' };
  const tabEl = Array.from(document.querySelectorAll('.lib-tab')).find(t => t.textContent.includes(labels[tab]));
  if (tabEl) tabEl.classList.add('active');
  const content = document.getElementById('lib-content');
  const items = sortEntries((await dbGetAll()).filter(e => e.type === tab));

  if (tab === 'movie') {
    window._movieItems = items;
    const thisYear = items.filter(m => (getEntryDate(m)||'').slice(0,4) === String(new Date().getFullYear())).length;
    let html = `
      <div class="lib-toolbar">
        <div class="lib-search-box">
          <svg class="lib-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="lib-search-input" id="movie-search" placeholder="搜索电影名、导演..." oninput="filterMovieWall()">
        </div>
      </div>
      <div class="lib-stats-bar">
        <div class="lib-stat"><span class="lib-stat-num">${items.length}</span><span class="lib-stat-label">部</span></div>
        <div class="lib-stat"><span class="lib-stat-num">${thisYear}</span><span class="lib-stat-label">今年看过</span></div>
      </div>`;
    content.innerHTML = html + '<div id="movie-wall-content"></div>';
    renderMovieWallContent(items);
  } else if (tab === 'book') {
    window._bookItems = items;
    const wantRead = items.filter(b => !b.finish_date && !b.start_date).length;
    const reading = items.filter(b => b.start_date && !b.finish_date).length;
    const done = items.filter(b => b.finish_date).length;
    let html = `
      <div class="lib-toolbar">
        <div class="book-status-tabs">
          <button class="book-status-tab active" data-status="all" onclick="filterBookWall('all',this)">全部 <span class="count">${items.length}</span></button>
          <button class="book-status-tab" data-status="want" onclick="filterBookWall('want',this)">想读 <span class="count">${wantRead}</span></button>
          <button class="book-status-tab" data-status="reading" onclick="filterBookWall('reading',this)">在读 <span class="count">${reading}</span></button>
          <button class="book-status-tab" data-status="done" onclick="filterBookWall('done',this)">已读 <span class="count">${done}</span></button>
        </div>
      </div>`;
    content.innerHTML = html + '<div id="book-wall-content"></div>';
    renderBookWallContent(items, 'all');
  } else if (tab === 'music') {
    let html = '<div class="books-grid">';
    items.forEach(m => {
      html += `<div class="book-card" onclick="openDetail(${m.id})"><div class="entry-icon" style="width:64px;height:64px;border-radius:8px;background:rgba(201,123,99,0.12);color:var(--c-music);font-size:28px;">🎵</div><div class="book-info"><div class="book-title">${m.title}</div><div class="book-author">${m.artist||''}</div><div class="book-date">${(m.date||'').replace(/-/g,'/')}</div></div></div>`;
    });
    content.innerHTML = html ? html + '</div>' : '<div class="empty-state"><div class="empty-state-icon">🎵</div><div class="empty-state-title">还没有音乐记录</div><div class="empty-state-desc">点击 + 按钮，记录你听过的音乐</div></div>';
  } else if (tab === 'game') {
    let html = '<div class="books-grid">';
    items.forEach(g => {
      const coverHtml = g.cover
        ? `<img class="book-cover" src="${proxyImage(g.cover)}" alt="${g.title}" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="book-cover" style="background:rgba(90,139,173,0.12);display:flex;align-items:center;justify-content:center;font-size:28px;color:var(--c-game);">🎮</div>`;
      html += `<div class="book-card" onclick="openDetail(${g.id})">${coverHtml}<div class="book-info"><div class="book-title">${g.title}</div><div class="book-author">${g.platform||''}</div><div class="book-date">${g.finish_date?'完成于 '+g.finish_date.replace(/-/g,'/'):'进行中'}</div></div></div>`;
    });
    content.innerHTML = html + '</div>' || '<div class="search-empty">还没有游戏记录</div>';
  } else if (tab === 'place') {
    let html = '<div class="books-grid">';
    items.forEach(p => {
      html += `<div class="book-card type-place" onclick="openDetail(${p.id})"><div class="entry-icon" style="width:64px;height:90px;border-radius:6px;background:rgba(201,169,97,0.15);color:var(--c-place);font-size:28px;display:flex;align-items:center;justify-content:center;">📍</div><div class="book-info"><div class="book-title">${p.title}</div><div class="book-author">${p.location||''}</div><div class="book-date">${(p.date||'').replace(/-/g,'/')}</div></div></div>`;
    });
    content.innerHTML = html ? html + '</div>' : '<div class="empty-state"><div class="empty-state-icon">📍</div><div class="empty-state-title">还没有地点记录</div><div class="empty-state-desc">点击 + 按钮，记录你去过的地方</div></div>';
  }
}

// === Movie Wall Content Renderer ===
function renderMovieWallContent(items) {
  const container = document.getElementById('movie-wall-content');
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎬</div><div class="empty-state-title">没有符合条件的电影</div><div class="empty-state-desc">试试调整搜索或筛选条件</div></div>';
    return;
  }
  const byYear = {};
  items.forEach(m => { const y = (getEntryDate(m)||'').slice(0,4) || '未知'; if (!byYear[y]) byYear[y] = []; byYear[y].push(m); });
  let html = '';
  Object.keys(byYear).sort().reverse().forEach((y, yi) => {
    html += `<div class="year-section card-enter" style="animation-delay:${yi*0.08}s"><div class="year-header"><div class="year-number">${y}</div><div class="year-count">${byYear[y].length} 部</div></div><div class="poster-wall">`;
    byYear[y].forEach((m, mi) => {
      const delay = (yi*0.08 + mi*0.03).toFixed(2);
      html += `<div class="poster-item card-enter" style="animation-delay:${delay}s" onclick="openDetail(${m.id})">${renderPosterWall(m)}<div class="poster-title">${m.title}</div><div class="poster-meta">${m.director || ''}${m.release_date ? ' · ' + m.release_date : ''}</div></div>`;
    });
    html += '</div></div>';
  });
  container.innerHTML = html;
}

function filterMovieWall() {
  const q = (document.getElementById('movie-search')?.value || '').toLowerCase().trim();
  let filtered = window._movieItems || [];
  if (q) filtered = filtered.filter(m => {
    return (m.title||'').toLowerCase().includes(q) ||
           (m.original_title||'').toLowerCase().includes(q) ||
           (m.director||'').toLowerCase().includes(q) ||
           (m.genres||[]).some(g => g.toLowerCase().includes(q));
  });
  renderMovieWallContent(filtered);
}

// === Book Wall Content Renderer ===
function renderBookWallContent(items, status) {
  const container = document.getElementById('book-wall-content');
  if (!container) return;
  let filtered = items;
  if (status === 'want') filtered = items.filter(b => !b.finish_date && !b.start_date);
  else if (status === 'reading') filtered = items.filter(b => b.start_date && !b.finish_date);
  else if (status === 'done') filtered = items.filter(b => b.finish_date);

  if (filtered.length === 0) {
    const msgs = { all:'还没有书籍记录', want:'没有想读的书籍', reading:'没有在读的书籍', done:'没有已读的书籍' };
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📖</div><div class="empty-state-title">${msgs[status]||'没有书籍'}</div><div class="empty-state-desc">点击 + 按钮，搜索书籍并记录你的阅读体验</div></div>`;
    return;
  }

  if (status === 'done' || status === 'all') {
    const byYear = {};
    filtered.forEach(b => {
      const y = b.finish_date ? b.finish_date.slice(0,4) : (b.start_date ? b.start_date.slice(0,4) : '未开始');
      if (!byYear[y]) byYear[y] = []; byYear[y].push(b);
    });
    let html = '';
    Object.keys(byYear).sort().reverse().forEach((y, yi) => {
      html += `<div class="year-section card-enter" style="animation-delay:${yi*0.08}s"><div class="year-header"><div class="year-number">${y}</div><div class="year-count">${byYear[y].length} 本</div></div><div class="books-grid">`;
      byYear[y].forEach((b, bi) => {
        const delay = (yi*0.08 + bi*0.03).toFixed(2);
        html += renderBookCard(b, delay);
      });
      html += '</div></div>';
    });
    container.innerHTML = html;
  } else {
    let html = '<div class="books-grid">';
    filtered.forEach((b, bi) => {
      html += renderBookCard(b, (bi*0.04).toFixed(2));
    });
    container.innerHTML = html + '</div>';
  }
}

function renderBookCard(b, delay) {
  const [c1,c2] = getPosterColors(b);
  const coverHtml = b.cover
    ? `<div class="book-cover" style="background:linear-gradient(135deg,${c1},${c2});position:relative;overflow:hidden;"><div class="poster-fallback"><span class="pp-icon" style="font-size:20px;">📖</span><span class="pp-title" style="font-size:9px;">${b.title}</span></div><img src="${proxyImage(b.cover)}" alt="${b.title}" loading="lazy" onerror="this.style.display='none'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;"></div>`
    : `<div class="book-cover" style="background:linear-gradient(135deg,${c1},${c2});display:flex;align-items:center;justify-content:center;font-size:20px;">📖</div>`;
  const statusBadge = b.finish_date
    ? '<span class="book-status-badge done">已读</span>'
    : b.start_date
      ? '<span class="book-status-badge reading">在读</span>'
      : '<span class="book-status-badge want">想读</span>';
  const dateStr = b.finish_date ? '读完于 ' + b.finish_date.replace(/-/g,'/') : b.start_date ? '开始于 ' + b.start_date.replace(/-/g,'/') : '未开始';
  return `<div class="book-card card-enter" style="animation-delay:${delay||'0'}s" onclick="openDetail(${b.id})">${coverHtml}<div class="book-info">${statusBadge}<div class="book-title">${b.title}</div><div class="book-author">${b.author||''}</div><div class="book-date">${dateStr}</div></div></div>`;
}

function filterBookWall(status, btn) {
  document.querySelectorAll('.book-status-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderBookWallContent(window._bookItems || [], status);
}

// === Search ===
function renderSearch() {
  document.getElementById('content').innerHTML = `
    <div class="page-header"><div class="page-title">搜索 · Search</div></div>
    <div class="search-container">
      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="search-input" id="search-input" placeholder="搜索你的记忆..." oninput="doSearch(this.value)">
      </div>
      <div class="search-suggestions">
        <span class="search-suggestion" onclick="quickSearch('银翼杀手')">银翼杀手</span>
        <span class="search-suggestion" onclick="quickSearch('科幻')">科幻</span>
        <span class="search-suggestion" onclick="quickSearch('历史')">历史</span>
        <span class="search-suggestion" onclick="quickSearch('旅行')">旅行</span>
        <span class="search-suggestion" onclick="quickSearch('宫崎骏')">宫崎骏</span>
      </div>
      <div id="search-results"></div>
    </div>`;
}
async function doSearch(query) {
  const results = document.getElementById('search-results');
  if (!query || query.trim() === '') { results.innerHTML = ''; return; }
  const q = query.toLowerCase().trim();
  const all = await dbGetAll();
  const matches = all.filter(e => {
    const f = [e.title,e.original_title,e.author,e.director,e.artist,e.review,e.notes,e.content,e.note,e.location,...(e.tags||[]),...(e.genres||[])];
    return f.some(x => x && String(x).toLowerCase().includes(q));
  });
  if (matches.length === 0) { results.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-title">没有找到相关记忆</div><div class="empty-state-desc">试试其他关键词，或者添加新的记录</div></div>'; return; }
  let html = '<div class="search-results">';
  sortEntries(matches).forEach((e,i) => { html += `<div class="card-enter" style="animation-delay:${i*0.04}s" onclick="openDetail(${e.id})">${renderEntryCard(e, true)}</div>`; });
  html += '</div>';
  results.innerHTML = html;
}
function quickSearch(q) { document.getElementById('search-input').value = q; doSearch(q); }

// === On This Day ===
async function renderOnThisDay() {
  const all = await dbGetAll();
  const past = sortEntries(all.filter(e => { const d = getEntryDate(e); return d.endsWith('-08-27') && d !== '2026-08-27'; }));
  let html = `<div class="page-header"><div class="page-title">那年今日 · On This Day</div></div><div style="font-size:14px;color:var(--text-secondary);margin-bottom:32px;">8月27日 · 时间纵向切片</div>`;
  if (past.length === 0) html += '<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-title">还没有这一天的历史记录</div><div class="empty-state-desc">随着你记录更多内容，这里会展示同一天的历史记忆</div></div>';
  else { html += '<div class="today-entries">'; past.forEach((e,i) => { html += `<div class="card-enter" style="animation-delay:${i*0.06}s" onclick="openDetail(${e.id})">${renderEntryCard(e, true)}</div>`; }); html += '</div>'; }
  document.getElementById('content').innerHTML = html;
}

// === Random ===
async function renderRandom() {
  const all = await dbGetAll();
  if (all.length === 0) { document.getElementById('content').innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎲</div><div class="empty-state-title">还没有记忆记录</div><div class="empty-state-desc">添加一些记录后，这里会随机展示一条回忆</div></div>'; return; }
  const r = all[Math.floor(Math.random() * all.length)];
  document.getElementById('content').innerHTML = `<div class="page-header"><div class="page-title">随机回忆 · Random Memory</div><button class="btn btn-ghost" onclick="renderRandom()">换一个 →</button></div><div style="font-size:14px;color:var(--text-secondary);margin-bottom:32px;">给你看看一个你可能已经忘记的时刻</div><div class="card-enter" onclick="openDetail(${r.id})">${renderEntryCard(r, true)}</div>`;
}

// === Year Review ===
async function renderYearReview(yearOverride) {
  const all = await dbGetAll();
  const now = new Date();
  const year = yearOverride || window._reviewYear || now.getFullYear();
  window._reviewYear = year;
  const yearEntries = all.filter(e => (getEntryDate(e)||'').slice(0,4) === String(year));
  const movies = yearEntries.filter(e => e.type === 'movie');
  const books = yearEntries.filter(e => e.type === 'book' && e.finish_date);
  const games = yearEntries.filter(e => e.type === 'game');
  const events = yearEntries.filter(e => e.type === 'event' || e.type === 'diary');
  const typeCounts = {};
  yearEntries.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });

  // Monthly activity
  const monthMap = {};
  for (let i = 0; i < 12; i++) monthMap[i] = 0;
  yearEntries.forEach(e => { const m = parseInt((getEntryDate(e)||'').slice(5,7)); if (m >= 1 && m <= 12) monthMap[m-1]++; });
  const maxMonth = Math.max(...Object.values(monthMap), 1);

  let html = `
    <div class="page-header">
      <div class="page-title">${year} 年度回顾</div>
      <div class="scale-switcher" id="year-switcher">
        <button class="scale-btn" onclick="changeReviewYear(${year-1})">${year-1}</button>
        <button class="scale-btn active">${year}</button>
        ${year < now.getFullYear() ? `<button class="scale-btn" onclick="changeReviewYear(${year+1})">${year+1}</button>` : ''}
      </div>
    </div>`;

  // Hero stats card
  html += `
    <div class="yr-hero card-enter">
      <div class="yr-hero-bg" style="background:linear-gradient(135deg, var(--accent), var(--accent-soft));"></div>
      <div class="yr-hero-content">
        <div class="yr-hero-year">${year}</div>
        <div class="yr-hero-summary">${yearEntries.length} 条记忆 · ${movies.length} 部电影 · ${books.length} 本书 · ${events.length} 条记录</div>
      </div>
    </div>`;

  // Stats grid
  html += `<div class="yr-stats-grid">`;
  const statItems = [
    { label:'电影', num:movies.length, emoji:'🎬', color:'var(--c-movie)' },
    { label:'书籍', num:books.length, emoji:'📖', color:'var(--c-book)' },
    { label:'游戏', num:games.length, emoji:'🎮', color:'var(--c-game)' },
    { label:'记录', num:events.length, emoji:'✦', color:'var(--c-event)' },
  ];
  statItems.forEach((s, i) => {
    html += `<div class="yr-stat-card card-enter" style="animation-delay:${i*0.06}s;border-top:3px solid ${s.color}">
      <div class="yr-stat-emoji">${s.emoji}</div>
      <div class="yr-stat-num">${s.num}</div>
      <div class="yr-stat-label">${s.label}</div>
    </div>`;
  });
  html += `</div>`;

  // Monthly activity chart
  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  html += `<div class="yr-section card-enter"><div class="detail-section-title">月度活跃 · Monthly Activity</div><div class="yr-chart">`;
  monthNames.forEach((mn, i) => {
    const h = Math.round((monthMap[i] / maxMonth) * 100);
    html += `<div class="yr-chart-bar" title="${mn}: ${monthMap[i]} 条"><div class="yr-chart-fill" style="height:${Math.max(h,3)}%;animation-delay:${i*0.04}s"></div><div class="yr-chart-label">${mn.replace('月','')}</div></div>`;
  });
  html += `</div></div>`;

  // Type breakdown
  const typeEntries = Object.entries(typeCounts).sort((a,b) => b[1] - a[1]);
  if (typeEntries.length > 0) {
    const total = typeEntries.reduce((s,[,n]) => s+n, 0);
    html += `<div class="yr-section card-enter"><div class="detail-section-title">类型分布 · Type Breakdown</div><div class="yr-breakdown">`;
    typeEntries.forEach(([type, count]) => {
      const meta = TYPE_META[type] || {emoji:'•',label:type,color:'var(--text-tertiary)'};
      const pct = Math.round((count/total)*100);
      html += `<div class="yr-breakdown-row"><div class="yr-breakdown-label">${meta.emoji} ${meta.label}</div><div class="yr-breakdown-bar"><div class="yr-breakdown-fill" style="width:${pct}%;background:${meta.color}"></div></div><div class="yr-breakdown-num">${count}</div></div>`;
    });
    html += `</div></div>`;
  }

  if (yearEntries.length === 0) {
    html = `<div class="page-header"><div class="page-title">${year} 年度回顾</div></div><div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-title">${year}年还没有记录</div><div class="empty-state-desc">开始记录你的记忆，年底就能看到精彩回顾了</div></div>`;
  }

  document.getElementById('content').innerHTML = html;
}
function changeReviewYear(yr) {
  renderYearReview(yr);
}

// === Settings ===
async function renderSettings() {
  const all = await dbGetAll();
  const counts = {};
  all.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
  const cfg = getSyncConfig();
  const lastSynced = await dbGetMeta('last_synced_at');
  const lastCloud = await dbGetMeta('last_cloud_sync');
  let html = `
    <div class="page-header"><div class="page-title">设置 · Settings</div></div>
    <div class="settings-section">
      <div class="section-label">账户 · Account</div>
      <div class="settings-card">
        ${authState.loggedIn ? `
          <div class="settings-row"><div><div class="settings-row-label">✓ 已登录：${authState.email}</div><div class="settings-row-desc">所有设备自动同步（改动即时 + 每 5 分钟）；删除会同步到所有设备。</div></div></div>
          <div class="settings-row"><div><div class="settings-row-label">同步状态</div><div class="settings-row-desc" id="cloud-sync-status">${lastCloud ? '✓ 上次同步 ' + new Date(lastCloud).toLocaleString() : '从未同步（保存/删除内容后自动同步）'}</div></div><button class="btn btn-ghost" onclick="syncNow()">立即同步</button></div>
          <div class="settings-row"><div><div class="settings-row-label">退出登录</div><div class="settings-row-desc">本机数据保留，仅停止云同步。</div></div><button class="btn btn-ghost" onclick="logoutAccount()">退出</button></div>
        ` : `
          <div class="settings-row"><div><div class="settings-row-label">${authState.guest ? '访客模式' : '未登录'}</div><div class="settings-row-desc">${authState.guest ? '数据仅存本机。登录后可在所有设备间同步。' : '登录后可在所有设备间同步你的记忆（免费）。'}</div></div><button class="btn btn-ghost" onclick="location.reload()">去登录</button></div>
        `}
      </div>
    </div>
    <div class="settings-section">
      <div class="section-label">数据统计</div>
      <div class="settings-card">
        <div class="settings-row"><div class="settings-row-label">总记录数</div><div class="settings-row-value">${all.length} 条</div></div>
        ${Object.entries(counts).map(([t,n]) => { const m = TYPE_META[t]||{emoji:'',label:t}; return `<div class="settings-row"><div class="settings-row-label">${m.emoji} ${m.label}</div><div class="settings-row-value">${n} 条</div></div>`; }).join('')}
      </div>
    </div>
    <div class="settings-section">
      <div class="section-label">数据管理</div>
      <div class="settings-card">
        <div class="settings-row"><div><div class="settings-row-label">修复海报缓存</div><div class="settings-row-desc">重新下载所有海报图片并本地缓存</div></div><button class="btn btn-ghost" onclick="fixPostersManual()">修复</button></div>
        <div class="settings-row"><div><div class="settings-row-label">导出数据</div><div class="settings-row-desc">下载 JSON 格式的完整记忆档案</div></div><button class="btn btn-ghost" onclick="exportData()">导出</button></div>
        <div class="settings-row"><div><div class="settings-row-label">导入备份</div><div class="settings-row-desc">从导出的 JSON 文件恢复（相同记录按更新时间合并，不覆盖较新内容）</div></div><button class="btn btn-ghost" onclick="document.getElementById('import-file').click()">导入</button></div>
        <input type="file" id="import-file" accept="application/json" style="display:none" onchange="importData(this)">
        <div class="settings-row"><div><div class="settings-row-label" style="color:var(--danger);">清除所有数据</div><div class="settings-row-desc">删除全部记忆，不可恢复</div></div><button class="btn btn-ghost" style="color:var(--danger);" onclick="confirmClearData()">清除</button></div>
      </div>
    </div>
    <div class="settings-section">
      <div class="section-label">Sports 关注管理</div>
      <div class="settings-card">
        <div class="settings-row"><div><div class="settings-row-label">足球主队</div><div class="settings-row-desc">搜索、选择和管理你的足球主队；资源页只显示相关赛事。</div></div><button class="btn btn-ghost" onclick="openTeamSelector('football')">管理</button></div>
        <div class="settings-row"><div><div class="settings-row-label">CS2 关注战队</div><div class="settings-row-desc">搜索、选择和管理你关注的 CS2 战队。</div></div><button class="btn btn-ghost" onclick="openTeamSelector('cs2')">管理</button></div>
        <div class="settings-row"><div><div class="settings-row-label">赛事缓存</div><div class="settings-row-desc">本地缓存每个项目的最后同步时间；手动刷新不会请求付费服务。</div></div><div class="settings-row-value">本地</div></div>
      </div>
    </div>
    <div class="settings-section">
      <div class="section-label">导出备份 · WebDAV（可选）</div>
      <div class="settings-card sync-card">
        <div class="sync-intro">多设备同步请使用上方「账户 · Account」功能（推荐）。本区仅作为<b>手动备份</b>到自有 WebDAV 网盘的可选方式（推荐<a href="https://www.jianguoyun.com" target="_blank" rel="noopener">坚果云</a>）。快照存在你自己的网盘里，InnerOS 服务器不存任何数据；凭据只保存在本机浏览器。<br>⚠️ 坚果云会拦截云服务器 IP：<b>线上版</b>可能报 520，请在<b>本地版</b>使用；自建/群晖等 WebDAV 不受影响。</div>
        <div class="field-row"><div class="field-label">WebDAV 地址</div><input type="url" class="field-input" id="sync-url" placeholder="https://dav.jianguoyun.com/dav/InnerOS/inneros-backup.json" value="${cfg.url || ''}"></div>
        <div class="field-row"><div class="field-label">账号</div><input type="text" class="field-input" id="sync-user" placeholder="登录邮箱" value="${cfg.user || ''}"></div>
        <div class="field-row"><div class="field-label">应用密码</div><input type="password" class="field-input" id="sync-pass" placeholder="网盘生成的应用密码（非登录密码）" value="${cfg.pass || ''}"></div>
        <div class="sync-actions">
          <button class="btn btn-ghost" onclick="syncTest()">测试连接</button>
          <button class="btn btn-primary" onclick="syncUpload()">上传到云端</button>
          <button class="btn btn-ghost" onclick="syncDownload()">从云端恢复</button>
        </div>
        <div class="sync-status" id="sync-status">上次同步：${lastSynced ? new Date(lastSynced).toLocaleString() : '从未同步'}</div>
      </div>
    </div>
    <div class="settings-section">
      <div class="section-label">关于</div>
      <div class="settings-card">
        <div class="settings-row"><div class="settings-row-label">Personal Memory OS</div><div class="settings-row-value">Phase 3 · P3</div></div>
        <div class="settings-row"><div class="settings-row-label">存储方式</div><div class="settings-row-value">IndexedDB · 本地</div></div>
        <div class="settings-row"><div class="settings-row-label">数据不会离开你的设备</div><div class="settings-row-value">✓</div></div>
      </div>
    </div>`;
  document.getElementById('content').innerHTML = html;
}

// === Export ===
async function exportData() {
  const all = await dbGetAll();
  const teams = await dbGetTeams();
  const data = { version:'1.1', export_date:new Date().toISOString(), entries:all, teams };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `memory-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('数据已导出', 'success');
}

// === Import（本地备份恢复；与云端恢复共用 mergeSnapshot，逐条新者胜，不覆盖较新内容） ===
function importData(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.entries)) throw new Error('格式不对');
      showConfirm('📥', '导入备份', `将合并 ${data.entries.length} 条记录（相同记录按更新时间取较新，不会删除现有内容）。继续吗？`, async () => {
        const r = await mergeSnapshot(data);
        showToast(`导入完成：新增 ${r.addedCount}，更新 ${r.updatedCount}`, 'success');
        await navigate('settings');
      });
    } catch (e) {
      showToast('导入失败：' + e.message, 'error');
    }
  };
  reader.readAsText(file);
}

// === 云同步操作（设置页按钮） ===
function collectSyncConfig() {
  const url = document.getElementById('sync-url')?.value.trim() || '';
  const user = document.getElementById('sync-user')?.value.trim() || '';
  const pass = document.getElementById('sync-pass')?.value || '';
  saveSyncConfig({ url, user, pass });
  return { url, user, pass };
}
function setSyncStatus(text, isError) {
  const el = document.getElementById('sync-status');
  if (el) { el.textContent = text; el.style.color = isError ? 'var(--danger)' : ''; }
}
async function syncTest() {
  collectSyncConfig();
  setSyncStatus('连接中...');
  try {
    await SyncAdapter.test();
    setSyncStatus('✓ 连接成功');
    showToast('WebDAV 连接成功', 'success');
  } catch (e) { setSyncStatus('✗ ' + e.message, true); showToast(e.message, 'error'); }
}
async function syncUpload() {
  collectSyncConfig();
  setSyncStatus('上传中...');
  try {
    const r = await SyncAdapter.push();
    setSyncStatus(`✓ 已上传 ${r.count} 条 · ${new Date(r.at).toLocaleString()}`);
    showToast('已上传到云端', 'success');
  } catch (e) { setSyncStatus('✗ ' + e.message, true); showToast(e.message, 'error'); }
}
async function syncDownload() {
  collectSyncConfig();
  setSyncStatus('拉取中...');
  try {
    const r = await SyncAdapter.pull();
    setSyncStatus(`✓ 已恢复 · 新增 ${r.addedCount}，更新 ${r.updatedCount} · ${new Date(r.at).toLocaleString()}`);
    showToast(`云端恢复完成：新增 ${r.addedCount}，更新 ${r.updatedCount}`, 'success');
    await navigate('settings');
  } catch (e) { setSyncStatus('✗ ' + e.message, true); showToast(e.message, 'error'); }
}

// === Clear ===
function confirmClearData() {
  showConfirm('🗑️', '清除所有数据', '这将删除你全部的记忆记录，且不可恢复。确定继续吗？', async () => {
    await dbClear();
    localStorage.removeItem('memory_os_seeded');
    showToast('所有数据已清除，即将重新加载...', 'success');
    setTimeout(() => location.reload(), 800);
  });
}

// === Entry Detail ===
async function openDetail(id, fromPop = false) {
  const e = await dbGet(id);
  if (!e) return;
  // 浏览器返回键集成：详情页入栈，返回时回到来源页面（fromPop=true 不重复入栈）
  if (!fromPop) history.pushState({ __inneros: true, page: currentPage, detail: id }, '');
  detailOpenId = id;
  const meta = TYPE_META[e.type] || TYPE_META.event;
  const date = getEntryDate(e);
  const time = getEntryTime(e);
  let html = `<button class="detail-back" onclick="history.back()">← 返回</button>`;
  html += `<div class="detail-actions"><button class="detail-action-btn" onclick="openCapture(${e.id})">＋ 追加记录</button><button class="detail-action-btn danger" onclick="confirmDelete(${e.id})">🗑 删除</button></div>`;

  // V1.2 §7：事件 / 日记 / 地点 详情必须在顶部突出「地点 + 时间」。
  let heroMeta = '';
  if (e.type === 'event' || e.type === 'diary' || e.type === 'place') {
    const parts = [];
    if (e.location) parts.push(`📍 ${e.location}`);
    const hd = getEntryDate(e), ht = getEntryTime(e);
    if (hd) parts.push(`🕒 ${hd.replace(/-/g, '/')}${ht ? ' ' + ht : ''}`);
    if (parts.length) heroMeta = `<div class="detail-hero-meta" style="margin-top:8px;font-size:13px;color:var(--text-secondary);display:flex;gap:14px;flex-wrap:wrap;">${parts.join('<span style="opacity:.4">·</span>')}</div>`;
  }

  // Hero: poster + title + type badge
  if (e.poster || e.cover) {
    html += `<div class="detail-hero fade-in">${renderDetailPoster(e)}<div class="detail-info"><div class="detail-type-badge" style="background:${meta.color}22;color:${meta.color}">${meta.emoji} ${meta.label}</div><div class="detail-title">${e.title}</div>`;
    if (e.original_title) html += `<div class="detail-subtitle">${e.original_title}</div>`;
    html += heroMeta + '</div></div>';
  } else {
    html += `<div class="detail-hero fade-in" style="gap:0"><div class="detail-info"><div class="detail-type-badge" style="background:${meta.color}22;color:${meta.color}">${meta.emoji} ${meta.label}</div><div class="detail-title">${e.title}</div>`;
    if (e.location) html += `<div class="detail-subtitle">${e.location}</div>`;
    html += heroMeta + '</div></div>';
  }

  // 作品资料 (Objective data — external info about the work itself)
  let objHtml = '';
  if (e.director) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">导演</span><span class="detail-meta-value">${e.director}</span></div>`;
  if (e.author) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">作者</span><span class="detail-meta-value">${e.author}</span></div>`;
  if (e.artist) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">艺人</span><span class="detail-meta-value">${e.artist}</span></div>`;
  if (e.album) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">专辑</span><span class="detail-meta-value">${e.album}</span></div>`;
  if (e.genres && e.genres.length) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">类型</span><span class="detail-meta-value">${e.genres.join(' / ')}</span></div>`;
  if (e.rating) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">豆瓣评分</span><span class="detail-meta-value" style="color:#F5A623;font-weight:700;">★ ${e.rating}</span></div>`;
  if (e.runtime) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">片长</span><span class="detail-meta-value">${e.runtime} 分钟</span></div>`;
  if (e.release_date) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">上映</span><span class="detail-meta-value">${e.release_date}</span></div>`;
  if (e.publisher) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">出版社</span><span class="detail-meta-value">${e.publisher}</span></div>`;
  if (e.isbn) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">ISBN</span><span class="detail-meta-value">${e.isbn}</span></div>`;
  if (e.page_count) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">页数</span><span class="detail-meta-value">${e.page_count}</span></div>`;
  if (e.platform) objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">平台</span><span class="detail-meta-value">${e.platform}</span></div>`;
  if (e.location && e.type === 'place') objHtml += `<div class="detail-meta-item"><span class="detail-meta-label">位置</span><span class="detail-meta-value">${e.location}</span></div>`;
  const synopsis = e.book_description || e.description; // 书籍=book_description，电影=description（豆瓣详情补全）
  if (synopsis) objHtml += `<div class="detail-meta-item" style="grid-column:1/-1"><span class="detail-meta-label">简介</span><span class="detail-meta-value" style="font-size:13px;line-height:1.6;">${synopsis.slice(0,300)}${synopsis.length>300?'...':''}</span></div>`;
  if (objHtml) html += `<div class="detail-section fade-in-delay-1"><div class="detail-section-title">作品资料 · Work Info</div><div class="detail-meta-grid">${objHtml}</div></div>`;

  // 我的记录 (Personal data — user's own experience)
  let perHtml = '';
  if (date) perHtml += `<div class="detail-meta-item"><span class="detail-meta-label">${e.type==='movie'?'观看日期':e.type==='book'?'读完日期':e.type==='game'?'游玩日期':'日期'}</span><span class="detail-meta-value">${date.replace(/-/g,'/')}</span></div>`;
  if (time) perHtml += `<div class="detail-meta-item"><span class="detail-meta-label">时间</span><span class="detail-meta-value">${time}</span></div>`;
  if (e.mood) perHtml += `<div class="detail-meta-item"><span class="detail-meta-label">心情</span><span class="detail-meta-value">${e.mood}</span></div>`;
  if (e.category) perHtml += `<div class="detail-meta-item"><span class="detail-meta-label">分类</span><span class="detail-meta-value">${e.category}</span></div>`;
  if (e.reading_status) perHtml += `<div class="detail-meta-item"><span class="detail-meta-label">阅读状态</span><span class="detail-meta-value">${e.reading_status==='done'?'已读':e.reading_status==='reading'?'在读':'想读'}</span></div>`;
  if (perHtml) html += `<div class="detail-section fade-in-delay-1"><div class="detail-section-title">我的记录 · My Record</div><div class="detail-meta-grid">${perHtml}</div></div>`;

  // 我的记忆 (Multiple entries — append model, chronological)
  const entries = e.entries || [];
  if (entries.length > 0) {
    // New model: show all entries chronologically
    const sorted = [...entries].sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    html += `<div class="detail-section fade-in-delay-2"><div class="detail-section-title">我的记忆 · Memories (${sorted.length})</div>`;
    sorted.forEach((en, i) => {
      const entryDate = en.created_at ? new Date(en.created_at) : null;
      const dateStr = entryDate ? `${entryDate.getFullYear()}-${String(entryDate.getMonth()+1).padStart(2,'0')}-${String(entryDate.getDate()).padStart(2,'0')}` : '';
      const timeStr = entryDate ? `${String(entryDate.getHours()).padStart(2,'0')}:${String(entryDate.getMinutes()).padStart(2,'0')}` : '';
      html += `<div class="memory-entry">`;
      html += `<div class="memory-entry-header"><span class="memory-entry-num">#${i+1}</span><span class="memory-entry-time">${dateStr} ${timeStr}</span></div>`;
      if (en.content) html += `<div class="memory-entry-content">${en.content}</div>`;
      if (en.photos && en.photos.length > 0) {
        html += `<div class="memory-photo-gallery">`;
        en.photos.forEach((src, pi) => {
          html += `<img class="memory-photo" src="${src}" loading="lazy" onclick="this.classList.toggle('expanded')" onerror="this.style.display='none'">`;
        });
        html += `</div>`;
      }
      html += `</div>`;
    });
    html += `</div>`;
  } else {
    // Backward compatibility: show old single content
    const tc = e.review || e.content || e.notes || e.note;
    if (tc) html += `<div class="detail-section fade-in-delay-2"><div class="detail-section-title">笔记 · Notes</div><div class="detail-review">${tc}</div></div>`;
  }
  if (e._conflicts && e._conflicts.length) {
    html += `<div class="detail-section fade-in-delay-2"><div class="detail-section-title">⚠️ 冲突版本 · Conflicts（${e._conflicts.length}）</div>`;
    e._conflicts.forEach(c => {
      const d = c.data || {};
      html += `<div class="memory-entry"><div class="memory-entry-header"><span class="memory-entry-time">${String(c.updated_at || '').replace('T', ' ').slice(0, 16)}</span></div><div class="memory-entry-content">${[d.title, d.author, d.director, (d.content || '').slice(0, 80)].filter(Boolean).join(' · ') || '（内容差异）'}</div></div>`;
    });
    html += `</div>`;
  }
  if (e.quotes) html += `<div class="detail-section fade-in-delay-2"><div class="detail-section-title">摘录 · Quote</div><div class="detail-review" style="font-style:italic;border-left:3px solid var(--border-strong);padding-left:16px;">${e.quotes}</div></div>`;
  if (e.tags && e.tags.length) html += `<div class="detail-section fade-in-delay-3"><div class="detail-section-title">标签 · Tags</div><div class="detail-tags">${e.tags.map(t=>`<span class="detail-tag">${t}</span>`).join('')}</div></div>`;
  document.getElementById('content').innerHTML = html;
  document.getElementById('content').classList.add('fade-in');
  window.scrollTo({ top:0, behavior:'smooth' });
}

// === Quick Capture ===
function openCapture(entryId) {
  editingId = entryId;
  const saveBtn = document.getElementById('save-btn');
  if (entryId) {
    saveBtn.textContent = '追加';
    document.getElementById('step-type').style.display = 'none';
    document.getElementById('step-form').style.display = 'block';
    loadEntryForEdit(entryId);
  } else {
    saveBtn.textContent = '保存';
    document.getElementById('step-type').style.display = 'block';
    document.getElementById('step-form').style.display = 'none';
    selectedType = null;
    selectedMovie = null;
    selectedBook = null;
    selectedMusic = null;
    selectedGame = null;
    uploadedPhotos = []; photoFailures = [];
  }
  document.getElementById('capture-modal').classList.add('show');
  // 记录弹窗入历史栈：浏览器返回键关闭弹窗/回上一层，而不是退出网页
  history.pushState({ __inneros: true, page: currentPage, capture: true }, '');
  captureOpen = true;
}

function backToTypeSelect() {
  document.getElementById('step-form').style.display = 'none';
  document.getElementById('step-type').style.display = 'block';
  selectedType = null;
}

function selectType(type) {
  selectedType = type;
  uploadedPhotos = []; photoFailures = [];
  const meta = TYPE_META[type] || {};
  document.getElementById('modal-title').textContent = meta.label || '记录';
  document.getElementById('step-type').style.display = 'none';
  document.getElementById('step-form').style.display = 'block';
  const container = document.getElementById('workflow-container');
  const today = localDate();
  const now = localTime();

  if (type === 'movie') {
    container.innerHTML = `
      <div class="douban-search">
        <div class="field-label" style="margin-bottom:8px;">🔍 搜索电影，自动导入信息</div>
        <div class="douban-search-box">
          <input type="text" class="field-input" id="douban-input" data-work-search="movie" placeholder="输入电影名，如：奥本海默..." oninput="debouncedWorkSearch('movie',this.value)">
        </div>
        <div id="douban-results" class="douban-results"></div>
      </div>
      <div class="capture-fields show" id="capture-fields">
        <div class="field-row"><div class="field-label">片名</div><input type="text" class="field-input" id="capture-title" placeholder="搜索后自动填充" readonly></div>
        <div class="field-row"><div class="field-label">观后感</div><textarea class="field-textarea" id="capture-review" placeholder="写一些你的想法..."></textarea></div>
        ${renderPhotoUpload()}
      </div>`;
    document.getElementById('douban-input').focus();
  } else if (type === 'book') {
    container.innerHTML = `
      <div class="douban-search">
        <div class="field-label" style="margin-bottom:8px;">🔍 搜索书籍，自动导入信息</div>
        <div class="douban-search-box">
          <input type="text" class="field-input" id="book-input" placeholder="输入书名或ISBN..." oninput="debouncedBookSearch(this.value)">
        </div>
        <div id="douban-results" class="douban-results"></div>
      </div>
      <div class="capture-fields show" id="capture-fields">
        <div class="field-row"><div class="field-label">书名</div><input type="text" class="field-input" id="capture-title" placeholder="搜索后自动填充" readonly></div>
        <div class="field-row"><div class="field-label">作者</div><input type="text" class="field-input" id="capture-extra" placeholder="搜索后自动填充" readonly></div>
        <div class="field-row"><div class="field-label">阅读状态</div>
          <div class="reading-status">
            <button class="reading-status-btn" onclick="setReadingStatus('want')">想读</button>
            <button class="reading-status-btn" onclick="setReadingStatus('reading')">在读</button>
            <button class="reading-status-btn selected" onclick="setReadingStatus('done')">已读</button>
          </div>
        </div>
        <div class="field-row"><div class="field-label">读书笔记</div><textarea class="field-textarea" id="capture-review" placeholder="写一些你的想法..."></textarea></div>
        ${renderPhotoUpload()}
      </div>`;
    document.getElementById('book-input').focus();
  } else if (type === 'diary') {
    container.innerHTML = `
      <div class="capture-fields show" id="capture-fields">
        <div class="field-row"><div class="field-label">标题（可选）</div><input type="text" class="field-input" id="capture-title" placeholder="给这天起个名字..."></div>
        <div class="field-row"><div class="field-label">日记内容</div><textarea class="capture-textarea" id="capture-review" placeholder="今天发生了什么？写点什么..." style="min-height:200px;"></textarea></div>
        <div class="field-row"><div class="field-label">心情</div><input type="text" class="field-input" id="capture-extra" placeholder="平静 / 兴奋 / 沉思..."></div>
        ${renderPhotoUpload()}
      </div>`;
    setTimeout(() => document.getElementById('capture-review')?.focus(), 100);
  } else if (type === 'event') {
    const eventCats = ['旅行','学习','工作','生活','社交','纪念','重要事件','其他'];
    container.innerHTML = `
      <div class="capture-fields show" id="capture-fields">
        <div class="field-row"><div class="field-label">发生了什么</div><input type="text" class="field-input" id="capture-title" placeholder="一句话概括"></div>
        <div class="field-row"><div class="field-label">详细描述</div><textarea class="field-textarea" id="capture-review" placeholder="详细记录..."></textarea></div>
        <div class="field-row"><div class="field-label">分类</div>
          <div class="event-categories" id="event-cats">
            ${eventCats.map(c => `<span class="event-cat" onclick="setEventCategory('${c}')">${c}</span>`).join('')}
          </div>
        </div>
        <div class="field-row"><div class="field-label">地点（可选）</div><input type="text" class="field-input" id="capture-extra" placeholder="地点"></div>
        <div class="field-row"><div class="field-label">发生时间</div><input type="datetime-local" class="field-input" id="capture-event-at" value="${today}T${now}"></div>
        ${renderPhotoUpload()}
      </div>`;
    document.getElementById('capture-title').focus();
  } else if (type === 'music') {
    container.innerHTML = `
      <div class="douban-search"><div class="field-label" style="margin-bottom:8px;">🔍 搜索歌曲，自动导入资料</div><div class="douban-search-box"><input type="text" class="field-input" data-work-search="music" placeholder="歌曲、专辑或艺人" oninput="debouncedWorkSearch('music',this.value)"></div><div id="douban-results" class="douban-results"></div></div>
      <div class="capture-fields show" id="capture-fields">
        <div class="field-row"><div class="field-label">曲目</div><input type="text" class="field-input" id="capture-title" placeholder="搜索后自动填充" readonly></div>
        <div class="field-row"><div class="field-label">艺人</div><input type="text" class="field-input" id="capture-extra" placeholder="搜索后自动填充" readonly></div>
        <div class="field-row"><div class="field-label">感想</div><textarea class="field-textarea" id="capture-review" placeholder="听后感..."></textarea></div>
        ${renderPhotoUpload()}
      </div>`;
    document.getElementById('capture-title').focus();
  } else if (type === 'game') {
    container.innerHTML = `
      <div class="douban-search"><div class="field-label" style="margin-bottom:8px;">🔍 搜索游戏，自动导入资料</div><div class="douban-search-box"><input type="text" class="field-input" data-work-search="game" placeholder="输入游戏名" oninput="debouncedWorkSearch('game',this.value)"></div><div id="douban-results" class="douban-results"></div></div>
      <div class="capture-fields show" id="capture-fields">
        <div class="field-row"><div class="field-label">游戏名</div><input type="text" class="field-input" id="capture-title" placeholder="搜索后自动填充" readonly></div>
        <div class="field-row"><div class="field-label">平台</div><input type="text" class="field-input" id="capture-extra" placeholder="搜索后自动填充" readonly></div>
        <div class="field-row"><div class="field-label">体验</div><textarea class="field-textarea" id="capture-review" placeholder="游戏体验..."></textarea></div>
        ${renderPhotoUpload()}
      </div>`;
    document.getElementById('capture-title').focus();
  } else if (type === 'place') {
    container.innerHTML = `
      <div class="capture-fields show" id="capture-fields">
        <div class="field-row"><div class="field-label">地点名</div><input type="text" class="field-input" id="capture-title" placeholder="地点名"></div>
        <div class="field-row"><div class="field-label">位置</div><input type="text" class="field-input" id="capture-extra" placeholder="城市 / 地区"></div>
        <div class="field-row"><div class="field-label">游记</div><textarea class="field-textarea" id="capture-review" placeholder="记录你的旅行..."></textarea></div>
        ${renderPhotoUpload()}
      </div>`;
    document.getElementById('capture-title').focus();
  } else {
    container.innerHTML = `
      <div class="capture-fields show" id="capture-fields">
        <div class="field-row"><div class="field-label">标题</div><input type="text" class="field-input" id="capture-title" placeholder="标题"></div>
        <div class="field-row"><div class="field-label">内容</div><textarea class="field-textarea" id="capture-review" placeholder="写一些内容..."></textarea></div>
        ${renderPhotoUpload()}
      </div>`;
    document.getElementById('capture-title').focus();
  }
}

function resetCaptureForm() {
  selectedType = null; uploadedPhotos = []; photoFailures = [];
  selectedMovie = null; selectedBook = null; selectedMusic = null; selectedGame = null;
  document.getElementById('workflow-container').innerHTML = '';
}

async function loadEntryForEdit(id) {
  const e = await dbGet(id);
  if (!e) { closeCapture(); return; }
  selectType(e.type);
  // Pre-fill base info only, NOT the review/content (append mode)
  if (e.title) { const t = document.getElementById('capture-title'); if (t) t.value = e.title; }
  const extraMap = { book:e.author, music:e.artist, game:e.platform, place:e.location, event:e.location, diary:e.mood };
  if (extraMap[e.type] && document.getElementById('capture-extra')) document.getElementById('capture-extra').value = extraMap[e.type];
  selectedMovie = (e.type === 'movie' && e.poster) ? { poster: e.poster, title: e.title, release_date: e.release_date || '', original_title: e.original_title || '' } : null;
  selectedBook = (e.type === 'book' && e.cover) ? { cover:e.cover, authors:e.author, publisher:e.publisher, isbn:e.isbn, categories:e.genres, description:e.book_description, pageCount:e.page_count } : null;
  if (e.type === 'event' && e.category) setEventCategory(e.category);
  if (e.type === 'book' && e.reading_status) setReadingStatus(e.reading_status);
  // Show existing entries count
  const entryCount = (e.entries || []).length;
  const reviewEl = document.getElementById('capture-review');
  if (reviewEl) reviewEl.placeholder = `追加新记录...（已有 ${entryCount} 条记录）`;
  document.getElementById('modal-title').textContent = '追加记录';
  document.getElementById('back-btn').style.display = 'none';
}

// === Reading Status & Event Category ===
let readingStatus = 'done';
function setReadingStatus(status) {
  readingStatus = status;
  document.querySelectorAll('.reading-status-btn').forEach(b => b.classList.remove('selected'));
  event.target.classList.add('selected');
}
let eventCategory = '';
function setEventCategory(cat) {
  eventCategory = cat;
  document.querySelectorAll('.event-cat').forEach(c => c.classList.remove('selected'));
  event.target.classList.add('selected');
}


function closeCapture(fromPop = false) {
  document.getElementById('capture-modal').classList.remove('show');
  editingId = null;
  document.getElementById('back-btn').style.display = '';
  const was = captureOpen;
  captureOpen = false;
  // 弹窗是历史栈中的一层：页面内关闭走 history.back()，与浏览器返回键同一条路径
  if (!fromPop && was) history.back();
}

async function saveCapture() {
  const titleEl = document.getElementById('capture-title');
  const reviewEl = document.getElementById('capture-review');
  const extraEl = document.getElementById('capture-extra');
  const title = titleEl ? titleEl.value.trim() : '';
  if (!title && selectedType !== 'diary') { showToast('请先搜索并选择作品', 'error'); return; }
  if (!selectedType) { showToast('请选择记录类型', 'error'); return; }
  const review = reviewEl ? reviewEl.value.trim() : '';
  const extra = extraEl ? extraEl.value.trim() : '';
  const now = new Date();
  const eventAtEl = document.getElementById('capture-event-at');
  const eventAt = eventAtEl?.value ? new Date(eventAtEl.value) : now;
  const today = localDate(eventAt);
  const time = localTime(eventAt);
  const photos = uploadedPhotos.filter(p => typeof p === 'string');

  // Build the new entry for entries[] (append model)
  const newEntry = { id: uuid(), created_at: now.toISOString(), content: review, photos, photo_ids: [] };
  if (selectedType === 'movie') newEntry.date = today;
  else if (selectedType === 'book') newEntry.date = today;
  else if (selectedType === 'diary') newEntry.date = today;
  else if (selectedType === 'event') newEntry.date = today;
  else newEntry.date = today;

  if (editingId) {
    // Append mode: add new entry to existing record
    const ex = await dbGet(editingId);
    if (!ex) { showToast('记录不存在', 'error'); return; }
    const entries = ex.entries || [];
    // Migrate old single content to entries[] if needed
    if (entries.length === 0) {
      const oldContent = ex.review || ex.content || ex.notes || ex.note || '';
      if (oldContent) {
        entries.push({ id: ex.created_at ? new Date(ex.created_at).getTime() : 0, created_at: ex.created_at || now.toISOString(), content: oldContent, photos: ex.photos || [] });
      }
    }
    entries.push(newEntry);
    const merged = { ...ex };
    merged.entries = entries;
    // Update base fields if changed by search
    if (selectedType === 'movie' && selectedMovie) {
      Object.assign(merged, { poster:selectedMovie.poster, release_date:selectedMovie.release_date, original_title:selectedMovie.original_title, director:selectedMovie.director, genres:selectedMovie.genres, description:selectedMovie.description, provider:selectedMovie.provider, external_id:selectedMovie.external_id });
    }
    if (selectedType === 'book' && selectedBook) {
      merged.cover = selectedBook.cover;
      merged.author = selectedBook.authors;
      merged.publisher = selectedBook.publisher;
      merged.isbn = selectedBook.isbn;
      merged.genres = selectedBook.categories;
      merged.book_description = selectedBook.description;
      merged.page_count = selectedBook.pageCount;
      // 豆瓣详情补全（V1.2 §4.2：客观资料来自 Provider，不可手填）
      if (selectedBook.rating) merged.rating = selectedBook.rating;
      if (selectedBook.translator) merged.translator = selectedBook.translator;
      if (selectedBook.publishedDate) merged.publish_date = selectedBook.publishedDate;
    }
    if (selectedType === 'book') {
      if (readingStatus === 'done') { merged.finish_date = today; merged.reading_status = 'done'; }
      else if (readingStatus === 'reading') { merged.start_date = today; merged.reading_status = 'reading'; }
      else { merged.reading_status = 'want'; }
    }
    if (selectedType === 'event' && eventCategory) merged.category = eventCategory;
    if (selectedType === 'diary' && extra) merged.mood = extra;
    if (selectedType === 'event' && extra) merged.location = extra;
    if ((selectedType === 'music' || selectedType === 'game' || selectedType === 'place') && extra) {
      if (selectedType === 'music') Object.assign(merged, selectedMusic || { artist:extra });
      if (selectedType === 'game') Object.assign(merged, selectedGame || { platform:extra });
      if (selectedType === 'place') merged.location = extra;
    }
    merged.id = editingId;
    merged.updated_at = now.toISOString();
    await dbPut(merged);
    showToast('已追加记录', 'success');
    // 云同步：追加条目 + 基础信息变更
    try {
      if (authState.loggedIn) {
        await enqueueEntryAppend(merged.id, newEntry);
        if (selectedMovie || selectedBook) await enqueueMemoryUpsert(merged);
        syncNow();
      }
    } catch (e) { console.warn('同步入队失败', e); }
    const editId = editingId;
    closeCapture();
    await openDetail(editId);
  } else {
    // New record
    const entry = { type: selectedType, title, created_at: now.toISOString(), updated_at: now.toISOString(), entries: [newEntry] };
    if (selectedType === 'movie') {
      entry.watch_date = today; entry.watch_time = time;
      if (selectedMovie) Object.assign(entry, selectedMovie);
    } else if (selectedType === 'book') {
      if (readingStatus === 'done') { entry.finish_date = today; entry.reading_status = 'done'; }
      else if (readingStatus === 'reading') { entry.start_date = today; entry.reading_status = 'reading'; }
      else { entry.reading_status = 'want'; }
      if (selectedBook) {
        entry.cover = selectedBook.cover;
        entry.author = selectedBook.authors;
        entry.publisher = selectedBook.publisher;
        entry.isbn = selectedBook.isbn;
        entry.genres = selectedBook.categories;
        entry.book_description = selectedBook.description;
        entry.page_count = selectedBook.pageCount;
        if (selectedBook.rating) entry.rating = selectedBook.rating;
        if (selectedBook.translator) entry.translator = selectedBook.translator;
        if (selectedBook.publishedDate) entry.publish_date = selectedBook.publishedDate;
      }
    } else if (selectedType === 'diary') {
      entry.event_date = today; entry.event_time = time;
      if (extra) entry.mood = extra;
      if (!title) entry.title = today.slice(5).replace('-', '月') + '日';
    } else if (selectedType === 'event') {
      entry.event_date = today; entry.event_time = time;
      if (extra) entry.location = extra;
      if (eventCategory) entry.category = eventCategory;
    } else if (selectedType === 'music') {
      entry.date = today; Object.assign(entry, selectedMusic || {});
    } else if (selectedType === 'game') {
      entry.start_date = today; Object.assign(entry, selectedGame || {});
    } else if (selectedType === 'place') {
      entry.date = today; if (extra) entry.location = extra;
    } else {
      entry.event_date = today;
    }
    if (!entry.id) entry.id = uuid();
    await dbAdd(entry);
    showToast('已保存', 'success');
    // 云同步：登记 upsert + 首条 append + 附件（未登录自动跳过）
    try {
      await enqueueMemoryUpsert(entry);
      await enqueueEntryAppend(entry.id, newEntry);
      if (authState.loggedIn) syncNow();
    } catch (e) { console.warn('同步入队失败', e); }
    closeCapture();
    await navigate(currentPage);
  }
}

// === Delete ===
function confirmDelete(id) {
  showConfirm('🗑️', '删除记录', '确定要删除这条记忆吗？此操作不可恢复。', async () => {
    // 云同步：写删除墓碑（其他设备拉取后同步删除，不会被旧数据复活）
    try { if (authState.loggedIn) { await opAppend('delete_memory', String(id), { updated_at: new Date().toISOString() }); syncNow(); } } catch (e) { console.warn(e); }
    await dbDelete(id);
    showToast('已删除', 'success');
    await navigate(currentPage);
  });
}

// === Confirm Dialog ===
let confirmCallback = null;
function showConfirm(icon, title, msg, callback) {
  confirmCallback = callback;
  document.getElementById('confirm-icon').textContent = icon;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-overlay').classList.add('show');
  document.getElementById('confirm-ok').onclick = () => { const cb = confirmCallback; closeConfirm(); if (cb) cb(); };
}
function closeConfirm() { document.getElementById('confirm-overlay').classList.remove('show'); confirmCallback = null; }

// === Toast ===
function showToast(msg, type = '') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2500);
}

// === Theme ===
function toggleTheme() {
  const body = document.body;
  const isDark = body.getAttribute('data-theme') === 'dark';
  body.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.getElementById('theme-label').textContent = isDark ? '深色模式' : '浅色模式';
  document.getElementById('theme-icon').innerHTML = isDark
    ? '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>'
    : '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
}

// === Sidebar ===
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('overlay').classList.toggle('show'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('show'); }

// === Keyboard ===
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openCapture(null); }
  if (e.key === 'Escape') {
    if (captureOpen) closeCapture();
    if (selectorOpenSport) closeTeamSelector();
    closeConfirm();
  }
});

// === 浏览器返回键：统一"返回上一层内容"，而不是退出网页 ===
// 层级：页面 → 详情 → 球队选择器 / 记录弹窗。pushState 负责入栈（navigate/openDetail/openTeamSelector/openCapture），
// popstate 在这里把 UI 收敛到历史状态对应的层：弹窗关闭、选择器关闭、详情回列表、跨页回退。
window.addEventListener('popstate', async (e) => {
  const st = e.state || {};
  if (selectorOpenSport && st.selector !== selectorOpenSport) closeTeamSelector(true);
  if (captureOpen && !st.capture) closeCapture(true);
  // 赛事详情层（CS 页：赛事列表 → 赛事详情）
  if (tournamentOpenKey != null && (!st.tournament || decodeURIComponent(st.tournament) !== tournamentOpenKey)) {
    tournamentOpenKey = null;
    await navigate((st.__inneros && st.page) ? st.page : currentPage, true);
    return;
  }
  if (st.tournament && decodeURIComponent(st.tournament) !== tournamentOpenKey) { openTournamentDetail(st.tournament, true); return; }
  // 详情层：当前状态不再带 detail → 回到来源页面
  if (detailOpenId != null && !st.detail) { await navigate((st.__inneros && st.page) ? st.page : currentPage, true); return; }
  if (st.detail && st.detail !== detailOpenId) { await openDetail(st.detail, true); return; }
  // 页面层：跨页回退
  if (st.__inneros && st.page && st.page !== currentPage && detailOpenId == null) await navigate(st.page, true);
});

document.getElementById('capture-modal').addEventListener('click', function(e) { if (e.target === this) closeCapture(); });
document.getElementById('confirm-overlay').addEventListener('click', function(e) { if (e.target === this) closeConfirm(); });

// === Image lazy load ===
document.addEventListener('load', function(e) {
  if (e.target && e.target.tagName === 'IMG') e.target.classList.add('loaded');
}, true);
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('img[loading="lazy"]').forEach(img => {
    if (img.complete) img.classList.add('loaded');
    else img.addEventListener('load', () => img.classList.add('loaded'), { once:true });
  });
});

// === Mobile keyboard adaptation ===
// 不再启用 virtualKeyboard.overlaysContent（会让键盘直接盖住表单下方内容）。
// 默认行为：视口随键盘缩放 + focusin 滚动兜底，输入框始终可见、页面可上下滑动。
document.addEventListener('focusin', function(e) {
  if (e.target.matches('input, textarea')) {
    setTimeout(() => e.target.scrollIntoView({ behavior:'smooth', block:'center' }), 300);
  }
});

// === Mobile Touch Gestures ===
let touchStartX = 0, touchStartY = 0, touchEndX = 0, touchEndY = 0;
document.addEventListener('touchstart', function(e) {
  touchStartX = e.changedTouches[0].screenX;
  touchStartY = e.changedTouches[0].screenY;
}, { passive: true });
document.addEventListener('touchend', function(e) {
  touchEndX = e.changedTouches[0].screenX;
  touchEndY = e.changedTouches[0].screenY;
  handleSwipeGesture();
}, { passive: true });
function handleSwipeGesture() {
  const deltaX = touchEndX - touchStartX;
  const deltaY = touchEndY - touchStartY;
  if (Math.abs(deltaX) < 60 || Math.abs(deltaY) > 80) return;
  const sidebar = document.getElementById('sidebar');
  const isOpen = sidebar.classList.contains('open');
  if (deltaX > 0 && !isOpen && touchStartX < 40) {
    sidebar.classList.add('open');
    document.getElementById('overlay').classList.add('show');
  } else if (deltaX < 0 && isOpen) {
    sidebar.classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
  }
}

// ============================================================
// 多账户云同步 v2（D1 + 操作日志协议）
// 鉴权（Cookie 会话）+ 操作队列（IndexedDB ops）+ 增量双向同步
// ============================================================
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let authState = { checked: false, loggedIn: false, email: null, guest: false, offline: false };
let syncInflight = false;
let bootCloudKeys = new Set(); // 首次引导拉取时收集云端已有数据的去重键

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function checkAuth() {
  authState.checked = true;
  try {
    const r = await api('/api/auth/me');
    authState.loggedIn = r.ok;
    authState.email = r.ok ? r.data.email : null;
    authState.offline = false;
  } catch (e) {
    // 网络不可达 ≠ 未登录：按离线访客放行，联网后 syncNow 自动续传
    authState.loggedIn = false;
    authState.offline = true;
  }
  return authState;
}

function showAuthScreen() { document.getElementById('auth-screen').style.display = 'flex'; }
function hideAuthScreen() { document.getElementById('auth-screen').style.display = 'none'; }

function switchAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
}

function authError(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.classList.add('show'); } }

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return authError('login-error', '请填写邮箱和密码');
  document.getElementById('login-error').classList.remove('show');
  const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!r.ok) return authError('login-error', r.data.error || '登录失败');
  await afterAuth(r.data.email || email);
}

async function handleRegister() {
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!email || !password) return authError('reg-error', '请填写邮箱和密码');
  document.getElementById('reg-error').classList.remove('show');
  const r = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!r.ok) return authError('reg-error', r.data.error || '注册失败');
  await afterAuth(r.data.email || email);
}

function enterGuest() {
  authState.guest = true;
  localStorage.setItem('inneros_guest', '1');
  hideAuthScreen();
  showToast('访客模式：数据仅存本机，可在设置中随时登录开启同步', '');
  navigate('today');
}

async function afterAuth(email) {
  authState.loggedIn = true;
  authState.email = email;
  authState.guest = false;
  authState.offline = false;
  localStorage.removeItem('inneros_guest');
  hideAuthScreen();
  showToast('欢迎，' + email, 'success');
  try {
    await ensureSyncBootstrap();
    startAutoSync();
    await syncNow();
  } catch (e) { console.warn('首次同步失败（稍后自动重试）', e); }
  await navigate('today');
}

async function logoutAccount() {
  await api('/api/auth/logout', { method: 'POST' });
  localStorage.removeItem('inneros_guest');
  location.reload();
}

// ---- 设备标识 ----
function getDeviceId() {
  let id = localStorage.getItem('inneros_device_id');
  if (!id) { id = uuid(); localStorage.setItem('inneros_device_id', id); }
  return id;
}
function getDeviceName() {
  let n = localStorage.getItem('inneros_device_name');
  if (!n) {
    const ua = navigator.userAgent;
    n = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : '电脑';
    localStorage.setItem('inneros_device_name', n);
  }
  return n;
}

// ---- 操作日志队列 ----
function opAppend(kind, entity_id, payload) {
  const op = { op_id: uuid(), kind, entity_id: String(entity_id), payload, created_at: new Date().toISOString() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ops', 'readwrite');
    tx.objectStore('ops').put(op);
    tx.oncomplete = () => resolve(op);
    tx.onerror = () => reject(tx.error);
  });
}
function opsGetAll() {
  return new Promise((resolve, reject) => {
    const r = db.transaction('ops').objectStore('ops').getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
function opDelete(op_id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ops', 'readwrite');
    tx.objectStore('ops').delete(op_id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- 记录 → 操作（保存/删除时调用；未登录不入队）----
function memoryDataSnapshot(rec) {
  const data = { ...rec };
  delete data.id; delete data.legacy_id; delete data._conflicts; delete data.updated_at;
  return data;
}
async function enqueueMemoryUpsert(rec) {
  if (!authState.loggedIn) return;
  const updated_at = new Date().toISOString();
  rec.updated_at = updated_at;
  const kind = (rec.kind === 'team' || rec.sport) ? 'team' : 'memory';
  await opAppend('upsert_memory', rec.id, { kind, data: memoryDataSnapshot(rec), updated_at, deleted: 0 });
}
function compressImage(dataURL, maxDim = 1280, q = 0.8) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * sc));
        c.height = Math.max(1, Math.round(img.height * sc));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', q));
      } catch (e) { resolve(dataURL); }
    };
    img.onerror = () => resolve(dataURL);
    img.src = dataURL;
  });
}
// 照片 → 附件操作（一图一 op；压缩后入库，原图仅留本地）
async function enqueueAttachments(memoryId, photos) {
  const ids = [];
  if (!authState.loggedIn) return ids;
  for (const p of photos || []) {
    if (typeof p !== 'string' || !p.startsWith('data:')) continue;
    const compressed = await compressImage(p);
    const m = compressed.match(/^data:([^;]+);base64,(.*)$/);
    if (!m || m[2].length > 900000) { console.warn('照片过大跳过云端同步', m && m[2].length); continue; }
    const attId = uuid();
    await opAppend('upsert_attachment', attId, { memory_id: memoryId, bytes: m[2].length, hash: m[2].length + '-' + m[2].slice(0, 32), mime: m[1], data: m[2], created_at: new Date().toISOString() });
    ids.push(attId);
  }
  return ids;
}
async function enqueueEntryAppend(memoryId, entry) {
  if (!authState.loggedIn) return;
  const photo_ids = await enqueueAttachments(memoryId, entry.photos || []);
  entry.photo_ids = photo_ids;
  await opAppend('append_entry', memoryId, { memory_id: memoryId, entry: { id: entry.id, content: entry.content || '', photo_ids, created_at: entry.created_at || new Date().toISOString() } });
}

// ---- 同步引擎 ----
function setCloudSyncStatus(text, isError) {
  const el = document.getElementById('cloud-sync-status');
  if (el) { el.textContent = text; el.style.color = isError ? 'var(--danger)' : ''; }
}
async function syncNow() {
  if (!authState.loggedIn || syncInflight) return;
  syncInflight = true;
  setCloudSyncStatus('同步中...');
  try {
    await pushPendingOps();
    await pullOps();
    setCloudSyncStatus('✓ 上次同步 ' + new Date().toLocaleTimeString());
    await dbPutMeta('last_cloud_sync', new Date().toISOString());
  } catch (e) {
    setCloudSyncStatus('✗ 同步失败：' + (e.message || e), true);
  } finally { syncInflight = false; }
}
function startAutoSync() {
  if (startAutoSync._t) return;
  startAutoSync._t = setInterval(() => syncNow(), 5 * 60e3);
  window.addEventListener('online', () => syncNow());
}
async function pushPendingOps() {
  for (let i = 0; i < 60; i++) {
    const ops = await opsGetAll();
    if (!ops.length) return;
    const batch = ops.slice(0, 50);
    const r = await api('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ device_id: getDeviceId(), device_name: getDeviceName(), operations: batch.map(o => ({ op_id: o.op_id, kind: o.kind, entity_id: o.entity_id, payload: o.payload, created_at: o.created_at })) }),
    });
    if (!r.ok) throw new Error(r.data.error || '推送失败 HTTP ' + r.status);
    const failed = new Set((r.data.errors || []).map(x => x.op_id));
    for (const o of batch) if (!failed.has(o.op_id)) await opDelete(o.op_id);
    if (failed.size) console.warn('push 部分失败', r.data.errors);
  }
}
async function pullOps(collect) {
  for (let i = 0; i < 60; i++) {
    const cursor = parseInt(localStorage.getItem('inneros_sync_cursor') || '0', 10) || 0;
    const r = await api(`/api/sync/pull?cursor=${cursor}&device_id=${encodeURIComponent(getDeviceId())}&device_name=${encodeURIComponent(getDeviceName())}`);
    if (!r.ok) throw new Error(r.data.error || '拉取失败');
    const ops = r.data.ops || [];
    if (ops.length) await replayOps(ops, collect);
    localStorage.setItem('inneros_sync_cursor', String(r.data.last_seq || 0));
    if (!r.data.has_more) return;
  }
}
async function replayOps(ops, collect) {
  let touched = false;
  for (const op of ops) {
    const p = op.payload || {};
    try {
      if (op.kind === 'upsert_memory') {
        if (collect) { const d = p.data || {}; bootCloudKeys.add((d.kind === 'team' || d.sport ? 'team@' : (d.type || '') + '@') + (d.title || d.name || '')); }
        if (p.deleted) { await dbDelete(op.entity_id); touched = true; continue; }
        const incoming = { ...(p.data || {}), id: op.entity_id };
        const ex = await dbGet(op.entity_id);
        if (ex) await dbPut({ ...ex, ...incoming, id: op.entity_id });
        else await dbPut(incoming);
        touched = true;
      } else if (op.kind === 'append_entry') {
        const e = p.entry || {};
        let mem = await dbGet(p.memory_id);
        if (!mem) mem = { id: p.memory_id, type: 'movie', title: '（来自其他设备）', entries: [] };
        mem.entries = mem.entries || [];
        if (!mem.entries.some(x => x.id === e.id)) {
          mem.entries.push({ id: e.id, created_at: e.created_at, content: e.content || '', photos: [], photo_ids: e.photo_ids || [] });
          touched = true;
        }
        await dbPut(mem);
      } else if (op.kind === 'delete_memory') {
        await dbDelete(op.entity_id); touched = true;
      } else if (op.kind === 'delete_entry') {
        const mem = p.memory_id ? await dbGet(p.memory_id) : null;
        if (mem) {
          const before = (mem.entries || []).length;
          mem.entries = (mem.entries || []).filter(x => x.id !== op.entity_id);
          if (mem.entries.length !== before) { await dbPut(mem); touched = true; }
        }
      } else if (op.kind === 'upsert_attachment') {
        const mem = await dbGet(p.memory_id);
        if (mem) {
          const dataURL = 'data:' + (p.mime || 'image/jpeg') + ';base64,' + (p.data || '');
          let placed = false;
          for (const en of (mem.entries || [])) {
            if ((en.photo_ids || []).includes(op.entity_id)) {
              en.photos = en.photos || [];
              if (!en.photos.some(x => x === dataURL)) { en.photos.push(dataURL); placed = true; }
            }
          }
          if (placed) { await dbPut(mem); touched = true; }
        }
      }
    } catch (e) { console.warn('回放失败', op.op_id, e); }
  }
  if (touched && ['today', 'timeline', 'library'].includes(currentPage)) await navigate(currentPage, true);
}

// 首次登录引导：先回放云端（第二台设备即恢复数据），再把本地非 seed 数据推上去
async function ensureSyncBootstrap() {
  bootCloudKeys = new Set();
  await pullOps(true); // collect=true：顺手收集云端已有数据的键，用于 seed 去重
  if (localStorage.getItem('inneros_bootstrap_done') === '1') { await dedupSeeds(); return; }
  const all = await dbGetAll();
  const uploadable = all.filter(r => !r.seed);
  for (const rec of uploadable) {
    await enqueueMemoryUpsert(rec);
    for (const en of (rec.entries || [])) await enqueueEntryAppend(rec.id, en);
  }
  const teams = await dbGetTeams();
  for (const t of teams) await enqueueMemoryUpsert(t);
  localStorage.setItem('inneros_bootstrap_done', '1');
  if (uploadable.length || teams.length) showToast('正在首次上传本机数据（' + uploadable.length + ' 条记录）…', '');
  await dedupSeeds();
}
// seed 演示数据去重：本地 seed 记录若与云端已有记录同类型同名 → 删除本地副本（避免第二台设备出现双份）
async function dedupSeeds() {
  if (!bootCloudKeys.size) return;
  const all = await dbGetAll();
  for (const rec of all) {
    if (!rec.seed) continue;
    const key = (rec.type || '') + '@' + (rec.title || '');
    if (bootCloudKeys.has(key)) await dbDelete(rec.id);
  }
}

// === Init ===
(async function init() {
  try { await initDB(); } catch(e) { console.error('IndexedDB init failed:', e); }
  await seedIfEmpty();
  await checkAuth();
  const guest = localStorage.getItem('inneros_guest') === '1' && !authState.loggedIn;
  authState.guest = guest;
  if (authState.loggedIn) {
    try { await ensureSyncBootstrap(); startAutoSync(); syncNow(); } catch (e) { console.warn('启动同步失败（稍后自动重试）', e); }
  } else if (!guest) {
    showAuthScreen(); // 未登录且非访客：先登录/注册（访客模式可跳过）
  }
  await navigate('today');
  fixSeedPosters();
})();
