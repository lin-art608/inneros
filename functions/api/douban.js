// 豆瓣搜索 + 详情代理（电影 / 书籍）
// 解决 V1.2 审计发现的问题：
//   1) 电影此前走 iTunes(US 商店)，中文片名/中文电影搜不到；
//   2) 书籍此前走 Google Books，在中国大陆 googleapis.com 常被墙/超时，搜不到。
// 豆瓣是中国可达 + 中文覆盖好的公开源；搜索用 subject_suggest，
// 详情用 m.douban.com rexxar API（电影）+ 书籍详情页 HTML 解析（书籍）。
// 免 API Key，符合 V1.2 §12。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function movieItem(it) {
  return {
    external_id: it.id,
    title: it.title || '',
    original_title: it.sub_title || '',
    poster: it.img || '',
    release_date: it.year || '',
    director: '',
    genres: [],
    description: '',
    provider: 'douban',
  };
}

function bookItem(it) {
  return {
    external_id: it.id,
    title: it.title || '',
    authors: it.author_name || '',
    publisher: '',
    publishedDate: it.year || '',
    cover: it.pic || '',
    isbn: '',
    categories: [],
    description: '',
    pageCount: 0,
    provider: 'douban',
  };
}

async function doubanSuggest(kind, q) {
  const url = `https://${kind}.douban.com/j/subject_suggest?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://movie.douban.com/',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
    },
  });
  if (!res.ok) throw new Error('douban ' + res.status);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// === 电影详情：豆瓣移动端 rexxar API（含 intro 简介 / 导演 / 评分 / 片长） ===
async function movieDetail(id) {
  const url = `https://m.douban.com/rexxar/api/v2/movie/${id}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': `https://m.douban.com/movie/${id}/`,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error('douban ' + res.status);
  const d = await res.json();
  const durationMatch = ((d.durations && d.durations[0]) || '').match(/\d+/);
  return {
    external_id: String(d.id || id),
    title: d.title || '',
    original_title: d.original_title || '',
    poster: d.cover_url || (d.pic && d.pic.large) || '',
    release_date: (d.pubdate && d.pubdate[0]) || (d.year ? String(d.year) : ''),
    director: (d.directors || []).map(x => x.name).join(' / '),
    actors: (d.actors || []).map(x => x.name).join(' / '),
    genres: d.genres || [],
    description: d.intro || '',
    rating: d.rating && d.rating.value ? d.rating.value : null,
    runtime: durationMatch ? Number(durationMatch[0]) : null,
    subtitle: d.card_subtitle || '',
  };
}

// === 书籍详情：书籍详情页 HTML 解析（出版社 / ISBN / 页数 / 出版年 / 简介） ===
function stripTags(s) { return (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }

async function bookDetail(id) {
  const url = `https://book.douban.com/subject/${id}/`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': 'https://book.douban.com/', 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });
  if (!res.ok) throw new Error('douban ' + res.status);
  const html = await res.text();

  // info 块（出版社/ISBN/页数/出版年）——去掉标签后按行解析，兼容冒号在 span 内外的两种格式
  let publisher = '', isbn = '', pages = '', pubdate = '';
  const infoM = html.match(/<div id="info">([\s\S]*?)<\/div>/);
  if (infoM) {
    const text = infoM[1].replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '');
    const line = (label) => {
      const m = text.match(new RegExp(label + '\\s*[::]\\s*([^\\n]+)'));
      return m ? m[1].trim() : '';
    };
    publisher = line('出版社');
    isbn = line('ISBN');
    pages = line('页数');
    pubdate = line('出版年');
  }

  // 简介（intro 区第一个 <p>）
  let intro = '';
  const introM = html.match(/<div class="intro">([\s\S]*?)<\/div>/);
  if (introM) {
    const pM = introM[1].match(/<p>([\s\S]*?)<\/p>/);
    if (pM) intro = stripTags(pM[1]);
  }

  // 作者
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

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const type = url.searchParams.get('type') || 'movie';
  const q = url.searchParams.get('q') || '';
  const id = url.searchParams.get('id') || '';

  // 详情模式：type=detail&kind=movie|book&id=xxx
  if (type === 'detail') {
    const kind = url.searchParams.get('kind') || 'movie';
    if (!id) return jsonResponse({ detail: null }, 400);
    try {
      const detail = kind === 'book' ? await bookDetail(id) : await movieDetail(id);
      return jsonResponse({ detail });
    } catch (e) {
      return jsonResponse({ detail: null }, 502);
    }
  }

  // 搜索模式：type=movie|book&q=xxx
  if (!q) {
    const empty = type === 'book' ? { items: [] } : { results: [] };
    return jsonResponse(empty, 400);
  }

  const kind = type === 'book' ? 'book' : 'movie';
  try {
    const raw = await doubanSuggest(kind, q);
    const list = type === 'book' ? raw.map(bookItem) : raw.map(movieItem);
    const body = type === 'book' ? { items: list } : { results: list };
    return jsonResponse(body);
  } catch (e) {
    const empty = type === 'book' ? { items: [] } : { results: [] };
    return jsonResponse(empty, 502);
  }
}
