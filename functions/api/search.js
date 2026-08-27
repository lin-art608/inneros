export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const query = url.searchParams.get('q', '');

  if (!query) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const doubanUrl = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(doubanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://movie.douban.com/',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      },
    });

    if (!res.ok) {
      return new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    const data = await res.text();
    return new Response(data, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
