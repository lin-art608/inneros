// GET /api/v1/sports/cs2/matches?scope=all —— CS2 官方来源赛程（统一信封）。

import { ok, fail, errors, ServiceError } from '../../../../_infra/errors.js';
import { liquipediaProvider } from '../../../../_adapters/liquipedia-adapter.js';
import { createSportsService } from '../../../../_services/sports-service.js';

const service = createSportsService({ liquipedia: liquipediaProvider });

export async function onRequestGet(context) {
  const scope = new URL(context.request.url).searchParams.get('scope') || 'all';
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

