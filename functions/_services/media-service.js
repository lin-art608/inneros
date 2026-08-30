// Application Service：媒体搜索/详情（ARCH-007）
// 依赖注入：providers（{ douban: DoubanAdapter }）。职责：
//   1) Provider 选择（movie/book → douban；未知类型/未来音乐 → 明确拒绝）
//   2) 参数校验（query 必填、去空白）
//   3) 统一错误映射（第三方异常 → PROVIDER_ERROR 且 retryable，原始错误不泄漏）
// 禁止：DOM、Cookie、Cloudflare Request、SQL、直接 fetch 第三方（fetch 在 Adapter 内）。
// ARCH-009：业务错误统一抛 ServiceError（复用 _infra/errors.js，不自建第二套 Error 类）。
// 此前用本地 businessError() 造裸 Error，导致路由 `e instanceof ServiceError` 判定失败，
// 所有第三方故障都被退化成 500 INTERNAL（而非 502 PROVIDER_ERROR/可重试）。

import { ErrorCode, ServiceError } from '../_infra/errors.js';

export function createMediaService({ providers }) {
  const SUPPORTED = { movie: 'douban', book: 'douban' }; // music/series 等 Provider 后续接入

  function businessError(code, message, status = 400, retryable = false) {
    return new ServiceError(code, message, { status, retryable });
  }

  function pickProvider(type) {
    const name = SUPPORTED[type];
    if (!name) throw businessError(ErrorCode.VALIDATION_ERROR, '暂不支持的媒体类型：' + type, 400);
    const p = providers[name];
    if (!p) throw businessError(ErrorCode.PROVIDER_ERROR, '该类型的媒体服务未配置', 503, true);
    return p;
  }

  return {
    // 用例：媒体搜索（标准结构输出；第三方异常 → PROVIDER_ERROR 可重试）
    async searchMedia({ type, query }) {
      const q = String(query || '').trim();
      if (!q) throw businessError(ErrorCode.VALIDATION_ERROR, '搜索词不能为空', 400);
      const provider = pickProvider(type);
      try {
        const items = await provider.search({ type, query: q });
        return { items: items || [], page: 1, hasMore: false, source: type === 'book' ? 'douban-book' : 'douban' };
      } catch (e) {
        if (e instanceof ServiceError) throw e;
        // 原始第三方错误只进服务端日志，用户可见消息保持通用（方案第十一节）
        console.log('[media-service] provider search failed:', String(e.message || e).slice(0, 200));
        throw businessError(ErrorCode.PROVIDER_ERROR, '媒体服务暂时不可用，请稍后重试', 502, true);
      }
    },

    // 用例：媒体详情（标准结构输出）
    async getDetail({ type, id }) {
      if (!id) throw businessError(ErrorCode.VALIDATION_ERROR, '缺少 id', 400);
      const provider = pickProvider(type);
      try {
        return await provider.detail({ type, id });
      } catch (e) {
        if (e instanceof ServiceError) throw e;
        console.log('[media-service] provider detail failed:', String(e.message || e).slice(0, 200));
        throw businessError(ErrorCode.PROVIDER_ERROR, '媒体服务暂时不可用，请稍后重试', 502, true);
      }
    },
  };
}
