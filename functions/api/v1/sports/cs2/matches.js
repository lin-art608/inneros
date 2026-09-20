// GET /api/v1/sports/cs2/matches?scope=all —— CS2 官方来源赛程（统一信封）。

import { ok, fail, errors, ServiceError } from '../../../../_infra/errors.js';
import { liquipediaProvider } from '../../../../_adapters/liquipedia-adapter.js';
import { createPandaScoreProvider } from '../../../../_adapters/pandascore-adapter.js';
import { createSportsService } from '../../../../_services/sports-service.js';

export async function onRequestGet(context) {
  const scope = new URL(context.request.url).searchParams.get('scope') || 'all';
  const service = createSportsService({
    pandascore: createPandaScoreProvider(context.env?.PANDASCORE_API_TOKEN),
    liquipedia: liquipediaProvider,
  });
  try {
    return ok(await service.listCS2Matches({ scope }), {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=900' },
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return fail(error.code, error.message, { status: error.status, retryable: error.retryable });
    }
    return errors.internal('内部错误');
  }
}
