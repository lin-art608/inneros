// Sports Service（ARCH-017）——赛事查询用例与第三方错误隔离。
// 路由只负责参数解析/响应；Adapter 只负责外部 API；前端只接收标准比赛模型。

import { ErrorCode, ServiceError } from '../_infra/errors.js';

export function createSportsService({ pandascore, liquipedia }) {
  return {
    async listCS2Matches({ scope = 'all' } = {}) {
      if (scope !== 'all') {
        throw new ServiceError(ErrorCode.VALIDATION_ERROR, 'scope 仅支持 all', { status: 400 });
      }
      if ((!pandascore || !pandascore.configured) && (!liquipedia || typeof liquipedia.getMatches !== 'function')) {
        throw new ServiceError(ErrorCode.PROVIDER_ERROR, '赛事服务尚未配置', { status: 503, retryable: true });
      }
      if (pandascore && pandascore.configured && typeof pandascore.getMatches === 'function') {
        try {
          const matches = await pandascore.getMatches({ limit: 200 });
          return {
            matches,
            provider: 'pandascore',
            coverage: { scope, limit: 200, returned: matches.length },
            attribution: { name: 'PandaScore', url: 'https://www.pandascore.co/' },
          };
        } catch (error) {
          console.log('[sports-service] PandaScore failed, fallback to Liquipedia:', String(error.message || error).slice(0, 200));
        }
      }
      try {
        const matches = await liquipedia.getMatches({ limit: 200 });
        return {
          matches,
          provider: 'liquipedia',
          degraded: pandascore && pandascore.configured ? 'pandascore-error' : 'limited-source',
          coverage: { scope, limit: 200, returned: matches.length },
          attribution: {
            name: 'Liquipedia',
            license: 'CC BY-SA 3.0',
            url: 'https://liquipedia.net/counterstrike/Liquipedia:Matches',
          },
        };
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        console.log('[sports-service] Liquipedia failed:', String(error.message || error).slice(0, 200));
        throw new ServiceError(ErrorCode.PROVIDER_ERROR, 'CS2 赛事服务暂时不可用，请稍后重试', { status: 502, retryable: true });
      }
    },
  };
}
