// GET /api/v1/football/image?url=xxx —— API-Football 图片代理
// media-1.api-sports.io 的图片需要 API key 才能访问，通过后端代理解决 CORS/鉴权问题。
// 缓存 24 小时。
import { hasKey } from '../../../_services/football-client.js';
import { errors } from '../../../_infra/errors.js';

const ALLOWED_HOSTS = ['media-1.api-sports.io', 'media.api-sports.io'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) return errors.validation('图片 URL 不能为空');

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch (e) {
    return errors.validation('图片 URL 格式错误');
  }
  if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
    return errors.validation('不允许的图片域名');
  }

  const headers = {};
  if (hasKey(env)) headers['x-apisports-key'] = env.FOOTBALL_API_KEY;

  try {
    const res = await fetch(target, {
      headers,
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
    if (!res.ok) return new Response('图片获取失败', { status: 404 });
    const contentType = res.headers.get('content-type') || 'image/png';
    const body = await res.arrayBuffer();
    return new Response(body, {
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400',
        'access-control-allow-origin': '*',
      },
    });
  } catch (e) {
    console.error('[football image]', e.message);
    return new Response('图片代理失败', { status: 502 });
  }
}
