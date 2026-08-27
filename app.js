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
  place:  { emoji:'📍', label:'地点', color:'var(--c-place)' },
  event:  { emoji:'✦', label:'事件', color:'var(--c-event)' },
  photo:  { emoji:'📷', label:'照片', color:'var(--c-photo)' },
  diary:  { emoji:'📝', label:'日记', color:'var(--c-event)' },
};

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
  const isDouban = url.includes('doubanio.com') || url.includes('douban.com');
  const proxies = isDouban
    ? [`/img?url=${encodeURIComponent(url)}`]
    : [
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

// === Douban API ===
let doubanSearchTimer = null;
let doubanSelectedMovie = null;

async function searchDoubanMovieRaw(query) {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data)) return data;
  } catch(e) {}
  return [];
}

async function searchDoubanMovie(query) {
  if (!query || query.trim().length < 1) { renderDoubanResults([]); return; }
  const resultsEl = document.getElementById('douban-results');
  if (resultsEl) resultsEl.innerHTML = '<div class="douban-loading">搜索中...</div>';
  const data = await searchDoubanMovieRaw(query);
  renderDoubanResults(data);
}

function debouncedDoubanSearch(val) {
  clearTimeout(doubanSearchTimer);
  doubanSearchTimer = setTimeout(() => searchDoubanMovie(val), 400);
}

function renderDoubanResults(results) {
  const el = document.getElementById('douban-results');
  if (!el) return;
  if (!results || results.length === 0) {
    el.innerHTML = '<div class="douban-loading">没有找到相关电影</div>';
    return;
  }
  el.innerHTML = results.map((r, i) => `
    <div class="douban-result-item" onclick="selectDoubanMovie(${i})">
      <img src="${proxyImage(r.img)}" alt="${r.title}" loading="lazy" onerror="this.style.display='none'">
      <div class="douban-result-info">
        <div class="douban-result-title">${r.title}</div>
        <div class="douban-result-year">${r.year || ''} ${r.sub_title ? '· ' + r.sub_title : ''}</div>
        <div class="douban-source-badge">来源：豆瓣电影</div>
      </div>
    </div>
  `).join('');
  window._doubanResults = results;
}

async function selectDoubanMovie(idx) {
  const r = window._doubanResults && window._doubanResults[idx];
  if (!r) return;
  doubanSelectedMovie = { ...r };
  selectType('movie');
  document.getElementById('capture-title').value = r.title;
  document.getElementById('capture-date').value = new Date().toISOString().slice(0,10);
  document.querySelectorAll('.douban-result-item').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
  showToast('正在下载海报...', 'success');
  const dataUrl = await downloadImageAsDataURL(r.img);
  if (dataUrl) {
    doubanSelectedMovie.img = dataUrl;
    showToast('已导入：' + r.title + '，海报已缓存，可直接保存', 'success');
  } else {
    doubanSelectedMovie.img = r.img;
    showToast('已导入：' + r.title + '（海报加载失败，将使用备用显示）', 'success');
  }
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
        const results = await searchDoubanMovieRaw(entry.title);
        if (results && results.length > 0) {
          const match = results.find(r => r.title.includes(entry.title)) || results[0];
          if (match.year && !entry.release_date) entry.release_date = match.year;
          if (match.sub_title && !entry.original_title) entry.original_title = match.sub_title;
          dataUrl = await downloadImageAsDataURL(match.img);
        }
      } else {
        dataUrl = await downloadImageAsDataURL(imgUrl);
        if (!dataUrl && entry.type === 'movie' && entry.title) {
          const results = await searchDoubanMovieRaw(entry.title);
          if (results && results.length > 0) {
            const match = results.find(r => r.title.includes(entry.title)) || results[0];
            if (match.year && !entry.release_date) entry.release_date = match.year;
            if (match.sub_title && !entry.original_title) entry.original_title = match.sub_title;
            dataUrl = await downloadImageAsDataURL(match.img);
          }
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
let selectedRating = 0;
let editingId = null;
let activeFilters = new Set(['all']);
let activeScale = 'month';

// === IndexedDB ===
const DB_NAME = 'memory_os';
const DB_VERSION = 1;
let db = null;

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
    };
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

// === Seed ===
async function seedIfEmpty() {
  if (localStorage.getItem('memory_os_seeded') === '1') return;
  const all = await dbGetAll();
  if (all.length === 0) {
    for (const entry of SEED_ENTRIES) {
      await dbAdd({ ...entry, created_at:new Date().toISOString(), updated_at:new Date().toISOString() });
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
  return `<div class="poster-img" style="background:linear-gradient(135deg,${c1},${c2})">${inner}${entry.rating ? `<div class="poster-rating">★ ${entry.rating}.0</div>`:''}</div>`;
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

async function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  // Auto-expand the parent group when navigating to a sub-item
  const groupMap = {
    today:'memory', timeline:'memory', library:'memory', search:'memory',
    onthisday:'memory', random:'memory',
    'res-cs':'resources', 'res-football':'resources', 'res-ai':'resources', 'res-links':'resources'
  };
  if (groupMap[page]) {
    const grp = document.getElementById(`nav-group-${groupMap[page]}`);
    if (grp && !grp.classList.contains('open')) grp.classList.add('open');
  }

  const content = document.getElementById('content');
  content.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-tertiary);">加载中...</div>';
  content.classList.remove('fade-in');
  void content.offsetWidth;
  content.classList.add('fade-in');
  switch(page) {
    case 'today': await renderToday(); break;
    case 'timeline': await renderTimeline(); break;
    case 'library': await renderLibrary('movie'); break;
    case 'search': renderSearch(); break;
    case 'onthisday': await renderOnThisDay(); break;
    case 'random': await renderRandom(); break;
    case 'settings': await renderSettings(); break;
    case 'res-cs': renderResourceCS(); break;
    case 'res-football': renderResourceFootball(); break;
    case 'res-ai': renderResourceAI(); break;
    case 'res-links': renderResourceLinks(); break;
    case 'knowledge': renderKnowledge(); break;
    case 'ai-assistant': renderAIAssistant(); break;
  }
  closeSidebar();
}

// === Resources: CS Esports ===
function renderResourceCS() {
  const majorEvents = [
    { name:'IEM Cologne 2026', teams:'NAVI vs G2', date:'2026.08.30', prize:'$1,000,000', status:'即将开始', url:'https://www.hltv.org/events' },
  ];
  const links = [
    { title:'HLTV', url:'https://www.hltv.org', icon:'🏆', desc:'CS2赛事排名、比赛日程、选手数据' },
    { title:'Liquipedia CS', url:'https://liquipedia.net/counterstrike', icon:'📖', desc:'CS赛事百科、战队信息、选手资料' },
    { title:'FACEIT', url:'https://www.faceit.com', icon:'🎮', desc:'CS2竞技平台，排位赛和锦标赛' },
    { title:'ESL Play', url:'https://play.esl.com', icon:'⚡', desc:'ESL联赛报名和比赛管理' },
  ];
  let html = `
    <div class="page-header">
      <div class="page-title">CS赛事 · CS Esports</div>
      <div class="scale-switcher">
        <button class="scale-btn active" onclick="window.open('https://www.hltv.org/matches','_blank')">今日比赛</button>
        <button class="scale-btn" onclick="window.open('https://www.hltv.org/events','_blank')">赛事列表</button>
        <button class="scale-btn" onclick="window.open('https://www.hltv.org/ranking/teams','_blank')">战队排名</button>
      </div>
    </div>`;
  majorEvents.forEach(m => {
    const [t1, t2] = m.teams.split(' vs ');
    html += `
    <div class="featured-match" onclick="window.open('${m.url}','_blank')">
      <div class="featured-match-tag">🔥 ${m.status} · ${m.prize}</div>
      <div class="featured-match-title">${m.name}</div>
      <div class="featured-match-teams">
        <div class="featured-team">
          <div class="featured-team-logo">🇺🇦</div>
          <div class="featured-team-name">${t1}</div>
        </div>
        <div class="featured-vs">VS</div>
        <div class="featured-team">
          <div class="featured-team-logo">🇩🇪</div>
          <div class="featured-team-name">${t2}</div>
        </div>
      </div>
      <div class="featured-match-info">${m.date} · 点击查看详情</div>
    </div>`;
  });
  html += `
    <div class="res-section-title">赛事资源</div>
    <div class="res-grid">`;
  links.forEach(l => {
    html += `<a class="res-card" href="${l.url}" target="_blank" rel="noopener">
      <div class="res-card-icon" style="background:rgba(107,91,149,0.12)">${l.icon}</div>
      <div class="res-card-title">${l.title}</div>
      <div class="res-card-desc">${l.desc}</div>
      <div class="res-card-meta"><span class="res-card-tag">CS2</span><span>外部链接</span></div>
    </a>`;
  });
  html += `</div>
    <div class="res-section-title">快速入口</div>
    <div class="res-link-list">
      <a class="res-link-item" href="https://www.hltv.org/matches" target="_blank" rel="noopener">
        <div class="res-link-favicon">📺</div>
        <div class="res-link-info"><div class="res-link-title">今日比赛日程</div><div class="res-link-url">hltv.org/matches</div></div>
        <span class="res-link-arrow">→</span>
      </a>
      <a class="res-link-item" href="https://www.hltv.org/events" target="_blank" rel="noopener">
        <div class="res-link-favicon">🏅</div>
        <div class="res-link-info"><div class="res-link-title">正在进行的大赛</div><div class="res-link-url">hltv.org/events</div></div>
        <span class="res-link-arrow">→</span>
      </a>
      <a class="res-link-item" href="https://www.hltv.org/stats" target="_blank" rel="noopener">
        <div class="res-link-favicon">📈</div>
        <div class="res-link-info"><div class="res-link-title">选手数据统计</div><div class="res-link-url">hltv.org/stats</div></div>
        <span class="res-link-arrow">→</span>
      </a>
    </div>`;
  document.getElementById('content').innerHTML = html;
}

// === Resources: Football ===
function renderResourceFootball() {
  const leagues = [
    { name:'英超', nameEn:'Premier League', flag:'🏴', desc:'英格兰超级联赛', url:'https://www.premierleague.com', color:'rgba(201,49,49,0.08)' },
    { name:'西甲', nameEn:'La Liga', flag:'🇪🇸', desc:'西班牙甲级联赛', url:'https://www.laliga.com', color:'rgba(230,126,34,0.08)' },
    { name:'德甲', nameEn:'Bundesliga', flag:'🇩🇪', desc:'德国甲级联赛', url:'https://www.bundesliga.com', color:'rgba(218,0,0,0.08)' },
    { name:'意甲', nameEn:'Serie A', flag:'🇮🇹', desc:'意大利甲级联赛', url:'https://www.legaseriea.it', color:'rgba(0,146,59,0.08)' },
    { name:'法甲', nameEn:'Ligue 1', flag:'🇫🇷', desc:'法国甲级联赛', url:'https://www.ligue1.com', color:'rgba(0,35,149,0.08)' },
    { name:'欧冠', nameEn:'Champions League', flag:'🏆', desc:'欧洲冠军联赛', url:'https://www.uefa.com/uefachampionsleague', color:'rgba(0,46,98,0.08)' },
  ];
  const links = [
    { title:'懂球帝', url:'https://www.dongqiudi.com', icon:'⚽', desc:'足球新闻、比分、赛事数据' },
    { title:'Transfermarkt', url:'https://www.transfermarkt.com', icon:'💸', desc:'球员身价、转会信息、市场价值' },
    { title:'Sofascore', url:'https://www.sofascore.com', icon:'📊', desc:'实时比分、比赛详情、球员评分' },
    { title:'FIFA', url:'https://www.fifa.com', icon:'🏆', desc:'国际足联赛事、排名、规则' },
  ];
  let html = `
    <div class="page-header">
      <div class="page-title">足球 · Football</div>
      <div class="scale-switcher">
        <button class="scale-btn active" onclick="window.open('https://www.dongqiudi.com/schedule','_blank')">赛程</button>
        <button class="scale-btn" onclick="window.open('https://www.sofascore.com','_blank')">实时比分</button>
        <button class="scale-btn" onclick="window.open('https://www.transfermarkt.com','_blank')">转会</button>
      </div>
    </div>
    <div class="league-grid">`;
  leagues.forEach(l => {
    html += `<a class="league-card" href="${l.url}" target="_blank" rel="noopener" style="background:${l.color}">
      <div class="league-card-flag">${l.flag}</div>
      <div class="league-card-name">${l.name}</div>
      <div class="league-card-name-en">${l.nameEn}</div>
      <div class="league-card-desc">${l.desc}</div>
    </a>`;
  });
  html += `</div>
    <div class="res-section-title">数据资源</div>
    <div class="res-grid">`;
  links.forEach(l => {
    html += `<a class="res-card" href="${l.url}" target="_blank" rel="noopener">
      <div class="res-card-icon" style="background:rgba(90,139,173,0.12)">${l.icon}</div>
      <div class="res-card-title">${l.title}</div>
      <div class="res-card-desc">${l.desc}</div>
      <div class="res-card-meta"><span class="res-card-tag">足球</span><span>外部链接</span></div>
    </a>`;
  });
  html += `</div>
    <div class="res-section-title">快速入口</div>
    <div class="res-link-list">
      <a class="res-link-item" href="https://www.dongqiudi.com/schedule" target="_blank" rel="noopener">
        <div class="res-link-favicon">📅</div>
        <div class="res-link-info"><div class="res-link-title">今日赛程</div><div class="res-link-url">dongqiudi.com/schedule</div></div>
        <span class="res-link-arrow">→</span>
      </a>
      <a class="res-link-item" href="https://www.sofascore.com" target="_blank" rel="noopener">
        <div class="res-link-favicon">⚡</div>
        <div class="res-link-info"><div class="res-link-title">实时比分</div><div class="res-link-url">sofascore.com</div></div>
        <span class="res-link-arrow">→</span>
      </a>
      <a class="res-link-item" href="https://www.dongqiudi.com/live" target="_blank" rel="noopener">
        <div class="res-link-favicon">🎥</div>
        <div class="res-link-info"><div class="res-link-title">直播大厅</div><div class="res-link-url">dongqiudi.com/live</div></div>
        <span class="res-link-arrow">→</span>
      </a>
    </div>`;
  document.getElementById('content').innerHTML = html;
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
  const rating = e.rating ? `<span class="entry-rating">${'★'.repeat(e.rating)}${'☆'.repeat(5-e.rating)}</span>` : '';
  const yearLabel = showYear && date ? `<span>${date.slice(0,4)}</span>` : '';
  let poster = renderEntryPoster(e);
  let preview = e.review || e.content || e.notes || e.note || '';
  const tagsHtml = e.tags && e.tags.length ? `<span>${e.tags.slice(0,3).join(' · ')}</span>` : '';
  return `<div class="entry-card type-${e.type}"><div class="entry-time">${time || ''}</div><div class="entry-icon">${meta.emoji}</div><div class="entry-body"><div class="entry-title">${e.title}</div>${preview ? `<div class="entry-content-preview">${preview}</div>`:''}<div class="entry-meta">${rating}${yearLabel}${tagsHtml}</div></div>${poster}</div>`;
}

// === Today ===
async function renderToday() {
  const all = await dbGetAll();
  const sorted = sortEntries(all);
  const todayEntries = sorted.filter(e => getEntryDate(e) === '2026-08-27');
  const totalMovies = all.filter(e=>e.type==='movie').length;
  const totalBooks = all.filter(e=>e.type==='book').length;
  let html = `<div class="today-header"><div class="today-date">2026年8月27日<span class="day">星期四 · 今天</span></div><div class="today-stats"><div class="today-stat">今日 <strong>${todayEntries.length}</strong> 条</div><div class="today-stat">共 <strong>${all.length}</strong> 条记忆</div><div class="today-stat">电影 <strong>${totalMovies}</strong> · 书籍 <strong>${totalBooks}</strong></div></div></div>`;
  if (todayEntries.length > 0) {
    html += '<div class="today-entries">';
    todayEntries.forEach((e,i) => { html += `<div class="fade-in fade-in-delay-${Math.min(i+1,4)}" onclick="openDetail(${e.id})">${renderEntryCard(e)}</div>`; });
    html += '</div>';
  } else {
    html += `<div class="today-empty"><div class="today-empty-icon">✦</div><div class="today-empty-text">今天还没有记录<br>点击右下角的 + 开始</div></div>`;
  }
  const pastEntries = all.filter(e => { const d = getEntryDate(e); return d.endsWith('-08-27') && d !== '2026-08-27'; });
  if (pastEntries.length > 0) {
    html += `<div class="on-this-day"><div class="section-label">On This Day · 那年今日</div><div class="today-entries">`;
    sortEntries(pastEntries).forEach(e => { html += `<div onclick="openDetail(${e.id})">${renderEntryCard(e, true)}</div>`; });
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
    <div id="timeline-content"><div style="text-align:center;padding:40px;color:var(--text-tertiary);">加载中...</div></div>`;
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
  if (sortedKeys.length === 0) html += '<div class="search-empty">没有符合条件的记录</div>';
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
    const byYear = {};
    items.forEach(m => { const y = getEntryDate(m).slice(0,4) || '未知'; if (!byYear[y]) byYear[y] = []; byYear[y].push(m); });
    let html = '';
    Object.keys(byYear).sort().reverse().forEach(y => {
      html += `<div class="year-section"><div class="year-header"><div class="year-number">${y}</div><div class="year-count">${byYear[y].length} 部</div></div><div class="poster-wall">`;
      byYear[y].forEach(m => {
        html += `<div class="poster-item" onclick="openDetail(${m.id})">${renderPosterWall(m)}<div class="poster-title">${m.title}</div><div class="poster-meta">${m.director || ''} · ${m.runtime || ''}min</div></div>`;
      });
      html += '</div></div>';
    });
    content.innerHTML = html || '<div class="search-empty">还没有电影记录</div>';
  } else if (tab === 'book') {
    let html = '<div class="books-grid">';
    items.forEach(b => {
      const [c1,c2] = getPosterColors(b);
      const coverHtml = b.cover
        ? `<div class="book-cover" style="background:linear-gradient(135deg,${c1},${c2});position:relative;overflow:hidden;"><div class="poster-fallback"><span class="pp-icon" style="font-size:20px;">📖</span><span class="pp-title" style="font-size:9px;">${b.title}</span></div><img src="${proxyImage(b.cover)}" alt="${b.title}" loading="lazy" onerror="this.style.display='none'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;"></div>`
        : `<div class="book-cover" style="background:linear-gradient(135deg,${c1},${c2});display:flex;align-items:center;justify-content:center;font-size:20px;">📖</div>`;
      html += `<div class="book-card" onclick="openDetail(${b.id})">${coverHtml}<div class="book-info"><div class="book-title">${b.title}</div><div class="book-author">${b.author||''}</div><div class="book-date">读完于 ${(b.finish_date||'').replace(/-/g,'/')||'阅读中'}</div>${b.rating?`<div class="book-rating">${'★'.repeat(b.rating)}${'☆'.repeat(5-b.rating)}</div>`:''}</div></div>`;
    });
    content.innerHTML = html + '</div>' || '<div class="search-empty">还没有书籍记录</div>';
  } else if (tab === 'music') {
    let html = '<div class="books-grid">';
    items.forEach(m => {
      html += `<div class="book-card" onclick="openDetail(${m.id})"><div class="entry-icon" style="width:64px;height:64px;border-radius:8px;background:rgba(201,123,99,0.12);color:var(--c-music);font-size:28px;">🎵</div><div class="book-info"><div class="book-title">${m.title}</div><div class="book-author">${m.artist||''}</div><div class="book-date">${(m.date||'').replace(/-/g,'/')}</div>${m.rating?`<div class="book-rating" style="color:var(--c-music)">${'★'.repeat(m.rating)}${'☆'.repeat(5-m.rating)}</div>`:''}</div></div>`;
    });
    content.innerHTML = html + '</div>' || '<div class="search-empty">还没有音乐记录</div>';
  } else if (tab === 'game') {
    let html = '<div class="books-grid">';
    items.forEach(g => {
      const coverHtml = g.cover
        ? `<img class="book-cover" src="${proxyImage(g.cover)}" alt="${g.title}" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="book-cover" style="background:rgba(90,139,173,0.12);display:flex;align-items:center;justify-content:center;font-size:28px;color:var(--c-game);">🎮</div>`;
      html += `<div class="book-card" onclick="openDetail(${g.id})">${coverHtml}<div class="book-info"><div class="book-title">${g.title}</div><div class="book-author">${g.platform||''}</div><div class="book-date">${g.finish_date?'通关于 '+g.finish_date.replace(/-/g,'/'):'进行中 · '+g.hours+'h'}</div>${g.rating?`<div class="book-rating" style="color:var(--c-game)">${'★'.repeat(g.rating)}${'☆'.repeat(5-g.rating)}</div>`:''}</div></div>`;
    });
    content.innerHTML = html + '</div>' || '<div class="search-empty">还没有游戏记录</div>';
  } else if (tab === 'place') {
    let html = '<div class="books-grid">';
    items.forEach(p => {
      html += `<div class="book-card type-place" onclick="openDetail(${p.id})"><div class="entry-icon" style="width:64px;height:90px;border-radius:6px;background:rgba(201,169,97,0.15);color:var(--c-place);font-size:28px;display:flex;align-items:center;justify-content:center;">📍</div><div class="book-info"><div class="book-title">${p.title}</div><div class="book-author">${p.location||''}</div><div class="book-date">${(p.date||'').replace(/-/g,'/')}</div>${p.rating?`<div class="book-rating" style="color:var(--c-place)">${'★'.repeat(p.rating)}${'☆'.repeat(5-p.rating)}</div>`:''}</div></div>`;
    });
    content.innerHTML = html + '</div>' || '<div class="search-empty">还没有地点记录</div>';
  }
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
  if (matches.length === 0) { results.innerHTML = '<div class="search-empty">没有找到相关记忆</div>'; return; }
  let html = '<div class="search-results">';
  sortEntries(matches).forEach(e => { html += `<div onclick="openDetail(${e.id})">${renderEntryCard(e, true)}</div>`; });
  html += '</div>';
  results.innerHTML = html;
}
function quickSearch(q) { document.getElementById('search-input').value = q; doSearch(q); }

// === On This Day ===
async function renderOnThisDay() {
  const all = await dbGetAll();
  const past = sortEntries(all.filter(e => { const d = getEntryDate(e); return d.endsWith('-08-27') && d !== '2026-08-27'; }));
  let html = `<div class="page-header"><div class="page-title">那年今日 · On This Day</div></div><div style="font-size:14px;color:var(--text-secondary);margin-bottom:32px;">8月27日 · 时间纵向切片</div>`;
  if (past.length === 0) html += '<div class="search-empty">还没有这一天的历史记录</div>';
  else { html += '<div class="today-entries">'; past.forEach((e,i) => { html += `<div class="fade-in fade-in-delay-${Math.min(i+1,4)}" onclick="openDetail(${e.id})">${renderEntryCard(e, true)}</div>`; }); html += '</div>'; }
  document.getElementById('content').innerHTML = html;
}

// === Random ===
async function renderRandom() {
  const all = await dbGetAll();
  if (all.length === 0) { document.getElementById('content').innerHTML = '<div class="search-empty">还没有记忆记录</div>'; return; }
  const r = all[Math.floor(Math.random() * all.length)];
  document.getElementById('content').innerHTML = `<div class="page-header"><div class="page-title">随机回忆 · Random Memory</div><button class="btn btn-ghost" onclick="renderRandom()">换一个 →</button></div><div style="font-size:14px;color:var(--text-secondary);margin-bottom:32px;">给你看看一个你可能已经忘记的时刻</div><div onclick="openDetail(${r.id})">${renderEntryCard(r, true)}</div>`;
}

// === Settings ===
async function renderSettings() {
  const all = await dbGetAll();
  const counts = {};
  all.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
  let html = `
    <div class="page-header"><div class="page-title">设置 · Settings</div></div>
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
        <div class="settings-row"><div><div class="settings-row-label" style="color:var(--danger);">清除所有数据</div><div class="settings-row-desc">删除全部记忆，不可恢复</div></div><button class="btn btn-ghost" style="color:var(--danger);" onclick="confirmClearData()">清除</button></div>
      </div>
    </div>
    <div class="settings-section">
      <div class="section-label">关于</div>
      <div class="settings-card">
        <div class="settings-row"><div class="settings-row-label">Personal Memory OS</div><div class="settings-row-value">Phase 1 · Local</div></div>
        <div class="settings-row"><div class="settings-row-label">存储方式</div><div class="settings-row-value">IndexedDB · 本地</div></div>
        <div class="settings-row"><div class="settings-row-label">数据不会离开你的设备</div><div class="settings-row-value">✓</div></div>
      </div>
    </div>`;
  document.getElementById('content').innerHTML = html;
}

// === Export ===
async function exportData() {
  const all = await dbGetAll();
  const data = { version:'1.0', export_date:new Date().toISOString(), entries:all };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `memory-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('数据已导出', 'success');
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
async function openDetail(id) {
  const e = await dbGet(id);
  if (!e) return;
  const meta = TYPE_META[e.type] || TYPE_META.event;
  const date = getEntryDate(e);
  const time = getEntryTime(e);
  let html = `<button class="detail-back" onclick="navigate('${currentPage}')">← 返回</button>`;
  html += `<div class="detail-actions"><button class="detail-action-btn" onclick="openCapture(${e.id})">✎ 编辑</button><button class="detail-action-btn danger" onclick="confirmDelete(${e.id})">🗑 删除</button></div>`;

  if (e.poster || e.cover) {
    html += `<div class="detail-hero fade-in">${renderDetailPoster(e)}<div class="detail-info"><div class="detail-type-badge" style="background:${meta.color}22;color:${meta.color}">${meta.emoji} ${meta.label}</div><div class="detail-title">${e.title}</div>`;
    if (e.original_title) html += `<div class="detail-subtitle">${e.original_title}</div>`;
    if (e.author) html += `<div class="detail-subtitle">${e.author}</div>`;
    if (e.director) html += `<div class="detail-subtitle">导演：${e.director}</div>`;
    if (e.artist) html += `<div class="detail-subtitle">${e.artist} · ${e.album||''}</div>`;
    html += '<div class="detail-meta">';
    if (date) html += `<div class="detail-meta-item"><span class="detail-meta-label">${e.type==='movie'?'观看日期':e.type==='book'?'读完日期':e.type==='game'?'通关日期':'日期'}</span><span class="detail-meta-value">${date.replace(/-/g,'/')}</span></div>`;
    if (time) html += `<div class="detail-meta-item"><span class="detail-meta-label">时间</span><span class="detail-meta-value">${time}</span></div>`;
    if (e.rating) html += `<div class="detail-meta-item"><span class="detail-meta-label">评分</span><span class="detail-meta-value" style="color:#E8B948">${'★'.repeat(e.rating)}${'☆'.repeat(5-e.rating)}</span></div>`;
    if (e.runtime) html += `<div class="detail-meta-item"><span class="detail-meta-label">片长</span><span class="detail-meta-value">${e.runtime} 分钟</span></div>`;
    if (e.genres) html += `<div class="detail-meta-item"><span class="detail-meta-label">类型</span><span class="detail-meta-value">${e.genres.join(' / ')}</span></div>`;
    if (e.location) html += `<div class="detail-meta-item"><span class="detail-meta-label">地点</span><span class="detail-meta-value">${e.location}</span></div>`;
    if (e.watched_with) html += `<div class="detail-meta-item"><span class="detail-meta-label">同行</span><span class="detail-meta-value">${e.watched_with}</span></div>`;
    if (e.mood) html += `<div class="detail-meta-item"><span class="detail-meta-label">心情</span><span class="detail-meta-value">${e.mood}</span></div>`;
    if (e.platform) html += `<div class="detail-meta-item"><span class="detail-meta-label">平台</span><span class="detail-meta-value">${e.platform}</span></div>`;
    if (e.hours) html += `<div class="detail-meta-item"><span class="detail-meta-label">游戏时长</span><span class="detail-meta-value">${e.hours} 小时</span></div>`;
    if (e.rewatch_count) html += `<div class="detail-meta-item"><span class="detail-meta-label">重看次数</span><span class="detail-meta-value">${e.rewatch_count}</span></div>`;
    if (e.importance) html += `<div class="detail-meta-item"><span class="detail-meta-label">重要程度</span><span class="detail-meta-value">${'●'.repeat(e.importance)}${'○'.repeat(5-e.importance)}</span></div>`;
    html += '</div></div></div>';
  } else {
    html += `<div class="detail-hero fade-in" style="gap:0"><div class="detail-info"><div class="detail-type-badge" style="background:${meta.color}22;color:${meta.color}">${meta.emoji} ${meta.label}</div><div class="detail-title">${e.title}</div>`;
    if (e.location) html += `<div class="detail-subtitle">${e.location}</div>`;
    html += '<div class="detail-meta">';
    if (date) html += `<div class="detail-meta-item"><span class="detail-meta-label">日期</span><span class="detail-meta-value">${date.replace(/-/g,'/')}</span></div>`;
    if (time) html += `<div class="detail-meta-item"><span class="detail-meta-label">时间</span><span class="detail-meta-value">${time}</span></div>`;
    if (e.mood) html += `<div class="detail-meta-item"><span class="detail-meta-label">心情</span><span class="detail-meta-value">${e.mood}</span></div>`;
    if (e.importance) html += `<div class="detail-meta-item"><span class="detail-meta-label">重要程度</span><span class="detail-meta-value">${'●'.repeat(e.importance)}${'○'.repeat(5-e.importance)}</span></div>`;
    if (e.rating) html += `<div class="detail-meta-item"><span class="detail-meta-label">评分</span><span class="detail-meta-value" style="color:#E8B948">${'★'.repeat(e.rating)}${'☆'.repeat(5-e.rating)}</span></div>`;
    if (e.people) html += `<div class="detail-meta-item"><span class="detail-meta-label">同行</span><span class="detail-meta-value">${e.people.join('、')}</span></div>`;
    html += '</div></div></div>';
  }
  const tc = e.review || e.content || e.notes || e.note;
  if (tc) html += `<div class="detail-section fade-in-delay-1"><div class="detail-section-title">${e.review?'Review · 感想':e.content?'正文':'Notes · 笔记'}</div><div class="detail-review">${tc}</div></div>`;
  if (e.quotes) html += `<div class="detail-section fade-in-delay-2"><div class="detail-section-title">Quote · 摘录</div><div class="detail-review" style="font-style:italic;border-left:3px solid var(--border-strong);padding-left:16px;">${e.quotes}</div></div>`;
  if (e.tags && e.tags.length) html += `<div class="detail-section fade-in-delay-3"><div class="detail-section-title">Tags · 标签</div><div class="detail-tags">${e.tags.map(t=>`<span class="detail-tag">${t}</span>`).join('')}</div></div>`;
  document.getElementById('content').innerHTML = html;
  document.getElementById('content').classList.add('fade-in');
  window.scrollTo({ top:0, behavior:'smooth' });
}

// === Quick Capture ===
function openCapture(entryId) {
  editingId = entryId;
  const title = document.getElementById('modal-title');
  const saveBtn = document.getElementById('save-btn');
  if (entryId) { title.textContent = 'Edit Entry'; saveBtn.textContent = '更新'; loadEntryForEdit(entryId); }
  else { title.textContent = 'Quick Capture'; saveBtn.textContent = '保存'; resetCaptureForm(); }
  document.getElementById('capture-modal').classList.add('show');
  if (!entryId) document.getElementById('capture-input').focus();
}

function resetCaptureForm() {
  ['capture-input','capture-title','capture-review','capture-tags','capture-extra'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('capture-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('capture-time').value = '';
  selectedType = null; selectedRating = 0;
  document.querySelectorAll('.type-option').forEach(t => t.classList.remove('selected'));
  document.getElementById('capture-fields').classList.remove('show');
  document.getElementById('rating-row').style.display = 'none';
  document.getElementById('extra-fields').style.display = 'none';
  document.querySelectorAll('.rating-star').forEach(s => { s.classList.remove('active'); s.textContent = '☆'; });
  doubanSelectedMovie = null;
  const di = document.getElementById('douban-input');
  if (di) di.value = '';
  const dr = document.getElementById('douban-results');
  if (dr) dr.innerHTML = '';
}

async function loadEntryForEdit(id) {
  const e = await dbGet(id);
  if (!e) { closeCapture(); return; }
  document.getElementById('capture-input').value = e.review || e.content || e.notes || e.note || '';
  document.getElementById('capture-title').value = e.title || '';
  document.getElementById('capture-date').value = getEntryDate(e) || '';
  document.getElementById('capture-time').value = getEntryTime(e) || '';
  document.getElementById('capture-review').value = e.review || e.content || e.notes || e.note || '';
  document.getElementById('capture-tags').value = (e.tags || []).join(', ');
  if (e.rating) setRating(e.rating);
  selectType(e.type, false);
  const extraMap = { book:e.author, music:e.artist, game:e.platform, place:e.location, event:e.location };
  if (extraMap[e.type]) {
    document.getElementById('capture-extra').value = extraMap[e.type];
    document.getElementById('extra-fields').style.display = 'block';
    const labels = { book:'作者', music:'艺人 / 专辑', game:'平台', place:'地点', event:'地点' };
    document.getElementById('extra-label').textContent = labels[e.type] || '补充信息';
  }
  doubanSelectedMovie = (e.type === 'movie' && e.poster) ? { img: e.poster, title: e.title, year: e.release_date || '', sub_title: e.original_title || '' } : null;
}

function closeCapture() { document.getElementById('capture-modal').classList.remove('show'); editingId = null; }

function detectType() {
  if (editingId) return;
  const text = document.getElementById('capture-input').value.toLowerCase();
  const kw = { movie:['电影','看','watched','movie','film','影院'], book:['书','读','book','read','读完'], music:['音乐','歌','听','music','song','专辑'], game:['游戏','玩','game','通关'], place:['去','旅行','place','地点','景点'], event:['事件','决定','搬家','毕业','生日','转折','想通'] };
  for (const [type, keywords] of Object.entries(kw)) { if (keywords.some(k => text.includes(k))) { selectType(type, false); return; } }
}

function selectType(type) {
  selectedType = type;
  document.querySelectorAll('.type-option').forEach(t => t.classList.remove('selected'));
  const el = document.querySelector(`.type-option[data-type="${type}"]`);
  if (el) el.classList.add('selected');
  document.getElementById('capture-fields').classList.add('show');
  document.getElementById('rating-row').style.display = ['movie','book','music','game','place'].includes(type) ? 'block' : 'none';
  if (['book','music','game','place','event'].includes(type)) {
    document.getElementById('extra-fields').style.display = 'block';
    const labels = { book:'作者', music:'艺人 / 专辑', game:'平台', place:'地点', event:'地点' };
    document.getElementById('extra-label').textContent = labels[type] || '补充信息';
  } else document.getElementById('extra-fields').style.display = 'none';
}

function setRating(val) {
  selectedRating = val;
  document.querySelectorAll('.rating-star').forEach(s => { const v = parseInt(s.dataset.val); s.classList.toggle('active', v <= val); s.textContent = v <= val ? '★' : '☆'; });
}

async function saveCapture() {
  const title = document.getElementById('capture-title').value.trim() || document.getElementById('capture-input').value.trim().slice(0, 50);
  if (!title) { showToast('请输入标题或内容', 'error'); return; }
  if (!selectedType) { showToast('请选择记录类型', 'error'); return; }
  const date = document.getElementById('capture-date').value;
  const time = document.getElementById('capture-time').value;
  const review = document.getElementById('capture-review').value.trim() || document.getElementById('capture-input').value.trim();
  const tagsStr = document.getElementById('capture-tags').value.trim();
  const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
  const extra = document.getElementById('capture-extra').value.trim();
  const entry = { type:selectedType, title, tags, updated_at:new Date().toISOString() };
  if (selectedType === 'movie') { entry.watch_date=date; entry.watch_time=time; entry.review=review; if(extra)entry.director=extra; if(selectedRating)entry.rating=selectedRating; if(doubanSelectedMovie){entry.poster=doubanSelectedMovie.img; if(doubanSelectedMovie.year)entry.release_date=doubanSelectedMovie.year; if(doubanSelectedMovie.sub_title)entry.original_title=doubanSelectedMovie.sub_title;} }
  else if (selectedType === 'book') { entry.finish_date=date; if(time)entry.finish_time=time; entry.notes=review; if(extra)entry.author=extra; if(selectedRating)entry.rating=selectedRating; }
  else if (selectedType === 'music') { entry.date=date; entry.note=review; if(extra)entry.artist=extra; if(selectedRating)entry.rating=selectedRating; }
  else if (selectedType === 'game') { entry.start_date=date; if(extra)entry.platform=extra; entry.review=review; if(selectedRating)entry.rating=selectedRating; }
  else if (selectedType === 'place') { entry.date=date; entry.note=review; if(extra)entry.location=extra; if(selectedRating)entry.rating=selectedRating; }
  else if (selectedType === 'event') { entry.event_date=date; if(time)entry.event_time=time; entry.content=review; if(extra)entry.location=extra; }
  else { entry.event_date=date; entry.content=review; }
  if (editingId) {
    const ex = await dbGet(editingId);
    const merged = { ...ex, ...entry };
    merged.id = editingId;
    merged.created_at = ex?.created_at || new Date().toISOString();
    merged.updated_at = new Date().toISOString();
    await dbPut(merged);
    showToast('已更新', 'success');
    const editId = editingId;
    closeCapture();
    await openDetail(editId);
  } else {
    entry.created_at = new Date().toISOString();
    await dbAdd(entry);
    showToast('已保存', 'success');
    closeCapture();
    await navigate(currentPage);
  }
}

// === Delete ===
function confirmDelete(id) {
  showConfirm('🗑️', '删除记录', '确定要删除这条记忆吗？此操作不可恢复。', async () => {
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
  if (e.key === 'Escape') { closeCapture(); closeConfirm(); }
});
document.getElementById('capture-modal').addEventListener('click', function(e) { if (e.target === this) closeCapture(); });
document.getElementById('confirm-overlay').addEventListener('click', function(e) { if (e.target === this) closeConfirm(); });

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

// === Init ===
(async function init() {
  try { await initDB(); } catch(e) { console.error('IndexedDB init failed:', e); }
  await seedIfEmpty();
  fixSeedPosters();
  await navigate('today');
})();
