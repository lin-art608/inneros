// 豆瓣搜索代理（电影 / 书籍）
// 解决 V1.2 审计发现的问题：
//   1) 电影此前走 iTunes(US 商店)，中文片名/中文电影搜不到；
//   2) 书籍此前走 Google Books，在中国大陆 googleapis.com 常被墙/超时，搜不到。
// 豆瓣是中国可达 + 中文覆盖好的公开源；本函数仅用 subject_suggest（详情接口已被豆瓣限流/改版）。
// 复用 server.py / functions/api/search.js 的豆瓣代理思路，统一归一化为 app.js 既有字段名。
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

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const type = url.searchParams.get('type') || 'movie';
  const q = url.searchParams.get('q') || '';

  if (!q) {
    const empty = type === 'book' ? { items: [] } : { results: [] };
    return new Response(JSON.stringify(empty), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const kind = type === 'book' ? 'book' : 'movie';
  try {
    const raw = await doubanSuggest(kind, q);
    const list = type === 'book' ? raw.map(bookItem) : raw.map(movieItem);
    const body = type === 'book' ? { items: list } : { results: list };
    return new Response(JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (e) {
    const empty = type === 'book' ? { items: [] } : { results: [] };
    return new Response(JSON.stringify(empty), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
