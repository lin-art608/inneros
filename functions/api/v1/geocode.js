// GET /api/v1/geocode?q=地点名称 —— 地理编码（地点名称→经纬度）
// 后端代理 Nominatim（OpenStreetMap 官方，免费免 Key，1 req/s），避免前端直接调用与 CORS 问题。
// 用于足迹地图：把用户记录的地点名称转成经纬度，缓存在记录的 lat/lng 字段中避免重复查询。
// 合规：不引入付费服务，不存密钥；Nominatim 要求描述性 UA + 合理频率。

import { ok, fail, errors } from '../../_infra/errors.js';

// 简单内存缓存（per-isolate，CF Workers 同 isolate 复用时有效；地点重复查询率高，命中率可观）
const geoCache = new Map();

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return errors.validation('地点名称不能为空');

  // 命中缓存直接返回
  const cacheKey = q.toLowerCase();
  if (geoCache.has(cacheKey)) {
    const cached = geoCache.get(cacheKey);
    return ok(cached);
  }

  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=zh-CN&q=${encodeURIComponent(q)}`;
    const res = await fetch(nomUrl, {
      headers: {
        'User-Agent': 'InnerOS/1.0 (personal memory app, https://inneros.pages.dev)',
        'Accept': 'application/json',
      },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!res.ok) {
      console.error('[geocode] nominatim HTTP', res.status);
      return errors.provider('地理编码服务暂时不可用，请稍后重试', true);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      const empty = { lat: null, lon: null, display_name: null };
      geoCache.set(cacheKey, empty);
      return ok(empty);
    }
    const first = data[0];
    const result = {
      lat: parseFloat(first.lat),
      lon: parseFloat(first.lon),
      display_name: first.display_name || null,
    };
    geoCache.set(cacheKey, result);
    return ok(result);
  } catch (e) {
    console.error('[geocode] error:', e.message);
    return errors.provider('地理编码服务暂时不可用，请稍后重试', true);
  }
}
