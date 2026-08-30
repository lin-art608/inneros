// GET /api/v1/media/detail?type=movie|book&id=... —— 统一媒体详情（ARCH-009）
// 电影垂直切片的"详情"环节：Route → MediaService → DoubanAdapter → 标准 Media。
// 未来换 TMDB/OpenLibrary 只增 Adapter，不改本路由，也不改 UI 读取方式。

import { ok, fail, errors, ServiceError } from '../../../_infra/errors.js';
import { doubanProvider } from '../../../_adapters/douban-adapter.js';
import { itunesProvider } from '../../../_adapters/itunes-adapter.js';
import { createMediaService } from '../../../_services/media-service.js';

// Route 职责：parse → service → ok/fail（Provider 选择/错误映射在 Service）
// ARCH-011：providers 补 itunes（music）；未来换 Provider 只增 Adapter，不改本路由
const service = createMediaService({ providers: { douban: doubanProvider, itunes: itunesProvider } });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const type = url.searchParams.get('type') || 'movie';
  const id = url.searchParams.get('id') || '';
  try {
    const media = await service.getDetail({ type, id });
    return ok(media);
  } catch (e) {
    if (e instanceof ServiceError) return fail(e.code, e.message, { status: e.status, retryable: e.retryable });
    return errors.internal('内部错误');
  }
}
