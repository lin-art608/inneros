// GET /api/v1/media/search?type=movie|book&query=... —— 统一媒体搜索（ARCH-006）
// 经 DoubanAdapter 转换为标准结构；未来加 TMDB/OpenLibrary 只增 Adapter 不改此路由。

import { ok, fail, errors, ServiceError } from '../../../_infra/errors.js';
import { doubanProvider } from '../../../_adapters/douban-adapter.js';
import { itunesProvider } from '../../../_adapters/itunes-adapter.js';
import { createMediaService } from '../../../_services/media-service.js';

// Route 职责：parse → service → ok/fail（Provider 选择/错误映射在 Service）
// ARCH-011：providers 补 itunes（music）；未来加 TMDB 只增 Adapter，不改本路由
const service = createMediaService({ providers: { douban: doubanProvider, itunes: itunesProvider } });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const type = url.searchParams.get('type') || 'movie';
  const query = url.searchParams.get('query') || '';
  try {
    const result = await service.searchMedia({ type, query });
    return ok(result);
  } catch (e) {
    if (e instanceof ServiceError) return fail(e.code, e.message, { status: e.status, retryable: e.retryable });
    return errors.internal('内部错误');
  }
}
