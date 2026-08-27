const DOUBAN_CDN_NODES = Array.from({ length: 9 }, (_, i) => `img${i + 1}`);

function buildHeaders(targetUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
  if (targetUrl.includes('doubanio.com') || targetUrl.includes('douban.com')) {
    headers['Referer'] = 'https://movie.douban.com/';
  }
  return headers;
}

async function fetchImage(url) {
  try {
    const res = await fetch(url, { headers: buildHeaders(url) });
    if (!res.ok) return null;
    const contentType = res.headers.get('Content-Type', '');
    if (!contentType.startsWith('image/')) return null;
    return { contentType, data: res };
  } catch {
    return null;
  }
}

async function fetchDoubanImageWithFallback(url) {
  let result = await fetchImage(url);
  if (result) return result;

  const match = url.match(/(https?:\/\/)(img\d+)(\.doubanio\.com\/.+)/);
  if (match) {
    const originalNode = match[2];
    const path = match[3];
    for (const node of DOUBAN_CDN_NODES) {
      if (node === originalNode) continue;
      const altUrl = `${match[1]}${node}${path}`;
      result = await fetchImage(altUrl);
      if (result) return result;
    }
  }
  return null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const targetUrl = url.searchParams.get('url', '');

  if (!targetUrl) {
    return new Response('Missing url parameter', { status: 400 });
  }

  const isDouban = targetUrl.includes('doubanio.com') || targetUrl.includes('douban.com');
  let result = null;

  if (isDouban) {
    result = await fetchDoubanImageWithFallback(targetUrl);
  } else {
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await fetchImage(targetUrl);
      if (result) break;
    }
  }

  if (result) {
    const body = await result.data.arrayBuffer();
    return new Response(body, {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  return new Response('Image not available', { status: 404 });
}
