// GET /api/v1/media/search?type=movie|book&query=... —— 统一媒体搜索（ARCH-006）
// 经 DoubanAdapter 转换为标准结构；未来加 TMDB/OpenLibrary 只增 Adapter 不改此路由。

import { ok, errors } from '../../../_infra/errors.js';
import { searchMedia } from '../../../_adapters/douban-adapter.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const type = url.searchParams.get('type') || 'movie';
  const query = (url.searchParams.get('query') || '').trim();

  if (!query) return errors.validation('query 不能为空');
  if (!['movie', 'book'].includes(type)) return errors.validation('type 仅支持 movie 或 book');

  try {
    const items = await searchMedia({ type, query });
    return ok({ items, page: 1, hasMore: false, source: 'douban' });
  } catch (e) {
    return errors.provider('媒体服务暂时不可用：' + String(e && e.message || e).slice(0, 120), true);
  }
}
