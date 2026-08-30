// 豆瓣 Adapter（ARCH-006）——把豆瓣响应转换成 InnerOS 标准模型
// 规则：外部字段不泄漏到 UI/Domain；原始数据只进 providerMetadata。
// 覆盖：搜索（subject_suggest）/ 电影详情（rexxar）/ 书籍详情（rexxar，HTML 解析兜底）。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchDouban(url, referer, accept) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': referer, 'Accept': accept },
  });
  if (!res.ok) throw new Error('douban ' + res.status);
  return res;
}

// ---- 标准结构映射（纯函数，可单测）----
// ARCH-010：书籍 suggest 带 author_name（作者）——它是书籍的 creator，必须进入标准模型，
// 否则 v1 搜索结果的书籍没有作者（旧接口行为回归）。
export function mapSuggestItem(it) {
  return {
    externalId: String(it.id),
    title: it.title || '',
    originalTitle: it.sub_title || '',
    poster: it.img || it.pic || '',
    year: it.year || '',
    creators: it.author_name ? [it.author_name] : [],
    genres: [],
    score: null,
    source: 'douban',
    providerMetadata: { url: it.url || '' },
  };
}
export function mapMovieDetail(d, id) {
  const durationMatch = ((d.durations && d.durations[0]) || '').match(/\d+/);
  return {
    externalId: String(d.id || id),
    title: d.title || '',
    originalTitle: d.original_title || '',
    poster: d.cover_url || (d.pic && d.pic.large) || '',
    releaseDate: (Array.isArray(d.pubdate) && d.pubdate[0]) || (d.year ? String(d.year) : ''),
    creators: [...(d.directors || []).map(x => x.name), ...(d.actors || []).map(x => x.name)],
    genres: d.genres || [],
    score: d.rating && d.rating.value ? d.rating.value : null,
    description: d.intro || '',
    source: 'douban',
    providerMetadata: { runtime: durationMatch ? Number(durationMatch[0]) : null, subtitle: d.card_subtitle || '' },
  };
}
export function mapBookDetail(d, id) {
  const segs = (d.card_subtitle || '').split(' / ');
  const pagesRaw = Array.isArray(d.pages) ? (d.pages[0] || '') : (d.pages || '');
  return {
    externalId: String(d.id || id),
    title: d.title || '',
    poster: d.cover_url || (d.pic && d.pic.large) || '',
    releaseDate: (Array.isArray(d.pubdate) && d.pubdate[0]) || '',
    creators: [...(Array.isArray(d.author) ? d.author : []), ...(Array.isArray(d.translator) ? d.translator : [])].filter(Boolean),
    genres: [],
    score: d.rating && d.rating.value ? d.rating.value : null,
    description: d.intro || '',
    source: 'douban',
    providerMetadata: {
      authors: (Array.isArray(d.author) && d.author.join(' / ')) || '',
      translator: (Array.isArray(d.translator) && d.translator.join(' / ')) || '',
      publisher: (Array.isArray(d.press) && d.press.join(' / ')) || (segs.length >= 3 ? segs[1] : ''),
      isbn: d.isbn13 || d.isbn || '',
      pageCount: pagesRaw ? (parseInt(pagesRaw, 10) || 0) : 0,
      price: (Array.isArray(d.price) && d.price[0]) || '',
    },
  };
}

// ARCH-010：书籍详情合并（纯函数，可单测）。
// rexxar book API 实测不返回 ISBN（isbn13=None）；出版社/页数偶有缺失。
// 用书籍详情页 HTML 解析结果补齐缺失字段，已有一律不覆盖。
export function mergeBookDetail(media, htmlData) {
  if (!htmlData) return media;
  const meta = media.providerMetadata || {};
  meta.isbn = meta.isbn || htmlData.isbn || '';
  meta.publisher = meta.publisher || htmlData.publisher || '';
  meta.pageCount = meta.pageCount || htmlData.pageCount || 0;
  media.providerMetadata = meta;
  if (!media.description) media.description = htmlData.description || '';
  if (!media.creators.length && htmlData.authors) media.creators = [htmlData.authors];
  if (!media.releaseDate) media.releaseDate = htmlData.publishedDate || '';
  return media;
}

// ---- 标准接口（方案第八节 searchMedia / getMediaDetail）----
export async function searchMedia({ type, query }) {
  const kind = type === 'book' ? 'book' : 'movie';
  const referer = `https://${kind}.douban.com/`;
  const res = await fetchDouban(`https://${kind}.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`, referer, 'application/json, text/javascript, */*; q=0.01');
  const data = await res.json();
  const raw = Array.isArray(data) ? data : [];
  return raw.map(it => ({ ...mapSuggestItem(it), mediaType: kind })); // ARCH-010：标准模型必须带 mediaType
}

export async function getMediaDetail({ type, id }) {
  if (type === 'book') {
    const res = await fetchDouban(`https://m.douban.com/rexxar/api/v2/book/${id}`, `https://m.douban.com/book/subject/${id}/`, 'application/json');
    const d = await res.json();
    const media = mapBookDetail(d, id);
    media.mediaType = 'book';
    // rexxar 缺 ISBN 等字段时，用详情页 HTML 兜底（失败不影响主数据）
    if (!media.providerMetadata.isbn || !media.providerMetadata.publisher || !media.providerMetadata.pageCount) {
      try {
        mergeBookDetail(media, await bookDetailHtml(id));
      } catch (e) { /* 兜底失败保留 rexxar 数据 */ }
    }
    return media;
  }
  const res = await fetchDouban(`https://m.douban.com/rexxar/api/v2/movie/${id}`, `https://m.douban.com/movie/${id}/`, 'application/json');
  const d = await res.json();
  return mapMovieDetail(d, id);
}

// Provider 形态（media-service 依赖注入用）
export const doubanProvider = {
  name: 'douban',
  async search({ type, query }) { return searchMedia({ type, query }); },
  async detail({ type, id }) { return getMediaDetail({ type, id }); },
};

// ---- 旧响应形状（既有 /api/douban 路由的兼容输出，由路由层映射）----
export async function suggestRaw(kind, q) {
  const res = await fetchDouban(`https://${kind}.douban.com/j/subject_suggest?q=${encodeURIComponent(q)}`, 'https://movie.douban.com/', 'application/json, text/javascript, */*; q=0.01');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function stripTags(x) { return (x || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }

export async function movieDetailLegacy(id) {
  const res = await fetchDouban(`https://m.douban.com/rexxar/api/v2/movie/${id}`, `https://m.douban.com/movie/${id}/`, 'application/json');
  const d = await res.json();
  const durationMatch = ((d.durations && d.durations[0]) || '').match(/\d+/);
  return {
    external_id: String(d.id || id),
    title: d.title || '',
    original_title: d.original_title || '',
    poster: d.cover_url || (d.pic && d.pic.large) || '',
    release_date: (Array.isArray(d.pubdate) && d.pubdate[0]) || (d.year ? String(d.year) : ''),
    director: (d.directors || []).map(x => x.name).join(' / '),
    actors: (d.actors || []).map(x => x.name).join(' / '),
    genres: d.genres || [],
    description: d.intro || '',
    rating: d.rating && d.rating.value ? d.rating.value : null,
    runtime: durationMatch ? Number(durationMatch[0]) : null,
    subtitle: d.card_subtitle || '',
  };
}

export async function bookDetailRexxar(id) {
  const res = await fetchDouban(`https://m.douban.com/rexxar/api/v2/book/${id}`, `https://m.douban.com/book/subject/${id}/`, 'application/json');
  if (!res.ok) throw new Error('douban ' + res.status);
  const d = await res.json();
  const segs = (d.card_subtitle || '').split(' / ');
  const pagesRaw = Array.isArray(d.pages) ? (d.pages[0] || '') : (d.pages || '');
  return {
    external_id: String(d.id || id),
    authors: (Array.isArray(d.author) && d.author.join(' / ')) || '',
    publisher: (Array.isArray(d.press) && d.press.join(' / ')) || (segs.length >= 3 ? segs[1] : ''),
    isbn: d.isbn13 || d.isbn || '',
    pageCount: pagesRaw ? (parseInt(pagesRaw, 10) || 0) : 0,
    publishedDate: (Array.isArray(d.pubdate) && d.pubdate[0]) || '',
    description: d.intro || '',
    rating: d.rating && d.rating.value ? d.rating.value : null,
    translator: (Array.isArray(d.translator) && d.translator.join(' / ')) || '',
    price: (Array.isArray(d.price) && d.price[0]) || '',
  };
}

export async function bookDetailHtml(id) {
  const res = await fetchDouban(`https://book.douban.com/subject/${id}/`, 'https://book.douban.com/', 'text/html');
  const html = await res.text();
  let publisher = '', isbn = '', pages = '', pubdate = '';
  const infoM = html.match(/<div id="info">([\s\S]*?)<\/div>/);
  if (infoM) {
    const text = infoM[1].replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '');
    const line = label => { const m = text.match(new RegExp(label + '\\s*[::]\\s*([^\\n]+)')); return m ? m[1].trim() : ''; };
    publisher = line('出版社');
    isbn = line('ISBN');
    pages = line('页数');
    pubdate = line('出版年');
  }
  let intro = '';
  const introM = html.match(/<div class="intro">([\s\S]*?)<\/div>/);
  if (introM) {
    const pM = introM[1].match(/<p>([\s\S]*?)<\/p>/);
    if (pM) intro = stripTags(pM[1]);
  }
  let author = '';
  const authorM = html.match(/<span class="pl">\s*作者\s*[::]\s*<\/span>([\s\S]{0,400}?)<br/);
  if (authorM) author = stripTags(authorM[1]);
  return {
    external_id: String(id),
    authors: author,
    publisher,
    isbn,
    pageCount: pages ? (parseInt(pages, 10) || 0) : 0,
    publishedDate: pubdate,
    description: intro,
  };
}

export async function suggestLegacy(kind, q) {
  const raw = await suggestRaw(kind, q);
  return raw.map(it => ({
    external_id: it.id,
    title: it.title || '',
    original_title: it.sub_title || '',
    poster: it.img || '',
    release_date: it.year || '',
    director: '',
    genres: [],
    description: '',
    provider: 'douban',
    cover: it.pic || '',
    authors: it.author_name || '',
    publishedDate: it.year || '',
    isbn: '',
    categories: [],
    pageCount: 0,
  }));
}
