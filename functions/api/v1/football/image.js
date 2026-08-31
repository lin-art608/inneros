// GET /api/v1/football/image?url=xxx —— API-Football 图片代理
// media-1.api-sports.io 的图片 CDN 是公开的，**不需要也不携带 API key**
// （V1.20.2 修复：带坏 key 请求会被上游拒绝，导致队徽全挂只剩字母）。
// 后端代理只为统一 CORS。缓存 24 小时。
import { errors } from '../../../_infra/errors.js';

const ALLOWED_HOSTS = ['media-1.api-sports.io', 'media.api-sports.io'];

export async function onRequestGet(context) {
  const { request } = context;
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

  try {
    const res = await fetch(target, {
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
